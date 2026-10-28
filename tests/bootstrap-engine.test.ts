import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bootstrapEngine from '../src/engine/bootstrap-engine.js';
import enginePackage from './fixtures/engine-package.js';
import type { EngineProgress } from '../src/engine/bootstrap-engine.js';

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
        expect((await bootstrapEngine('', controller.signal, undefined, { ...options, installedOnly: true })).executable).toBe(result.executable);
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

test.each(['runtime', 'inventory', 'extra file'])('cached engine skips its transport archive and still rejects tampering: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-cached-engine-'));
    try {
        var fixture = await enginePackage();
        var options = { directory, transport: fixture.transport, publicKey: fixture.publicKey, target: 'macosx-14.0-arm64' };
        var signal = new AbortController().signal;
        var installed = await bootstrapEngine('FIXTURE-LICENSE', signal, undefined, options);
        for (var name of Object.keys(fixture.files)) {
            if (name.endsWith('.zip')) { await rm(join(installed.packagePath, name)); }
        }
        expect((await bootstrapEngine('FIXTURE-LICENSE', signal, undefined, options)).executable).toBe(installed.executable);
        if (scenario === 'runtime') {
            var content = await readFile(installed.executable);
            content[0] = content[0]! ^ 1;
            await writeFile(installed.executable, content);
        }
        if (scenario === 'inventory') { await writeFile(join(installed.packagePath, 'inventory.json'), '{}'); }
        if (scenario === 'extra file') { await writeFile(join(installed.runtimePath, 'unexpected'), 'untrusted'); }
        await expect(bootstrapEngine('FIXTURE-LICENSE', signal, undefined, options)).rejects.toBeInstanceOf(Error);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('engine preparation reports extraction and cached file verification progress', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-engine-progress-'));
    try {
        var content = Buffer.alloc(3 * 1024 ** 2, 'x');
        var fixture = await enginePackage('valid', '0.4.1', 'engine-r1', 1, content);
        var options = { directory, transport: fixture.transport, publicKey: fixture.publicKey, target: 'macosx-14.0-arm64' };
        var signal = new AbortController().signal;
        var events: EngineProgress[] = [];
        var progress = function (event: EngineProgress) { events.push(event); };
        await bootstrapEngine('FIXTURE-LICENSE', signal, progress, options);
        var extracted = false;
        for (var event of events) {
            expect(event.message).not.toBe('Verifying the engine files.');
            if (event.message === 'Preparing the engine runtime.' && event.downloaded === content.length && event.total === content.length) {
                extracted = true;
            }
        }
        expect(extracted).toBe(true);
        events = [];
        await bootstrapEngine('FIXTURE-LICENSE', signal, progress, options);
        var verified = false;
        for (var event of events) {
            if (event.message === 'Verifying the engine files.' && event.downloaded === content.length && event.total === content.length) {
                verified = true;
            }
        }
        expect(verified).toBe(true);
        var controller = new AbortController();
        await expect(bootstrapEngine('FIXTURE-LICENSE', controller.signal, function (event) {
            if (event.message === 'Verifying the engine files.') { controller.abort(); }
        }, options)).rejects.toBeInstanceOf(Error);
        expect(await readdir(join(directory, 'engine'))).not.toContain('.bootstrap.lock');
    } finally { await rm(directory, { recursive: true, force: true }); }
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


test('diagnostics never download a missing engine', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-doctor-bootstrap-'));
    try {
        var fixture = await enginePackage();
        await expect(bootstrapEngine('FIXTURE-LICENSE', new AbortController().signal, undefined, {
            directory, target: 'macosx-14.0-arm64', transport: fixture.transport, installedOnly: true
        })).rejects.toThrow('No installed engine');
        expect(fixture.requests.length).toBe(0);
        expect(await readdir(directory)).toEqual([]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
