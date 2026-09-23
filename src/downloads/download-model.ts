import DownloadError from './download-error.js';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdir, lstat, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import packageRequest, { MAX_METADATA_BYTES, PACKAGE_PUBLIC_KEY } from './package-request.js';
import packageRelease from './package-release.js';

export type DownloadProgress = {
    downloaded: number;
    total: number;
    message: string;
    engineVersion?: string;
};
export type DownloadOptions = {
    license: string;
    hw: string;
    modelId: string;
    modelName?: string;
    root: string;
    signal: AbortSignal;
    onProgress: (progress: DownloadProgress) => void;
    waitForResume?: () => Promise<void>;
    transport?: typeof fetch;
    publicKey?: string;
};

export default async function downloadModel(options: DownloadOptions) {
    var { license, hw, modelId, root, signal, onProgress } = options;
    var transport = options.transport || fetch;
    var publicKey = options.publicKey || PACKAGE_PUBLIC_KEY;
    var CHUNK_BYTES = 1024 * 1024;
    var SIGNATURE_BYTES = 64;
    if (!/^[A-Z0-9-]{8,64}$/.test(license) || !/^[a-f0-9]{16,64}$/.test(hw) || !/^[a-z0-9_-]{2,64}$/.test(modelId)) {
        throw new DownloadError('Invalid license, device identity or model.');
    }
    signal.throwIfAborted();
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink()) {
        throw new DownloadError('The installation directory must not be a symbolic link.');
    }
    var lockPath = join(root, '.update.lock');
    try {
        var lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            throw new DownloadError('Another installation holds the model lock. If no installation is running, inspect .update.lock before retrying.');
        }
        throw error;
    }
    var temporary: string | undefined;
    var cleanupRequired = false;
    try {
        try {
            await lstat(join(root, 'current.json'));
            throw new DownloadError('This model is already installed. Update support will be added later.');
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                throw error;
            }
        }
        onProgress({ downloaded: 0, total: 0, message: 'Reading the signed model catalog.' });
        var binding = { operation: 'catalog' as const, license_key: license, hw, model_id: null };
        await options.waitForResume?.();
        signal.throwIfAborted();
        var catalog = await packageRequest(binding, signal, transport, publicKey);
        if (!Array.isArray(catalog.metadata.releases)) {
            throw new DownloadError('The model catalog is invalid.');
        }
        var candidates = [];
        for (var item of catalog.metadata.releases) {
            var candidate = packageRelease(item);
            if (candidate.model_id === modelId && candidate.enabled) {
                candidates.push(candidate);
            }
        }
        if (candidates.length !== 1) {
            throw new DownloadError('No unique downloadable release is available for this model.');
        }
        var release = candidates[0]!;
        var total = 0;
        for (var descriptor of Object.values(release.files)) {
            total += descriptor.size;
        }
        for (var name of ['manifest.json', 'manifest.sig', 'license_config.json']) {
            if (!release.files[name] || release.files[name]!.size > MAX_METADATA_BYTES) {
                throw new DownloadError('The package metadata is missing or too large.');
            }
        }
        if (release.files['manifest.sig']!.size !== SIGNATURE_BYTES) {
            throw new DownloadError('The manifest signature has an invalid size.');
        }
        var downloaded = 0;
        temporary = await mkdtemp(join(root, '.install-'));
        var stage = join(temporary, 'package');
        await mkdir(stage, { mode: 0o700 });
        for (var [name, file] of Object.entries(release.files)) {
            signal.throwIfAborted();
            var hash = createHash('sha256');
            var offset = 0;
            onProgress({ downloaded, total, message: 'Downloading ' + name, engineVersion: release.engine_version });
            var output = await open(join(stage, name), 'wx', 0o600);
            try {
                do {
                    await options.waitForResume?.();
                    signal.throwIfAborted();
                    var length = Math.min(CHUNK_BYTES, file.size - offset);
                    var chunk = await packageRequest({ operation: 'file', license_key: license, hw, model_id: modelId,
                        revision: release.revision, name, sha256: file.sha256, offset, length }, signal, transport, publicKey, file.size);
                    signal.throwIfAborted();
                    await output.writeFile(chunk.body);
                    hash.update(chunk.body);
                    offset += length;
                    downloaded += length;
                    onProgress({ downloaded, total, message: '', engineVersion: release.engine_version });
                } while (offset < file.size);
                await output.sync();
            } finally {
                await output.close();
            }
            if (hash.digest('hex') !== file.sha256) {
                throw new DownloadError('The checksum does not match for ' + name + '.');
            }
        }
        onProgress({ downloaded, total, message: 'Verifying the model package.', engineVersion: release.engine_version });
        var raw = await readFile(join(stage, 'manifest.json'));
        var signature = await readFile(join(stage, 'manifest.sig'));
        var SPKI_PREFIX = '302a300506032b6570032100';
        var key = createPublicKey({ key: Buffer.concat([Buffer.from(SPKI_PREFIX, 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
        if (!verify(null, raw, key, signature)) {
            throw new DownloadError('The package manifest signature is invalid.');
        }
        var manifest: unknown = JSON.parse(raw.toString('utf8'));
        if (!isRecord(manifest) || manifest.model_id !== modelId || manifest.version !== release.version ||
            (manifest.package_revision ?? manifest.version) !== release.revision || manifest.engine_version !== release.engine_version ||
            !isRecord(manifest.files) || !Object.hasOwn(manifest.files, 'predict.py') || !Object.hasOwn(manifest.files, 'license_config.json')) {
            throw new DownloadError('The manifest does not match the selected model release.');
        }
        if (Object.keys(manifest.files).length + 2 !== Object.keys(release.files).length) {
            throw new DownloadError('The package includes unsigned or missing files.');
        }
        var RESERVED_NAMES = new Set(['manifest.json', 'manifest.sig', 'sha256sums', 'master.key', 'signatur_privat.key', 'skira_license_key.txt']);
        for (var [name, digest] of Object.entries(manifest.files)) {
            if (RESERVED_NAMES.has(name.toLowerCase()) || /\.(safetensors|db)$/i.test(name) ||
                !Object.hasOwn(release.files, name) || release.files[name]!.sha256 !== digest) {
                throw new DownloadError('The manifest file list differs from the signed catalog.');
            }
        }
        var config: unknown = JSON.parse(await readFile(join(stage, 'license_config.json'), 'utf8'));
        if (!isRecord(config) || config.model_id !== modelId || config.version !== release.version || config.public_key_hex !== publicKey) {
            throw new DownloadError('The package license configuration does not match its manifest.');
        }
        await options.waitForResume?.();
        signal.throwIfAborted();
        var refreshed = await packageRequest(binding, signal, transport, publicKey);
        if (!Array.isArray(refreshed.metadata.releases)) {
            throw new DownloadError('The final model catalog is invalid.');
        }
        var unchanged = false;
        for (var item of refreshed.metadata.releases) {
            if (isDeepStrictEqual(item, release)) {
                unchanged = true;
            }
        }
        if (!unchanged) {
            throw new DownloadError('The release or license changed during download. Run setup again.');
        }
        var modelDirectory = join(root, 'installed', modelId);
        for (var directory of [join(root, 'installed'), modelDirectory]) {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            if ((await lstat(directory)).isSymbolicLink()) {
                throw new DownloadError('Linked installation directories are not supported.');
            }
        }
        var target = join(modelDirectory, release.revision);
        try {
            await lstat(target);
            throw new DownloadError('This package directory already exists. Inspect it before retrying.');
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                throw error;
            }
        }
        var state = { model_id: modelId, model_name: options.modelName, version: release.version, revision: release.revision,
            sequence: release.sequence, engine_version: release.engine_version, highest_sequences: { [modelId]: release.sequence } };
        var statePath = join(temporary, 'current.json');
        var stateFile = await open(statePath, 'wx', 0o600);
        try {
            await stateFile.writeFile(JSON.stringify(state, null, 2) + '\n');
            await stateFile.sync();
        } finally {
            await stateFile.close();
        }
        signal.throwIfAborted();
        await rename(stage, target);
        try {
            await rename(statePath, join(root, 'current.json'));
        } catch (error) {
            await rm(target, { recursive: true, force: true });
            throw error;
        }
    } finally {
        try {
            if (temporary) {
                await rm(temporary, { recursive: true, force: true });
            }
        } catch {
            cleanupRequired = true;
        }
        try {
            await lock.close();
        } catch {
            cleanupRequired = true;
        }
        try {
            await rm(lockPath);
        } catch {
            cleanupRequired = true;
        }
    }
    return { path: target, ...state, cleanupRequired };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
