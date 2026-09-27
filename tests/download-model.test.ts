import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import downloadModel from '../src/downloads/download-model.js';
import installedModels from '../src/models/installed-models.js';
import type engineSession from '../src/engine/engine-session.js';

test.each(['valid', 'unconfirmed', 'wrong model', 'wrong path', 'wrong revision', 'cancel', 'retry'])('engine model installation: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-install-'));
    var root = join(directory, 'models', 'model-a');
    var path = join(root, 'installed', 'model-a', 'r1');
    var controller = new AbortController();
    var closed = false;
    var operations: string[] = [];
    try {
        var connect = async function () {
            return {
                installation: { packagePath: join(directory, 'engine-package'), release: { version: '0.4.1' } },
                request: async function (operation: string, fields: Record<string, unknown>) {
                    operations.push(operation);
                    if (operation === 'models') {
                        expect(fields).toEqual({ license_key: 'FIXTURE-LICENSE' });
                        return {};
                    }
                    expect(fields).toEqual({ model_id: 'model-a', root: join(directory, 'models'), engine_package: join(directory, 'engine-package'), progress: true });
                    await mkdir(path, { recursive: true });
                    await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: 'model-a', revision: 'r1', sequence: 1, highest_sequences: { 'model-a': 1 } }));
                    if (scenario === 'cancel') {
                        controller.abort();
                        throw controller.signal.reason;
                    }
                    var receipt = { model_id: 'model-a', model_revision: 'r1', engine_revision: 'engine-r1', license_authorized: true, reported_hashes_match: true };
                    if (scenario === 'unconfirmed') { receipt.license_authorized = false; }
                    if (scenario === 'wrong revision') { receipt.model_revision = 'r2'; }
                    var result = { model_id: 'model-a', model_version: '1.0', engine_version: '0.4.1', path, files_verified: true, receipt };
                    if (scenario === 'wrong path') { result.path = '/outside'; }
                    if (scenario === 'wrong model') { result.model_id = 'other-model'; }
                    return result;
                },
                close: async function () { closed = true; }
            };
        } as unknown as typeof engineSession;
        if (scenario === 'retry') {
            await mkdir(path, { recursive: true });
            await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: 'model-a', revision: 'r1', sequence: 1 }));
            expect(await installedModels({ operation: 'list' }, directory)).toEqual([]);
        }
        var options = { license: 'FIXTURE-LICENSE', modelId: 'model-a', modelName: 'Model A', root, signal: controller.signal, onProgress: function () {}, connect };
        var task = downloadModel(options);
        if (['valid', 'retry'].includes(scenario)) {
            expect((await task).path).toBe(path);
            expect((await installedModels({ operation: 'list' }, directory))[0]?.name).toBe('Model A');
            expect(JSON.parse(await readFile(join(root, 'current.json'), 'utf8')).version).toBeUndefined();
            await expect(downloadModel(options)).rejects.toThrow('already installed');
        } else {
            await expect(task).rejects.toBeInstanceOf(Error);
            expect(await installedModels({ operation: 'list' }, directory)).toEqual([]);
        }
        expect(operations).toEqual(['models', 'install']);
        expect(closed).toBe(true);
        expect(await readdir(join(directory, 'models'))).not.toContain('.velora.lock');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test.each(['valid', 'unconfirmed', 'cancel', 'changed release'])('model replacement preserves confirmed selection: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-replace-'));
    var root = join(directory, 'models', 'model-a');
    var controller = new AbortController();
    var revision = 'r1';
    var sequence = 1;
    var closed = false;
    var connect = async function () {
        return {
            installation: { packagePath: join(directory, 'engine-package'), release: { version: '0.4.3' } },
            request: async function (operation: string) {
                if (operation === 'models') { return {}; }
                var path = join(root, 'installed', 'model-a', revision);
                await mkdir(path, { recursive: true });
                await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: 'model-a', revision, sequence, highest_sequences: { 'model-a': sequence } }));
                if (sequence === 2 && scenario === 'cancel') {
                    controller.abort();
                    throw controller.signal.reason;
                }
                var authorized = true;
                if (sequence === 2 && scenario === 'unconfirmed') { authorized = false; }
                return { model_id: 'model-a', model_version: String(sequence), engine_version: '0.4.3', path, files_verified: true,
                    receipt: { model_id: 'model-a', model_revision: revision, engine_revision: 'engine-r1', license_authorized: authorized, reported_hashes_match: true } };
            },
            close: async function () { closed = true; }
        };
    } as unknown as typeof engineSession;
    try {
        var options = { license: 'FIXTURE-LICENSE', modelId: 'model-a', root, signal: controller.signal, onProgress: function () {}, connect };
        await downloadModel(options);
        await installedModels({ operation: 'select', id: 'model-a' }, directory);
        revision = 'r2';
        sequence = 2;
        closed = false;
        var expectedRevision = 'r2';
        if (scenario === 'changed release') { expectedRevision = 'r3'; }
        var task = downloadModel({ ...options, update: { version: '2', revision: expectedRevision, sequence: 2 } });
        var expectedVersion = '1';
        if (scenario === 'valid') {
            await task;
            expectedVersion = '2';
        } else {
            await expect(task).rejects.toBeInstanceOf(Error);
        }
        var models = await installedModels({ operation: 'list' }, directory);
        expect(models[0]?.version).toBe(expectedVersion);
        expect(models[0]?.selected).toBe(true);
        expect(closed).toBe(true);
        expect(JSON.parse(await readFile(join(root, 'current.json'), 'utf8')).highest_sequences['model-a']).toBe(2);
        expect(await readdir(join(root, 'installed', 'model-a'))).toContain('r1');
        expect(await readdir(join(directory, 'models'))).not.toContain('.velora.lock');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
