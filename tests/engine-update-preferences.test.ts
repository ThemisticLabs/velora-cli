import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import engineUpdatePreferences from '../src/updates/engine-update-preferences.js';

test('engine update preferences are separate, atomic and cannot install without checks', async function () {
    var root = await mkdtemp(join(tmpdir(), 'velora-preferences-'));
    var path = join(root, 'models', 'skira7alpha', 'engine-updates.json');
    try {
        await engineUpdatePreferences('skira7alpha', { checkAutomatically: true, installAutomatically: false }, root);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: true, installAutomatically: false });
        await expect(engineUpdatePreferences('skira7alpha', { checkAutomatically: false, installAutomatically: true }, root)).rejects.toThrow('Invalid');
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: true, installAutomatically: false });
        await engineUpdatePreferences('skira7alpha', { checkAutomatically: false, installAutomatically: false }, root);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: false, installAutomatically: false });
        expect(await readdir(join(root, 'models', 'skira7alpha'))).toEqual(['engine-updates.json']);
        await expect(engineUpdatePreferences('../outside', { checkAutomatically: true, installAutomatically: true }, root)).rejects.toThrow('Invalid');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('linked models directory cannot redirect update permissions', async function () {
    var { symlink } = await import('node:fs/promises');
    var root = await mkdtemp(join(tmpdir(), 'velora-preferences-'));
    var outside = await mkdtemp(join(tmpdir(), 'velora-outside-'));
    try {
        await symlink(outside, join(root, 'models'), 'junction');
        await expect(engineUpdatePreferences('skira7alpha', { checkAutomatically: true, installAutomatically: true }, root)).rejects.toThrow();
        expect(await readdir(outside)).toEqual([]);
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});
