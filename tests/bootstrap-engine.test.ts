import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bootstrapEngine from '../src/engine/bootstrap-engine.js';
import enginePackage from './fixtures/engine-package.js';

test.each(['valid', 'bad response signature', 'wrong nonce', 'wrong range', 'truncated', 'wrong checksum',
    'wrong manifest', 'bad manifest signature', 'wrong inventory hash', 'unsafe path', 'linked entry', 'extra entry', 'withdrawn'])('engine bootstrap: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-bootstrap-'));
    try {
        var fixture = await enginePackage(scenario);
        var options = { directory, transport: fixture.transport, publicKey: fixture.publicKey, target: 'macosx-14.0-arm64' };
        var controller = new AbortController();
        var task = bootstrapEngine('FIXTURE-LICENSE', controller.signal, undefined, options);
        if (scenario !== 'valid') {
            await expect(task).rejects.toBeInstanceOf(Error);
            expect(await readdir(join(directory, 'engine'))).toEqual([]);
            return;
        }
        var result = await task;
        expect(await readFile(result.executable, 'utf8')).toContain('synthetic engine');
        var count = fixture.requests.length;
        expect((await bootstrapEngine('FIXTURE-LICENSE', controller.signal, undefined, options)).executable).toBe(result.executable);
        expect(fixture.requests.length).toBe(count);
        await writeFile(result.executable, 'tampered');
        await expect(bootstrapEngine('FIXTURE-LICENSE', controller.signal, undefined, options)).rejects.toThrow('changed');
        expect(fixture.requests.length).toBe(count);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('cancelled bootstrap publishes nothing and releases its lock', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-cancel-'));
    try {
        var fixture = await enginePackage();
        var controller = new AbortController();
        await expect(bootstrapEngine('FIXTURE-LICENSE', controller.signal, function (progress) {
            if (progress.downloaded > 0) { controller.abort(); }
        }, { ...fixture, directory, target: 'macosx-14.0-arm64' })).rejects.toBeInstanceOf(Error);
        expect(await readdir(join(directory, 'engine'))).toEqual([]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test.each(['valid', 'bad manifest signature', 'withdrawn', 'cancel', 'downgrade', 'changed version'])('engine replacement preserves the previous installation: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-replace-'));
    try {
        var initial = await enginePackage();
        var old = await bootstrapEngine('FIXTURE-LICENSE', new AbortController().signal, undefined, {
            directory, transport: initial.transport, publicKey: initial.publicKey, target: 'macosx-14.0-arm64'
        });
        var fixtureScenario = 'valid';
        if (scenario === 'bad manifest signature' || scenario === 'withdrawn') { fixtureScenario = scenario; }
        var version = '0.4.2';
        if (scenario === 'downgrade') { version = '0.4.0'; }
        var next = await enginePackage(fixtureScenario, version, 'engine-r2', 2);
        var controller = new AbortController();
        var expectedVersion = version;
        if (scenario === 'changed version') { expectedVersion = '0.4.3'; }
        var task = bootstrapEngine('FIXTURE-LICENSE', controller.signal, function (progress) {
            if (scenario === 'cancel' && progress.downloaded) { controller.abort(); }
        }, { directory, transport: next.transport, publicKey: next.publicKey, target: 'macosx-14.0-arm64', update: true, expectedVersion });
        if (scenario === 'valid') { expect((await task).release.version).toBe('0.4.2'); }
        else { await expect(task).rejects.toBeInstanceOf(Error); }
        var saved = JSON.parse(await readFile(join(directory, 'engine', 'bootstrap.json'), 'utf8'));
        var expected = '0.4.1';
        if (scenario === 'valid') { expected = '0.4.2'; }
        expect(saved.version).toBe(expected);
        expect(await readFile(old.executable, 'utf8')).toContain('synthetic engine');
        expect(await readdir(join(directory, 'engine'))).not.toContain('.bootstrap.lock');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
