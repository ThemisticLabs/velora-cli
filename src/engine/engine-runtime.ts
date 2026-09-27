import { createHash, createPublicKey, verify } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { openPromise } from 'yauzl';
import type { PackageRelease } from '../downloads/package-release.js';
import { PACKAGE_PUBLIC_KEY } from '../downloads/package-request.js';
import DownloadError from '../downloads/download-error.js';
import verifyFile from './verify-file.js';

type RuntimeFile = { size: number; sha256: string; executable: boolean };

export default async function engineRuntime(packagePath: string, runtimePath: string, release: PackageRelease,
    signal: AbortSignal, publicKey = PACKAGE_PUBLIC_KEY): Promise<string> {
    if (!(await lstat(packagePath)).isDirectory()) {
        throw new DownloadError('The engine package directory is missing or linked.');
    }
    for (var [name, file] of Object.entries(release.files)) {
        await verifyFile(join(packagePath, name), file, signal);
    }
    var raw = await readFile(join(packagePath, 'manifest.json'));
    var signature = await readFile(join(packagePath, 'manifest.sig'));
    var SPKI_PREFIX = '302a300506032b6570032100';
    var key = createPublicKey({ key: Buffer.concat([Buffer.from(SPKI_PREFIX, 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
    if (!verify(null, raw, key, signature)) {
        throw new DownloadError('The engine manifest signature is invalid.');
    }
    var manifest: unknown = JSON.parse(raw.toString('utf8'));
    if (!isRecord(manifest) || manifest.install_layout !== undefined || !isRecord(manifest.files)) {
        throw new DownloadError('The engine manifest is invalid.');
    }
    for (var field of ['model_id', 'version', 'engine_version', 'runtime_target', 'artifact_kind', 'engine_api', 'distribution'] as const) {
        if (manifest[field] !== release[field]) {
            throw new DownloadError('The engine manifest differs from its release.');
        }
    }
    if (manifest.package_revision !== release.revision || Object.keys(manifest.files).length !== 2) {
        throw new DownloadError('The engine manifest differs from its release.');
    }
    var archive = '';
    for (var [name, file] of Object.entries(release.files)) {
        if (name === 'manifest.json' || name === 'manifest.sig') {
            continue;
        }
        if (manifest.files[name] !== file.sha256) {
            throw new DownloadError('The engine manifest contains different checksums.');
        }
        if (name.endsWith('.zip')) {
            archive = join(packagePath, name);
        }
    }
    var inventory: unknown = JSON.parse(await readFile(join(packagePath, 'inventory.json'), 'utf8'));
    var MAX_FILES = 20000;
    var MAX_RUNTIME_BYTES = 4 * 1024 ** 3;
    if (!isRecord(inventory) || inventory.schema !== 1 || inventory.version !== release.version ||
        inventory.runtime_target !== release.runtime_target || !isRecord(inventory.files) ||
        Object.keys(inventory.files).length < 1 || Object.keys(inventory.files).length > MAX_FILES) {
        throw new DownloadError('The engine inventory is invalid.');
    }
    var total = 0;
    var names = new Set<string>();
    for (var [name, value] of Object.entries(inventory.files)) {
        if (!name.startsWith('themistic-engine/') || /[\\:\x00-\x1f\x7f]/.test(name)) {
            throw new DownloadError('The engine inventory contains an unsafe path.');
        }
        for (var part of name.split('/')) {
            if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part)) {
                throw new DownloadError('The engine inventory contains an unsafe path.');
            }
        }
        if (names.has(name.toLowerCase()) || !isRecord(value) || typeof value.size !== 'number' ||
            !Number.isSafeInteger(value.size) || value.size < 0 || typeof value.executable !== 'boolean' ||
            typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
            throw new DownloadError('The engine inventory contains an invalid file.');
        }
        total += value.size;
        names.add(name.toLowerCase());
    }
    if (total > MAX_RUNTIME_BYTES) {
        throw new DownloadError('The extracted engine exceeds its size limit.');
    }
    var files = inventory.files as Record<string, RuntimeFile>;
    var entrypoint = 'themistic-engine/themistic-engine';
    if (release.runtime_target === 'standalone-windows-x64') {
        entrypoint += '.exe';
    }
    if (!files[entrypoint]?.executable) {
        throw new DownloadError('The engine entry point is missing from the signed inventory.');
    }
    var exists = false;
    try {
        if (!(await lstat(runtimePath)).isDirectory()) {
            throw new DownloadError('The engine runtime directory is linked or invalid.');
        }
        exists = true;
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
    if (!exists) {
        await mkdir(runtimePath, { mode: 0o700 });
        var bundle = await openPromise(archive, { lazyEntries: true, strictFileNames: true });
        try {
            if (bundle.entryCount !== names.size) {
                throw new DownloadError('The engine archive differs from its inventory.');
            }
            var extracted = new Set<string>();
            for await (var entry of bundle.eachEntry()) {
                signal.throwIfAborted();
                var item = files[entry.fileName];
                var fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
                if (!Object.hasOwn(files, entry.fileName) || !item || extracted.has(entry.fileName) || entry.isEncrypted() ||
                    ![0, 0o100000].includes(fileType) || entry.uncompressedSize !== item.size) {
                    throw new DownloadError('The engine archive contains an unexpected or linked entry.');
                }
                extracted.add(entry.fileName);
                var destination = join(runtimePath, entry.fileName);
                await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
                var output = await open(destination, 'wx', 0o600);
                var source: Readable | undefined = undefined;
                try {
                    source = await bundle.openReadStreamPromise(entry);
                    var hash = createHash('sha256');
                    var size = 0;
                    for await (var chunk of source) {
                        signal.throwIfAborted();
                        size += chunk.length;
                        if (size > item.size) {
                            throw new DownloadError('An extracted engine file exceeds its size limit.');
                        }
                        hash.update(chunk);
                        await output.writeFile(chunk);
                    }
                    if (size !== item.size || hash.digest('hex') !== item.sha256) {
                        throw new DownloadError('An extracted engine file failed checksum verification.');
                    }
                    await output.sync();
                } finally {
                    source?.destroy();
                    await output.close();
                }
                var mode = 0o644;
                if (item.executable) {
                    mode = 0o755;
                }
                await chmod(destination, mode);
            }
            if (extracted.size !== names.size) {
                throw new DownloadError('The engine archive is incomplete.');
            }
        } finally {
            bundle.close();
        }
    }
    var folders = [runtimePath];
    var actual = 0;
    for (var index = 0; index < folders.length; index++) {
        for (var member of await readdir(folders[index]!, { withFileTypes: true })) {
            var path = join(folders[index]!, member.name);
            if (member.isDirectory()) {
                folders.push(path);
                continue;
            }
            var name = path.slice(runtimePath.length + 1).replaceAll('\\', '/');
            if (!member.isFile() || !Object.hasOwn(files, name)) {
                throw new DownloadError('The engine runtime contains an unexpected or linked file.');
            }
            var storedFile = files[name]!;
            await verifyFile(path, storedFile, signal);
            if (process.platform !== 'win32' && Boolean((await lstat(path)).mode & 0o111) !== storedFile.executable) {
                throw new DownloadError('The engine runtime permissions have changed.');
            }
            actual++;
        }
    }
    if (actual !== names.size) {
        throw new DownloadError('The engine runtime is incomplete.');
    }
    return join(runtimePath, entrypoint);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
