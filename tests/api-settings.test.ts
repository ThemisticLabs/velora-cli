import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import apiSettings from '../src/api/api-settings.js';

test('API port defaults without writing and persists valid changes', async function () {
    var root = await mkdtemp(join(tmpdir(), 'velora-api-settings-'));
    try {
        expect(await apiSettings(undefined, root)).toEqual({ port: 8001 });
        expect(await readdir(root)).toEqual([]);
        await apiSettings(9000, root);
        expect(await apiSettings(undefined, root)).toEqual({ port: 9000 });
        expect(JSON.parse(await readFile(join(root, 'api.json'), 'utf8'))).toEqual({ port: 9000 });
        expect(await readdir(root)).toEqual(['api.json']);
        for (var port of [0, -1, 65536, 1.5, NaN, Infinity]) {
            await expect(apiSettings(port, root)).rejects.toThrow('Choose a port');
            expect(await apiSettings(undefined, root)).toEqual({ port: 9000 });
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('damaged API settings never silently fall back to another port', async function () {
    var root = await mkdtemp(join(tmpdir(), 'velora-api-settings-'));
    try {
        for (var contents of ['{broken', '{}', 'null', '{"port":"9000"}', '{"port":0}', '{"port":65536}']) {
            await writeFile(join(root, 'api.json'), contents);
            await expect(apiSettings(undefined, root)).rejects.toThrow();
            expect(await readFile(join(root, 'api.json'), 'utf8')).toBe(contents);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('API settings cannot write through a linked storage directory', async function () {
    var root = await mkdtemp(join(tmpdir(), 'velora-api-settings-'));
    try {
        var outside = join(root, 'outside');
        await apiSettings(9000, outside);
        var original = await readFile(join(outside, 'api.json'), 'utf8');
        var linked = join(root, 'linked');
        await symlink(outside, linked, 'junction');
        await expect(apiSettings(9001, linked)).rejects.toThrow('symbolic link');
        expect(await readFile(join(outside, 'api.json'), 'utf8')).toBe(original);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
