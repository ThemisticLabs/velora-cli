import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import autostart from '../src/system/autostart.js';

test('macOS login setup uses the normal headless command without starting it', async function () {
    var home = await mkdtemp(join(tmpdir(), 'velora-login-'));
    try {
        expect(await autostart(undefined, home, 'darwin')).toEqual({ supported: true, enabled: false });
        expect(await autostart(true, home, 'darwin')).toEqual({ supported: true, enabled: true });
        var path = join(home, 'Library', 'LaunchAgents', 'com.themistic.velora.plist');
        var contents = await readFile(path, 'utf8');
        expect(contents).toContain('<key>RunAtLoad</key><true/>');
        expect(contents).toContain('<string>serve</string>');
        expect(contents).toContain('<string>start</string>');
        expect(contents).toContain('<string>--headless</string>');
        expect(contents).not.toContain('KeepAlive');
        if (process.platform === 'darwin') {
            var child = Bun.spawn(['/usr/bin/plutil', '-lint', path], { stdout: 'pipe', stderr: 'pipe' });
            expect(await child.exited).toBe(0);
        }
        await autostart(true, home, 'darwin');
        expect(await readFile(path, 'utf8')).toBe(contents);
        await autostart(false, home, 'darwin');
        expect(await autostart(undefined, home, 'darwin')).toEqual({ supported: true, enabled: false });
        expect(await readdir(join(home, 'Library', 'LaunchAgents'))).toEqual([]);
    } finally { await rm(home, { recursive: true, force: true }); }
});

test('unavailable platforms do not register an ineffective login item', async function () {
    var home = await mkdtemp(join(tmpdir(), 'velora-login-platform-'));
    try {
        expect(await autostart(true, home, 'linux')).toEqual({ supported: false, enabled: false });
        expect(await autostart(true, home, 'win32')).toEqual({ supported: false, enabled: false });
        expect(await readdir(home)).toEqual([]);
    } finally { await rm(home, { recursive: true, force: true }); }
});

test('unexpected login files and linked directories are kept intact', async function () {
    var home = await mkdtemp(join(tmpdir(), 'velora-login-invalid-'));
    try {
        var directory = join(home, 'Library', 'LaunchAgents');
        await mkdir(directory, { recursive: true });
        var path = join(directory, 'com.themistic.velora.plist');
        await writeFile(path, 'unrelated content');
        await expect(autostart(true, home, 'darwin')).rejects.toThrow('Could not read');
        await expect(autostart(false, home, 'darwin')).rejects.toThrow('Could not read');
        expect(await readFile(path, 'utf8')).toBe('unrelated content');
        if (process.platform === 'win32') { return; }
        var linkedHome = join(home, 'linked-home');
        await mkdir(join(linkedHome, 'Library'), { recursive: true });
        await symlink(directory, join(linkedHome, 'Library', 'LaunchAgents'));
        await expect(autostart(false, linkedHome, 'darwin')).rejects.toThrow('Could not read');
        expect(await readFile(path, 'utf8')).toBe('unrelated content');
    } finally { await rm(home, { recursive: true, force: true }); }
});
