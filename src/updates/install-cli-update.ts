import { IS_COMPILED } from '../system/build-mode.js';
import DownloadError from '../downloads/download-error.js';
import { semver } from 'bun';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import packageInfo from '../../package.json' with { type: 'json' };
import dataDirectory from '../system/data-directory.js';
import syncDirectory from '../system/sync-directory.js';
import releaseMetadata from './release-metadata.js';
import readUpdateAsset from './read-update-asset.js';
import updateProbe from './update-probe.js';
import updateFile from './update-file.js';
import updateState, { type UpdateState } from './update-state.js';
import launchUpdateWorker from './launch-update-worker.js';
import directoryLock from '../system/directory-lock.js';
import updatePaths from './update-paths.js';
import { MAX_MANIFEST_BYTES, SIGNATURE_BYTES, UPDATE_LOCK_SUFFIX, UPDATE_STATE_SUFFIX, UPDATE_WORKSPACE_PREFIX } from './update-contract.js';
import type { EngineProgress } from '../engine/bootstrap-engine.js';

export var cliUpdatePending = false;

type Options = { executable?: string; directory?: string; publicKey?: string; currentVersion?: string; transport?: typeof fetch; launch?: typeof launchUpdateWorker };

export default async function installCliUpdate(version: string, signal: AbortSignal, progress?: (value: EngineProgress) => void, options: Options = {}): Promise<void> {
    signal.throwIfAborted();
    var currentVersion = options.currentVersion || packageInfo.version;
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) || semver.order(version, currentVersion) !== 1) {
        throw new DownloadError('Only a newer stable version can be installed.');
    }
    if (!options.executable && !IS_COMPILED) { throw new DownloadError('Update the compiled velora command. Development source is not replaced.'); }
    var executable = await realpath(options.executable || process.execPath);
    var directory = options.directory || dataDirectory();
    if (!(await lstat(executable)).isFile()) { throw new DownloadError('The installed executable is unavailable.'); }
    var lockPath = executable + UPDATE_LOCK_SUFFIX;
    var lease = await directoryLock({ operation: 'acquire', path: lockPath });
    var workdir: string | undefined;
    var launched = false;
    var existing: UpdateState | null | undefined;
    try {
        existing = await updateState(executable);
        if (existing && !['installed', 'restored', 'failed'].includes(existing.phase)) {
            throw new DownloadError('An interrupted update must be recovered before installing another version. Restart velora.');
        }
        if (existing && semver.order(version, existing.version) !== 1) {
            throw new DownloadError('This release was already installed or rejected. Wait for a newer release.');
        }
        workdir = await mkdtemp(join(dirname(executable), UPDATE_WORKSPACE_PREFIX));
        var DOWNLOAD_TIMEOUT_MS = 300000;
        var timeout = AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
        var base = 'https://github.com/ThemisticLabs/velora-cli/releases/download/v' + version + '/';
        progress?.({ downloaded: 0, total: 0, message: 'Checking release signature…' });
        var manifest = await readUpdateAsset(base + 'release.json', MAX_MANIFEST_BYTES, timeout, options.transport);
        var signature = await readUpdateAsset(base + 'release.sig', SIGNATURE_BYTES, timeout, options.transport);
        var asset = releaseMetadata(manifest, signature, version, process.platform, process.arch, options.publicKey);
        var bytes = await readUpdateAsset(base + asset.name, asset.size, timeout, options.transport, function (downloaded) {
            progress?.({ downloaded, total: asset.size, message: 'Downloading velora ' + version + '…' });
        });
        if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
            throw new DownloadError('The update checksum does not match. Your current version was kept.');
        }
        timeout.throwIfAborted();
        var paths = updatePaths(workdir);
        var candidate = paths.candidate;
        var file = await open(candidate, 'wx', 0o700);
        try {
            await file.writeFile(bytes);
            await file.sync();
        } finally {
            await file.close();
        }
        await chmod(candidate, 0o700);
        await syncDirectory(workdir);
        progress?.({ downloaded: asset.size, total: asset.size, message: 'Testing the new version and reading saved settings…' });
        if (await updateFile(candidate) !== asset.sha256) { throw new DownloadError('The saved update checksum does not match.'); }
        timeout.throwIfAborted();
        await updateProbe(candidate, version, directory);
        signal.throwIfAborted();
        var state: UpdateState = { phase: 'prepared', workdir, version, previousVersion: currentVersion,
            previousHash: await updateFile(executable), nextHash: asset.sha256, target: executable,
            dataDirectory: directory, parentPid: process.pid, workerPid: 0, lockToken: lease.token };
        var planPath = paths.plan;
        var plan = await open(planPath, 'wx', 0o600);
        try {
            await plan.writeFile(JSON.stringify(state) + '\n');
            await plan.sync();
        } finally {
            await plan.close();
        }
        await syncDirectory(workdir);
        await updateState(executable, state);
        var launch = options.launch || launchUpdateWorker;
        await launch(candidate, planPath);
        launched = true;
        cliUpdatePending = true;
    } finally {
        if (!launched) {
            try {
                var saved = await updateState(executable);
                if (saved && saved.workdir === workdir && saved.lockToken === lease.token) {
                    if (existing) {
                        await updateState(executable, existing);
                    } else {
                        await rm(executable + UPDATE_STATE_SUFFIX, { force: true });
                        await syncDirectory(dirname(executable));
                    }
                }
                if (workdir) {
                    await rm(workdir, { recursive: true, force: true });
                }
            } finally {
                await directoryLock({ operation: 'release', path: lockPath, lease });
            }
        }
    }
}
