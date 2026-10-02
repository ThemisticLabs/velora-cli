import { semver } from 'bun';
import { mkdir, lstat, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import packageRequest, { PACKAGE_PUBLIC_KEY } from '../downloads/package-request.js';
import packageRelease from '../downloads/package-release.js';
import DownloadError from '../downloads/download-error.js';
import dataDirectory from '../system/data-directory.js';
import runtimeTarget from './runtime-target.js';
import engineRuntime from './engine-runtime.js';

export type EngineProgress = { downloaded: number; total: number; message: string; engineVersion?: string };

export default async function bootstrapEngine(license: string, signal: AbortSignal,
    onProgress: (progress: EngineProgress) => void = function () {},
    options: { directory?: string; transport?: typeof fetch; publicKey?: string; target?: string; update?: boolean; installedOnly?: boolean; expectedVersion?: string } = {}) {
    if (!options.installedOnly && !/^[A-Z0-9-]{8,64}$/.test(license)) {
        throw new DownloadError('Check the license key and try again.');
    }
    var target = options.target || await runtimeTarget(signal);
    var directory = options.directory || dataDirectory();
    var root = join(directory, 'engine');
    var publicKey = options.publicKey || PACKAGE_PUBLIC_KEY;
    var transport = options.transport || fetch;
    for (var parent of [directory, root]) {
        if (!options.installedOnly) {
            await mkdir(parent, { recursive: true, mode: 0o700 });
        }
        try {
            var parentInfo = await lstat(parent);
        } catch (error) {
            if (options.installedOnly && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                throw new DownloadError('No installed engine is available. Complete setup before checking the license.');
            }
            throw error;
        }
        if (!parentInfo.isDirectory()) {
            throw new DownloadError('Engine storage must be a directory, not a link.');
        }
    }
    var lockPath = join(root, '.bootstrap.lock');
    try {
        var lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            throw new DownloadError('Another engine setup is running. If it has stopped, inspect engine/.bootstrap.lock before retrying.');
        }
        throw error;
    }
    var temporary: string | undefined;
    try {
        var saved: unknown;
        try {
            var statePath = join(root, 'bootstrap.json');
            var stateInfo = await lstat(statePath);
            var MAX_STATE_BYTES = 2 * 1024 ** 2;
            if (!stateInfo.isFile() || stateInfo.size > MAX_STATE_BYTES) {
                throw new DownloadError('The saved engine record is linked or invalid.');
            }
            saved = JSON.parse(await readFile(statePath, 'utf8'));
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw error;
            }
        }
        if (saved !== undefined && !options.update) {
            var release = packageRelease(saved, target);
            var installation = join(root, release.revision);
            if (!(await lstat(installation)).isDirectory()) {
                throw new DownloadError('The saved engine installation is linked or missing.');
            }
            if (!(await lstat(join(installation, 'runtime'))).isDirectory()) {
                throw new DownloadError('The cached engine runtime is missing or linked. Download the engine again.');
            }
            var packagePath = join(installation, 'package');
            onProgress({ downloaded: 0, total: 0, message: 'Verifying the installed engine.', engineVersion: release.version });
            var executable = await engineRuntime(packagePath, join(installation, 'runtime'), release, signal, publicKey);
            return { executable, packagePath, runtimePath: join(installation, 'runtime'), release, target };
        }
        if (options.installedOnly) {
            throw new DownloadError('No installed engine is available. Complete setup before checking the license.');
        }
        onProgress({ downloaded: 0, total: 0, message: 'Preparing the engine download.' });
        var binding = { operation: 'resolve' as const, license_key: license, runtime_target: target };
        var plan = await packageRequest(binding, signal, transport, publicKey);
        var release = packageRelease(plan.metadata.engine, target);
        if (options.expectedVersion && release.version !== options.expectedVersion) {
            throw new DownloadError('The available engine version changed. Check for updates again.');
        }
        if (saved !== undefined) {
            var previous = packageRelease(saved, target);
            if (semver.order(release.version, previous.version) !== 1 || release.sequence <= previous.sequence || release.revision === previous.revision) {
                throw new DownloadError('No newer engine release is available. Check for updates again.');
            }
        }
        var total = 0;
        for (var file of Object.values(release.files)) {
            total += file.size;
        }
        temporary = await mkdtemp(join(root, '.bootstrap-'));
        var packagePath = join(temporary, 'package');
        await mkdir(packagePath, { mode: 0o700 });
        var downloaded = 0;
        var CHUNK_BYTES = 1024 ** 2;
        for (var [name, file] of Object.entries(release.files)) {
            onProgress({ downloaded, total, message: 'Downloading ' + name, engineVersion: release.version });
            var output = await open(join(packagePath, name), 'wx', 0o600);
            try {
                for (var offset = 0; offset < file.size;) {
                    signal.throwIfAborted();
                    var length = Math.min(CHUNK_BYTES, file.size - offset);
                    var chunk = await packageRequest({ ...binding, operation: 'file', revision: release.revision,
                        name, sha256: file.sha256, offset, length }, signal, transport, publicKey, file.size);
                    await output.writeFile(chunk.body);
                    offset += length;
                    downloaded += length;
                    onProgress({ downloaded, total, message: '', engineVersion: release.version });
                }
                await output.sync();
            } finally {
                await output.close();
            }
        }
        onProgress({ downloaded, total, message: 'Verifying and unpacking the engine.', engineVersion: release.version });
        await engineRuntime(packagePath, join(temporary, 'runtime'), release, signal, publicKey);
        var refreshed = await packageRequest(binding, signal, transport, publicKey);
        if (!isDeepStrictEqual(refreshed.metadata.engine, release)) {
            throw new DownloadError('The engine release changed during download. Try again.');
        }
        var installation = join(root, release.revision);
        try {
            await lstat(installation);
            throw new DownloadError('This engine directory already exists. Inspect it before retrying setup.');
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw error;
            }
        }
        var state = await open(join(temporary, 'bootstrap.json'), 'wx', 0o600);
        try {
            await state.writeFile(JSON.stringify(release) + '\n');
            await state.sync();
        } finally {
            await state.close();
        }
        signal.throwIfAborted();
        await rename(temporary, installation);
        temporary = undefined;
        try {
            await rename(join(installation, 'bootstrap.json'), join(root, 'bootstrap.json'));
        } catch (error) {
            await rm(installation, { recursive: true, force: true });
            throw error;
        }
        var executable = join(installation, 'runtime', 'themistic-engine', 'themistic-engine');
        if (release.runtime_target === 'standalone-windows-x64') {
            executable += '.exe';
        }
        return { executable, packagePath: join(installation, 'package'), runtimePath: join(installation, 'runtime'), release, target };
    } finally {
        try {
            if (temporary) {
                await rm(temporary, { recursive: true, force: true });
            }
        } finally {
            await lock.close();
            await rm(lockPath, { force: true });
        }
    }
}
