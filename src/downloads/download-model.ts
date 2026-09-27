import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import DownloadError from './download-error.js';
import engineSession from '../engine/engine-session.js';
import type { EngineProgress } from '../engine/bootstrap-engine.js';

export type DownloadProgress = EngineProgress;
export type DownloadOptions = {
    license: string;
    modelId: string;
    modelName?: string;
    root: string;
    signal: AbortSignal;
    onProgress: (progress: DownloadProgress) => void;
    connect?: typeof engineSession;
    update?: { version: string; revision: string; sequence: number };
};

export default async function downloadModel(options: DownloadOptions) {
    var { license, modelId, signal, onProgress } = options;
    if (!/^[A-Z0-9-]{8,64}$/.test(license) || !/^[a-z0-9_-]{2,64}$/.test(modelId) || modelId === 'engine') {
        throw new DownloadError('Invalid license or model.');
    }
    var root = resolve(options.root);
    var modelsRoot = dirname(root);
    if (root !== join(modelsRoot, modelId)) {
        throw new DownloadError('The model storage path does not match its identifier.');
    }
    for (var directory of [modelsRoot, root]) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await lstat(directory)).isDirectory()) {
            throw new DownloadError('Model storage must be a directory, not a link.');
        }
    }
    var lockPath = join(modelsRoot, '.velora.lock');
    try {
        var lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            throw new DownloadError('Another model operation is running. Wait for it to finish and try again.');
        }
        throw error;
    }
    var session: Awaited<ReturnType<typeof engineSession>> | undefined;
    var temporary: string | undefined;
    var cleanupRequired = false;
    var previousState: string | undefined;
    var published = false;
    try {
        if (options.update) {
            if (!(await lstat(join(root, 'current.json'))).isFile() || !(await lstat(join(root, 'velora.json'))).isFile()) {
                throw new DownloadError('The installed model record is missing or linked.');
            }
            previousState = await readFile(join(root, 'current.json'), 'utf8');
            var previous: unknown = JSON.parse(previousState);
            var saved: unknown = JSON.parse(await readFile(join(root, 'velora.json'), 'utf8'));
            if (!isRecord(previous) || previous.model_id !== modelId || typeof previous.sequence !== 'number' ||
                !isRecord(saved) || saved.revision !== previous.revision ||
                options.update.sequence <= previous.sequence || options.update.revision === previous.revision) {
                throw new DownloadError('The installed model changed. Check for updates again.');
            }
        } else {
            try {
                var existing: unknown = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
                if (typeof existing === 'object' && existing !== null && 'version' in existing) {
                    throw new DownloadError('This model is already installed.');
                }
                await lstat(join(root, 'velora.json'));
                throw new DownloadError('This model is already installed.');
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                    throw error;
                }
            }
        }
        var connect = options.connect || engineSession;
        session = await connect(license, signal, onProgress);
        await session.request('models', { license_key: license });
        onProgress({ downloaded: 0, total: 0, message: 'The engine is downloading and verifying your model.', engineVersion: session.installation.release.version });
        var result = await session.request('install', { model_id: modelId, root: modelsRoot, engine_package: session.installation.packagePath, progress: true });
        var receipt = result.receipt;
        if (result.model_id !== modelId || result.files_verified !== true || typeof result.model_version !== 'string' ||
            !result.model_version || result.model_version.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(result.model_version) ||
            typeof result.engine_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(result.engine_version) ||
            !isRecord(receipt) || receipt.model_id !== modelId || receipt.license_authorized !== true || receipt.reported_hashes_match !== true) {
            throw new DownloadError('The engine did not confirm a verified installation. Retry the installation.');
        }
        for (var revision of [receipt.model_revision, receipt.engine_revision]) {
            if (typeof revision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(revision) || revision.endsWith('.') ||
                /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(revision)) {
                throw new DownloadError('The engine returned an invalid installation revision.');
            }
        }
        var path = join(root, 'installed', modelId, receipt.model_revision as string);
        if (typeof result.path !== 'string' || resolve(result.path) !== path) {
            throw new DownloadError('The engine returned a different model installation path.');
        }
        for (var directory of [root, join(root, 'installed'), join(root, 'installed', modelId), path]) {
            if (!(await lstat(directory)).isDirectory()) {
                throw new DownloadError('The installed model directory is missing or linked.');
            }
        }
        if (!(await lstat(join(root, 'current.json'))).isFile()) {
            throw new DownloadError('The model installation record is missing or linked.');
        }
        var state: unknown = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
        if (!isRecord(state) || state.model_id !== modelId || state.revision !== receipt.model_revision ||
            typeof state.sequence !== 'number' || !Number.isSafeInteger(state.sequence) || state.sequence < 1) {
            throw new DownloadError('The model installation record does not match the engine receipt.');
        }
        if (options.update && (result.model_version !== options.update.version || state.revision !== options.update.revision ||
            state.sequence !== options.update.sequence)) {
            throw new DownloadError('The available model changed. Check for updates again.');
        }
        var record = { model_id: modelId, model_name: options.modelName, revision: receipt.model_revision,
            version: result.model_version, engine_version: result.engine_version, engine_revision: receipt.engine_revision, receipt };
        temporary = await mkdtemp(join(root, '.receipt-'));
        var file = await open(join(temporary, 'velora.json'), 'wx', 0o600);
        try {
            await file.writeFile(JSON.stringify(record) + '\n');
            await file.sync();
        } finally {
            await file.close();
        }
        await rename(join(temporary, 'velora.json'), join(root, 'velora.json'));
        published = true;
        onProgress({ downloaded: 0, total: 0, message: 'Model installed and confirmed.', engineVersion: result.engine_version });
    } finally {
        try {
            await session?.close();
        } catch {
            cleanupRequired = true;
        }
        try {
            if (previousState && !published) {
                // Stop the writer before restoring the last confirmed model.
                var restored = JSON.parse(previousState) as Record<string, unknown>;
                var attempted: unknown = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
                if (isRecord(attempted) && isRecord(attempted.highest_sequences)) {
                    var highest = restored.highest_sequences;
                    if (!isRecord(highest)) { highest = {}; }
                    var sequences = highest as Record<string, unknown>;
                    for (var [id, value] of Object.entries(attempted.highest_sequences)) {
                        var priorSequence = sequences[id];
                        if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 &&
                            (typeof priorSequence !== 'number' || value > priorSequence)) {
                            sequences[id] = value;
                        }
                    }
                    restored.highest_sequences = sequences;
                }
                var rollback = await mkdtemp(join(root, '.rollback-'));
                try {
                    var rollbackFile = await open(join(rollback, 'current.json'), 'wx', 0o600);
                    try {
                        await rollbackFile.writeFile(JSON.stringify(restored) + '\n');
                        await rollbackFile.sync();
                    } finally {
                        await rollbackFile.close();
                    }
                    await rename(join(rollback, 'current.json'), join(root, 'current.json'));
                } finally {
                    await rm(rollback, { recursive: true, force: true });
                }
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
                await rm(lockPath, { force: true });
            } catch {
                cleanupRequired = true;
            }
        }
    }
    return { path, cleanupRequired };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
