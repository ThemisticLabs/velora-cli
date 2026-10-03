import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import setupProgress from '../src/setup/setup-progress.js';

test('setup progress resumes without storing credentials', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-setup-state-'));
    try {
        expect(await setupProgress(undefined, directory)).toBe(0);
        await setupProgress(3, directory);
        expect(await setupProgress(undefined, directory)).toBe(3);
        expect(JSON.parse(await readFile(join(directory, 'setup.json'), 'utf8'))).toEqual({ step: 3 });
        if (process.platform !== 'win32') { expect((await stat(join(directory, 'setup.json'))).mode & 0o777).toBe(0o600); }
        await expect(setupProgress(5, directory)).rejects.toThrow('Invalid setup step');
        expect(await setupProgress(undefined, directory)).toBe(3);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt progress is not reset and linked storage is rejected', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-setup-invalid-'));
    try {
        var path = join(directory, 'setup.json');
        await writeFile(path, '{broken');
        await expect(setupProgress(undefined, directory)).rejects.toThrow('Could not read setup.json');
        expect(await readFile(path, 'utf8')).toBe('{broken');
        if (process.platform === 'win32') { return; }
        await symlink(directory, join(directory, 'linked'));
        await expect(setupProgress(1, join(directory, 'linked'))).rejects.toThrow('symbolic link');
        expect(await readFile(path, 'utf8')).toBe('{broken');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
