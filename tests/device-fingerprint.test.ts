import { test, expect, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';
import { join } from 'node:path';
import deviceFingerprint from '../src/system/device-fingerprint.js';

test.each(['saved read-only', 'missing', 'empty', 'unreadable'])('fallback device identity: %s', async function (scenario) {
    var root = await filesystem.mkdtemp(join(os.tmpdir(), 'velora-identity-'));
    var directory = join(root, '.config', 'lizenz-client');
    var path = join(directory, 'geräte_id');
    await filesystem.mkdir(directory, { recursive: true });
    if (scenario !== 'missing') {
        var contents = 'existing-engine-device-id';
        if (scenario === 'empty') {
            contents = '';
        }
        await filesystem.writeFile(path, contents);
    }
    var originalRead = filesystem.readFile;
    var originalTemporary = filesystem.mkdtemp;
    var home = spyOn(os, 'homedir').mockReturnValue(root);
    var hardware = spyOn(childProcess, 'execFile').mockImplementation(function (...args: unknown[]) {
        var callback = args[args.length - 1] as (error: Error) => void;
        callback(new Error('Hardware unavailable in fixture'));
        return {} as ReturnType<typeof childProcess.execFile>;
    });
    var reads = spyOn(filesystem, 'readFile').mockImplementation(async function (target, options) {
        if (target === '/etc/machine-id' || target === path && scenario === 'unreadable') {
            var error = new Error('Fixture permission denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
        }
        return originalRead(target, options);
    });
    var temporary = spyOn(filesystem, 'mkdtemp').mockImplementation(async function (prefix, options) {
        if (scenario === 'saved read-only') {
            throw new Error('Fixture directory is read-only');
        }
        return originalTemporary(prefix, options);
    });
    try {
        if (scenario === 'empty' || scenario === 'unreadable') {
            await expect(deviceFingerprint()).rejects.toThrow();
            expect(temporary).not.toHaveBeenCalled();
            return;
        }
        var first = await deviceFingerprint();
        var second = await deviceFingerprint();
        expect(second.hw).toBe(first.hw);
        var saved = await originalRead(path, 'utf8');
        expect(first.hw).toBe(createHash('sha256').update(saved).digest('hex'));
        if (scenario === 'saved read-only') {
            expect(saved).toBe('existing-engine-device-id');
            expect(temporary).not.toHaveBeenCalled();
        } else {
            expect(saved).toMatch(/^[a-f0-9]{64}$/);
            expect(temporary).toHaveBeenCalledTimes(1);
        }
        expect(await filesystem.readdir(directory)).toEqual(['geräte_id']);
    } finally {
        temporary.mockRestore();
        reads.mockRestore();
        hardware.mockRestore();
        home.mockRestore();
        await filesystem.rm(root, { recursive: true, force: true });
    }
});
