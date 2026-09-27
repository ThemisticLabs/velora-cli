import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import engineUpdatePreferences from '../src/updates/engine-update-preferences.js';

test('engine update preferences are separate, atomic and cannot install without checks', async function () {
    var root = await mkdtemp(join(tmpdir(), 'velora-preferences-'));
    var path = join(root, 'engine-updates.json');
    try {
        await engineUpdatePreferences({ checkAutomatically: true, installAutomatically: false }, root);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: true, installAutomatically: false });
        await expect(engineUpdatePreferences({ checkAutomatically: false, installAutomatically: true }, root)).rejects.toThrow('requires update checks');
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: true, installAutomatically: false });
        await engineUpdatePreferences({ checkAutomatically: false, installAutomatically: false }, root);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: false, installAutomatically: false });
        expect(await readdir(root)).toEqual(['engine-updates.json']);
        expect(await engineUpdatePreferences(undefined, root)).toEqual({ checkAutomatically: false, installAutomatically: false });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('linked storage directory cannot redirect update permissions', async function () {
    var { symlink } = await import('node:fs/promises');
    var root = await mkdtemp(join(tmpdir(), 'velora-preferences-'));
    var outside = await mkdtemp(join(tmpdir(), 'velora-outside-'));
    try {
        await symlink(outside, join(root, 'linked'), 'junction');
        await expect(engineUpdatePreferences({ checkAutomatically: true, installAutomatically: true }, join(root, 'linked'))).rejects.toThrow();
        expect(await readdir(outside)).toEqual([]);
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});
