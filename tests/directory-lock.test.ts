import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import directoryLock from '../src/system/directory-lock.js';

var moduleUrl = new URL('../src/system/directory-lock.ts', import.meta.url).href;

test('live owners block claims and handoff uses distinct owner files', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-lock-'));
    var path = join(directory, 'lock');
    try {
        var first = await directoryLock({ operation: 'acquire', path });
        await expect(directoryLock({ operation: 'acquire', path })).rejects.toThrow('Another operation');
        var second = await directoryLock({ operation: 'acquire', path, token: first.token });
        expect(second.owner).not.toBe(first.owner);
        await directoryLock({ operation: 'release', path, lease: first });
        await expect(directoryLock({ operation: 'acquire', path })).rejects.toThrow('Another operation');
        await directoryLock({ operation: 'release', path, lease: second });
        var next = await directoryLock({ operation: 'acquire', path });
        expect(next.token).not.toBe(first.token);
        await directoryLock({ operation: 'release', path, lease: next });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('a killed owner is reclaimed and simultaneous claims keep one live owner', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-lock-crash-'));
    var path = join(directory, 'lock');
    var child = Bun.spawn([process.execPath, '-e', 'var lock = (await import(' + JSON.stringify(moduleUrl) + ')).default; await lock({operation:"acquire",path:process.argv[1]}); console.log("ready"); setInterval(function(){},1000);', path], { stdout: 'pipe', stderr: 'pipe' });
    try {
        var reader = child.stdout.getReader();
        var ready = await reader.read();
        expect(new TextDecoder().decode(ready.value)).toBe('ready\n');
        child.kill('SIGKILL');
        await child.exited;
        var results = await Promise.allSettled([
            directoryLock({ operation: 'acquire', path }),
            directoryLock({ operation: 'acquire', path }),
            directoryLock({ operation: 'acquire', path })
        ]);
        var acquired = 0;
        for (var result of results) {
            if (result.status === 'fulfilled') {
                acquired++;
                await directoryLock({ operation: 'release', path, lease: result.value });
            }
        }
        expect(acquired).toBe(1);
    } finally {
        child.kill();
        await child.exited;
        await rm(directory, { recursive: true, force: true });
    }
});

test('old lock files are preserved rather than guessed to be stale', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-lock-old-'));
    var path = join(directory, 'lock');
    try {
        await writeFile(path, 'old lock');
        await expect(directoryLock({ operation: 'acquire', path })).rejects.toThrow('older or invalid');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
