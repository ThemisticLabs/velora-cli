import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm, stat, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import apiKeys from '../src/api/api-keys.js';

test('application keys persist hashes, verify and revoke independently', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-keys-'));
    try {
        expect((await apiKeys({ operation: 'list' }, directory)).keys).toEqual([]);
        var first = await apiKeys({ operation: 'create', name: ' Editor ', note: 'Testing' }, directory);
        var second = await apiKeys({ operation: 'create', name: 'Automation', note: '' }, directory);
        expect(first.key).toMatch(/^velora_[A-Za-z0-9_-]{43}$/);
        expect(first.key).not.toBe(second.key);
        var contents = await readFile(join(directory, 'api-keys.json'), 'utf8');
        expect(contents).not.toContain(first.key!);
        expect(contents).not.toContain(second.key!);
        var listed = await apiKeys({ operation: 'list' }, directory);
        expect(listed.key).toBeUndefined();
        expect(listed.keys[0]?.name).toBe('Editor');
        expect(listed.keys[0]).not.toHaveProperty('digest');
        expect((await apiKeys({ operation: 'verify', key: first.key! }, directory)).authorized).toBe(true);
        expect((await apiKeys({ operation: 'verify', key: 'invalid' }, directory)).authorized).toBe(false);
        await apiKeys({ operation: 'revoke', id: listed.keys[0]!.id }, directory);
        expect((await apiKeys({ operation: 'verify', key: first.key! }, directory)).authorized).toBe(false);
        expect((await apiKeys({ operation: 'verify', key: second.key! }, directory)).authorized).toBe(true);
        if (process.platform !== 'win32') { expect((await stat(join(directory, 'api-keys.json'))).mode & 0o777).toBe(0o600); }
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test.each(['broken', 'linked', 'locked', 'invalid-name', 'control-note'])('API key writes preserve unsafe or unreadable storage: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-guards-'));
    try {
        var path = join(directory, 'api-keys.json');
        var name = 'Editor';
        var note = '';
        if (scenario === 'broken') { await writeFile(path, '{'); }
        if (scenario === 'linked') {
            await writeFile(join(directory, 'outside'), 'keep');
            await symlink(join(directory, 'outside'), path);
        }
        if (scenario === 'locked') { await writeFile(join(directory, '.api-keys.lock'), 'busy'); }
        if (scenario === 'invalid-name') { name = ' '; }
        if (scenario === 'control-note') { note = '\u001b[2J'; }
        await expect(apiKeys({ operation: 'create', name, note }, directory)).rejects.toThrow();
        if (scenario === 'broken') { expect(await readFile(path, 'utf8')).toBe('{'); }
        if (scenario === 'linked') { expect(await readFile(join(directory, 'outside'), 'utf8')).toBe('keep'); }
        if (scenario === 'locked') { expect(await readFile(join(directory, '.api-keys.lock'), 'utf8')).toBe('busy'); }
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('API key storage rejects linked directories', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-link-'));
    try {
        await mkdir(join(directory, 'outside'));
        await symlink(join(directory, 'outside'), join(directory, 'linked'), 'junction');
        await expect(apiKeys({ operation: 'create', name: 'Editor', note: '' }, join(directory, 'linked'))).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test.each(['primary-corrupt', 'backup-corrupt', 'primary-missing', 'primary-older', 'checksum-mismatch'])('API key recovery keeps the newest committed revision: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-recovery-'));
    try {
        var first = await apiKeys({ operation: 'create', name: 'Editor', note: '' }, directory);
        var path = join(directory, 'api-keys.json');
        var older = await readFile(path, 'utf8');
        var second = await apiKeys({ operation: 'create', name: 'Build', note: '' }, directory);
        await apiKeys({ operation: 'revoke', id: first.keys[0]!.id }, directory);
        if (scenario === 'primary-corrupt') { await writeFile(path, '{'); }
        if (scenario === 'backup-corrupt') { await writeFile(path + '.backup', '{'); }
        if (scenario === 'primary-missing') { await rm(path); }
        if (scenario === 'primary-older') { await writeFile(path, older); }
        if (scenario === 'checksum-mismatch') {
            var modified = JSON.parse(await readFile(path, 'utf8'));
            modified.keys = JSON.parse(older).keys;
            await writeFile(path, JSON.stringify(modified));
        }
        expect((await apiKeys({ operation: 'verify', key: first.key! }, directory)).authorized).toBe(false);
        expect((await apiKeys({ operation: 'verify', key: second.key! }, directory)).authorized).toBe(true);
        var third = await apiKeys({ operation: 'create', name: 'Recovered', note: '' }, directory);
        expect(third.keys.length).toBe(2);
        expect(await readFile(path, 'utf8')).toBe(await readFile(path + '.backup', 'utf8'));
        if (process.platform !== 'win32') { expect((await stat(path + '.backup')).mode & 0o777).toBe(0o600); }
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('API key storage migrates legacy hashes and refuses to replace two corrupt copies', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-migration-'));
    try {
        var created = await apiKeys({ operation: 'create', name: 'Legacy', note: '' }, directory);
        var path = join(directory, 'api-keys.json');
        var stored = JSON.parse(await readFile(path, 'utf8'));
        await writeFile(path, JSON.stringify(stored.keys));
        await rm(path + '.backup');
        expect((await apiKeys({ operation: 'verify', key: created.key! }, directory)).authorized).toBe(true);
        await apiKeys({ operation: 'create', name: 'New', note: '' }, directory);
        expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1);
        await writeFile(path, '{');
        await writeFile(path + '.backup', 'broken');
        await expect(apiKeys({ operation: 'create', name: 'Unsafe', note: '' }, directory)).rejects.toThrow('Restore a valid copy');
        expect(await readFile(path, 'utf8')).toBe('{');
        expect(await readFile(path + '.backup', 'utf8')).toBe('broken');
    } finally { await rm(directory, { recursive: true, force: true }); }
});


test('API key writes recover a lock after its owning process is killed', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-crash-lock-'));
    var source = new URL('../src/system/directory-lock.ts', import.meta.url).href;
    var script = 'import directoryLock from ' + JSON.stringify(source) + ';';
    script += 'await directoryLock({ operation: "acquire", path: ' + JSON.stringify(join(directory, '.api-keys.lock')) + ' });';
    script += 'process.stdout.write("ready\\n"); await Bun.sleep(60000);';
    var child = Bun.spawn([process.execPath, '-e', script], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    try {
        var reader = child.stdout.getReader();
        var ready = await reader.read();
        reader.releaseLock();
        expect(new TextDecoder().decode(ready.value)).toBe('ready\n');
        await expect(apiKeys({ operation: 'create', name: 'Blocked', note: '' }, directory)).rejects.toThrow('Another operation');
        child.kill('SIGKILL');
        await child.exited;
        var created = await apiKeys({ operation: 'create', name: 'Recovered', note: '' }, directory);
        expect((await apiKeys({ operation: 'verify', key: created.key! }, directory)).authorized).toBe(true);
        await apiKeys({ operation: 'revoke', id: created.keys[0]!.id }, directory);
        expect((await apiKeys({ operation: 'verify', key: created.key! }, directory)).authorized).toBe(false);
    } finally {
        child.kill('SIGKILL');
        await child.exited;
        await rm(directory, { recursive: true, force: true });
    }
});
