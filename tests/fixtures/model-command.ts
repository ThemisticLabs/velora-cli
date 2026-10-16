import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import modelCommand from '../../src/commands/model-command.js';
import installedModels from '../../src/models/installed-models.js';
import manageLicense from '../../src/license/manage-license.js';
import type { DownloadOptions } from '../../src/downloads/download-model.js';
import directoryLock, { type DirectoryLease } from '../../src/system/directory-lock.js';
import servicePaths from '../../src/service/service-paths.js';

var scenario = process.argv[2];
var cancelledAfterInstall = ['interrupt-cleanup', 'terminate-cleanup', 'terminate-failed-cleanup'].includes(scenario!);
var directory = await mkdtemp(join(tmpdir(), 'velora-model-command-'));
var licenseCalls = 0;
var downloads = 0;
var modelReads = 0;
var beforeInterrupt = process.listenerCount('SIGINT');
var beforeTerminate = process.listenerCount('SIGTERM');
var lease: DirectoryLease | undefined;
try {
    if (!['empty', 'select-empty'].includes(scenario!)) {
        for (var id of ['model-a', 'model-b']) {
            var root = join(directory, 'models', id);
            await mkdir(join(root, 'installed', id, 'r1'), { recursive: true });
            await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: id, revision: 'r1', version: '1.0', sequence: 1 }));
        }
        await installedModels({ operation: 'select', id: 'model-b' }, directory);
    }
    if (scenario === 'busy') {
        lease = await directoryLock({ operation: 'acquire', path: servicePaths(directory).lock });
    }
    var services = {
        models: async function (action: Parameters<typeof installedModels>[0], storage?: string) {
            var models = await installedModels(action, storage);
            if (action.operation === 'list') {
                modelReads++;
                if (modelReads === 1 && scenario === 'cancel-before-select') {
                    process.emit('SIGINT');
                }
                if (modelReads === 2 && scenario === 'cancel-refresh') {
                    process.emit('SIGTERM');
                }
            }
            return models;
        },
        license: async function (_request: unknown, signal: AbortSignal): ReturnType<typeof manageLicense> {
            licenseCalls++;
            if (scenario === 'missing-license') {
                return { ok: false, message: 'No license saved. Run velora license set.' };
            }
            if (scenario === 'cancel-license') {
                queueMicrotask(function () { process.emit('SIGINT'); });
                await new Promise<void>(function (_resolve, reject) {
                    signal.addEventListener('abort', function () { reject(signal.reason); }, { once: true });
                });
            }
            var models = [];
            for (var id of ['model-a', 'model-b', 'model-c']) {
                models.push({ id, name: id.toUpperCase(), description: '', strengths: '', limitations: '',
                    canDownload: scenario !== 'withdrawn', downloadReason: null });
            }
            if (scenario === 'no-entitlements') {
                models = [];
            }
            if (scenario === 'available-changed') {
                await installedModels({ operation: 'select', id: 'model-a' }, directory);
            }
            return { ok: true, license: 'FIXTURE-PRIVATE-LICENSE', saved: false, expiresAt: '2099-01-01', maxDevices: 10, registeredDevices: 1, models };
        },
        download: async function (options: DownloadOptions) {
            downloads++;
            assert.equal(options.license, 'FIXTURE-PRIVATE-LICENSE');
            assert.equal(options.modelId, 'model-c');
            assert.equal(options.modelName, 'MODEL-C');
            assert.equal(options.root, join(directory, 'models', 'model-c'));
            if (scenario === 'download-failure') {
                throw new Error('Private engine failure: ' + options.license);
            }
            if (scenario === 'cancel-download') {
                queueMicrotask(function () { process.emit('SIGTERM'); });
                await new Promise<void>(function (_resolve, reject) {
                    options.signal.addEventListener('abort', function () { reject(options.signal.reason); }, { once: true });
                });
            }
            options.onProgress({ downloaded: 50, total: 100, message: options.license });
            options.onProgress({ downloaded: 55, total: 100, message: options.license });
            options.onProgress({ downloaded: 95, total: 100, message: options.license });
            options.onProgress({ downloaded: 100, total: 100, message: options.license });
            options.onProgress({ downloaded: 100, total: 100, message: options.license });
            var path = join(options.root, 'installed', 'model-c', 'r1');
            await mkdir(path, { recursive: true });
            await writeFile(join(options.root, 'current.json'), JSON.stringify({ model_id: 'model-c', revision: 'r1', version: '2.0', sequence: 1 }));
            if (scenario === 'interrupt-cleanup') {
                process.emit('SIGINT');
            }
            if (['terminate-cleanup', 'terminate-failed-cleanup'].includes(scenario!)) {
                process.emit('SIGTERM');
            }
            return { path, cleanupRequired: ['cleanup', 'terminate-failed-cleanup'].includes(scenario!) };
        }
    };
    var request: Parameters<typeof modelCommand>[0] = { operation: 'list' };
    if (scenario === 'json') {
        request = { operation: 'list', json: true };
    }
    if (['available', 'available-json', 'available-changed', 'no-entitlements', 'cancel-license', 'cancel-refresh'].includes(scenario!)) {
        request = { operation: 'list', available: true, json: ['available-json', 'available-changed'].includes(scenario!) };
    }
    if (['select', 'select-empty', 'cancel-before-select', 'busy', 'missing-model'].includes(scenario!)) {
        var id = 'model-a';
        if (scenario === 'missing-model') {
            id = 'missing-model';
        }
        request = { operation: 'select', id };
    }
    if (cancelledAfterInstall || ['install', 'already-installed', 'missing-license', 'withdrawn', 'not-entitled', 'invalid-id', 'download-failure', 'cancel-download', 'cleanup'].includes(scenario!)) {
        var id = 'model-c';
        if (scenario === 'already-installed') {
            id = 'model-a';
        }
        if (scenario === 'not-entitled') {
            id = 'unknown-model';
        }
        if (scenario === 'invalid-id') {
            id = '../outside';
        }
        request = { operation: 'install', id };
    }
    await modelCommand(request, directory, services);
    assert.equal(process.listenerCount('SIGINT'), beforeInterrupt);
    assert.equal(process.listenerCount('SIGTERM'), beforeTerminate);
    if (cancelledAfterInstall || ['install', 'cleanup', 'download-failure', 'cancel-download'].includes(scenario!)) {
        assert.equal(downloads, 1);
    } else {
        assert.equal(downloads, 0);
    }
    if (['empty', 'select-empty', 'list', 'json', 'select', 'cancel-before-select', 'busy', 'missing-model', 'already-installed', 'invalid-id'].includes(scenario!)) {
        assert.equal(licenseCalls, 0);
    } else {
        assert.equal(licenseCalls, 1);
    }
    if (scenario === 'select') {
        assert.equal(JSON.parse(await readFile(join(directory, 'selected-model.json'), 'utf8')).id, 'model-a');
    }
    if (scenario === 'cancel-before-select') {
        assert.equal(JSON.parse(await readFile(join(directory, 'selected-model.json'), 'utf8')).id, 'model-b');
    }
    if (cancelledAfterInstall || ['install', 'cleanup'].includes(scenario!)) {
        assert.equal(JSON.parse(await readFile(join(directory, 'selected-model.json'), 'utf8')).id, 'model-b');
        var models = await installedModels({ operation: 'list' }, directory);
        assert.equal(models.length, 3);
    }
} finally {
    if (lease) {
        await directoryLock({ operation: 'release', path: servicePaths(directory).lock, lease });
    }
    await rm(directory, { recursive: true, force: true });
}
