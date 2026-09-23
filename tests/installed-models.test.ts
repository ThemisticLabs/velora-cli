import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import installedModels from '../src/models/installed-models.js';

test('selection survives restart and deletion removes only the chosen package', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-models-'));
    try {
        expect(await installedModels({ operation: 'list' }, directory)).toEqual([]);
        for (var id of ['model-a', 'model-b']) {
            var root = join(directory, 'models', id);
            await mkdir(join(root, 'installed', id, 'r1'), { recursive: true });
            await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: id, model_name: id.toUpperCase(), revision: 'r1', version: '1', sequence: 1, engine_version: '0.1.1' }));
            await writeFile(join(root, 'engine-updates.json'), '{}');
        }
        await writeFile(join(directory, 'cli-updates.json'), 'keep');
        await installedModels({ operation: 'select', id: 'model-b' }, directory);
        var models = await installedModels({ operation: 'list' }, directory);
        expect(models[1]?.selected).toBe(true);
        expect(models[1]?.name).toBe('MODEL-B');
        await installedModels({ operation: 'delete', id: 'model-b' }, directory);
        expect(await readdir(join(directory, 'models'))).toEqual(['model-a']);
        expect(await readFile(join(directory, 'cli-updates.json'), 'utf8')).toBe('keep');
        expect((await installedModels({ operation: 'list' }, directory))[0]?.selected).toBe(false);
        await installedModels({ operation: 'select', id: 'model-a' }, directory);
        expect((await installedModels({ operation: 'list' }, directory))[0]?.selected).toBe(true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test.each(['busy', 'linked root', 'linked package', 'invalid id', 'missing package'])('model mutations reject unsafe state: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-model-guard-'));
    try {
        var root = join(directory, 'models', 'model-a');
        var packagePath = join(root, 'installed', 'model-a', 'r1');
        await mkdir(packagePath, { recursive: true });
        await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: 'model-a', revision: 'r1', version: '1', sequence: 1 }));
        await mkdir(join(directory, 'outside'));
        await writeFile(join(directory, 'outside', 'keep'), 'safe');
        if (scenario === 'busy') {
            await writeFile(join(root, '.update.lock'), 'busy');
        }
        if (scenario === 'linked root') {
            await rm(root, { recursive: true });
            await symlink(join(directory, 'outside'), root, 'junction');
        }
        if (scenario === 'linked package') {
            await rm(packagePath, { recursive: true });
            await symlink(join(directory, 'outside'), packagePath, 'junction');
        }
        if (scenario === 'missing package') {
            await rm(packagePath, { recursive: true });
        }
        var id = 'model-a';
        if (scenario === 'invalid id') {
            id = '../../outside';
        }
        await expect(installedModels({ operation: 'delete', id }, directory)).rejects.toThrow();
        await expect(installedModels({ operation: 'select', id }, directory)).rejects.toThrow();
        expect(await readFile(join(directory, 'outside', 'keep'), 'utf8')).toBe('safe');
        if (scenario === 'busy') {
            expect(await readFile(join(root, '.update.lock'), 'utf8')).toBe('busy');
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
