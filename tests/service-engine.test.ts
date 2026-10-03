import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import serviceEngine from '../src/service/service-engine.js';
import runServiceWorker from '../src/service/service-worker.js';
import serviceControl from '../src/service/service-control.js';
import servicePaths from '../src/service/service-paths.js';
import engineSession from '../src/engine/engine-session.js';
import enginePackage from './fixtures/engine-package.js';
import apiKeys from '../src/api/api-keys.js';
import apiServer from '../src/api/api-server.js';
import licenseStore from '../src/license/license-store.js';
import type { InstalledModel } from '../src/models/installed-models.js';

var root: string;
var executable: string;
var fixture: Awaited<ReturnType<typeof enginePackage>>;
beforeAll(async function () {
    root = await mkdtemp(join(tmpdir(), 'velora-service-engine-'));
    executable = join(root, 'engine');
    if (process.platform === 'win32') { executable += '.exe'; }
    var build = Bun.spawn([process.execPath, 'build', resolve('tests/fixtures/engine-process.ts'), '--compile', '--outfile', executable], { stdout: 'ignore', stderr: 'ignore' });
    expect(await build.exited).toBe(0);
    fixture = await enginePackage();
}, 60000);
afterAll(async function () { await rm(root, { recursive: true, force: true }); });

var model: InstalledModel = { id: 'model-a', name: 'Model A', revision: 'r1', version: '1', sequence: 1, engineVersion: '0.4.1', selected: true };

test('service loads once, retains the real engine session and shuts it down', async function () {
    var directory = await mkdtemp(join(root, 'live-'));
    var operations: string[] = [];
    var connected: Awaited<ReturnType<typeof engineSession>> | undefined;
    var ready: Awaited<ReturnType<typeof serviceEngine>> | undefined;
    var services = {
        models: async function () { return [model]; },
        store: async function () { return 'FIXTURE-LICENSE'; },
        connect: async function (key: string, signal: AbortSignal) {
            connected = await engineSession(key, signal, undefined, async function () {
                return { executable, packagePath: root, runtimePath: root, release: fixture.release, target: fixture.release.runtime_target };
            });
            var request = connected.request;
            connected.request = async function (operation, fields) {
                operations.push(operation);
                if (operation === 'load') {
                    expect(fields?.model).toBe(join(directory, 'models', 'model-a', 'installed', 'model-a', 'r1'));
                    expect(fields?.options).toEqual({ license_key: 'FIXTURE-LICENSE' });
                }
                return request(operation, fields);
            };
            return connected;
        }
    };
    var worker = serviceWorker(directory, async function (path, signal) {
        ready = await serviceEngine(path, signal, services);
        return ready;
    });
    try {
        var started = Date.now();
        while ((await serviceControl('status', directory)).state !== 'running') {
            if (Date.now() - started > 5000) { throw new Error('Engine did not become ready'); }
            await Bun.sleep(20);
        }
        expect(await serviceControl('status', directory)).toMatchObject({ state: 'running', pid: process.pid, model: 'model-a', engineVersion: '0.4.1' });
        expect(operations).toEqual(['load']);
        expect(await serviceControl('start', directory)).toMatchObject({ state: 'running', pid: process.pid, model: 'model-a', engineVersion: '0.4.1' });
        expect(operations).toEqual(['load']);
        expect(await ready?.request('models')).toEqual({ status: 'ok', models: [] });
        var status = await serviceControl('status', directory);
        if (status.state !== 'running') { throw new Error('Service is not ready'); }
        var key = await apiKeys({ operation: 'create', name: 'Fixture HTTP app', note: '' }, directory);
        var response = await fetch('http://127.0.0.1:' + status.port + '/anonymize', {
            method: 'POST', headers: { Authorization: 'Bearer ' + key.key, 'Content-Type': 'application/json' }, body: '{"text":"Plain text."}'
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ text: 'Plain text.' });
        await expect(ready!.request('predict', { text: 'a'.repeat(2 * 1024 ** 2) })).rejects.toThrow('size limit');
        expect(await ready!.request('models')).toEqual({ status: 'ok', models: [] });
        await serviceControl('stop', directory);
        await worker;
        expect(operations).toEqual(['load', 'models', 'predict', 'predict', 'models', 'shutdown']);
        await connected?.exited;
    } finally {
        await serviceControl('stop', directory);
        await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
    }
}, 15000);

test('a live service reports an engine crash as failed until explicitly stopped', async function () {
    var directory = await mkdtemp(join(root, 'crash-'));
    var context: Awaited<ReturnType<typeof serviceEngine>> | undefined;
    var worker = serviceWorker(directory, async function () {
        var session = await engineSession('FIXTURE-LICENSE', new AbortController().signal, undefined, async function () {
            return { executable, packagePath: root, runtimePath: root, release: fixture.release, target: fixture.release.runtime_target };
        });
        context = { model: 'model-a', engineVersion: '0.4.1', request: session.request, close: session.close, exited: session.exited };
        return context;
    });
    try {
        var started = Date.now();
        while ((await serviceControl('status', directory)).state !== 'running') {
            if (Date.now() - started > 5000) { throw new Error('Engine did not become ready'); }
            await Bun.sleep(20);
        }
        var before = await serviceControl('status', directory);
        if (before.state !== 'running') { throw new Error('Service is not ready'); }
        var key = await apiKeys({ operation: 'create', name: 'Crash fixture app', note: '' }, directory);
        await expect(context!.request('fixture_exit')).rejects.toThrow('stopped');
        await context!.exited;
        expect((await serviceControl('status', directory)).state).toBe('failed');
        var response = await fetch('http://127.0.0.1:' + before.port + '/anonymize', {
            method: 'POST', headers: { Authorization: 'Bearer ' + key.key, 'Content-Type': 'application/json' }, body: '{"text":"hello"}'
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ error: { code: 'service_unavailable' } });
        await expect(serviceControl('start', directory)).rejects.toThrow('Stop the service');
    } finally {
        await serviceControl('stop', directory);
        await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
    }
}, 15000);

test('missing model stops startup before reading the credential store', async function () {
    var reads = 0;
    await expect(serviceEngine(root, new AbortController().signal, {
        store: async function () { reads++; return 'FIXTURE-LICENSE'; },
        models: async function () { return []; },
        connect: engineSession
    })).rejects.toThrow('Select an installed model');
    expect(reads).toBe(0);
});

test('missing license does not launch the engine', async function () {
    await expect(serviceEngine(root, new AbortController().signal, {
        store: async function () { return null; },
        models: async function () { return [model]; },
        connect: async function () { throw new Error('Unexpected engine launch'); }
    })).rejects.toThrow('Save a license');
});

test('stopping during a credential prompt cancels startup without launching an engine', async function () {
    var directory = await mkdtemp(join(root, 'credential-wait-'));
    var reading = false;
    var worker = serviceWorker(directory, function (path, signal) {
        return serviceEngine(path, signal, {
            models: async function () { return [model]; },
            store: async function () { reading = true; return new Promise<string>(function () {}); },
            connect: async function () { throw new Error('Unexpected engine launch'); }
        });
    });
    try {
        var started = Date.now();
        while (!reading) {
            if (Date.now() - started > 5000) { throw new Error('Credential fixture did not start'); }
            await Bun.sleep(20);
        }
        expect((await serviceControl('status', directory)).state).toBe('starting');
        expect(await serviceControl('stop', directory)).toEqual({ state: 'stopped' });
        await worker;
    } finally {
        await serviceControl('stop', directory);
        await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
    }
}, 15000);

test.each(['model', 'version'])('a mismatched load response closes the engine: %s', async function (scenario) {
    var connected: Awaited<ReturnType<typeof engineSession>> | undefined;
    await expect(serviceEngine(root, new AbortController().signal, {
        models: async function () { return [model]; },
        store: async function () { return 'FIXTURE-LICENSE'; },
        connect: async function (key, signal) {
            connected = await engineSession(key, signal, undefined, async function () {
                return { executable, packagePath: root, runtimePath: root, release: fixture.release, target: fixture.release.runtime_target };
            });
            var request = connected.request;
            connected.request = async function (operation, fields) {
                var result = await request(operation, fields);
                if (operation === 'load' && scenario === 'model') { result.model_id = 'wrong-model'; }
                if (operation === 'load' && scenario === 'version') { result.engine_version = '9.9.9'; }
                return result;
            };
            return connected;
        }
    })).rejects.toThrow('does not match');
    await connected?.exited;
}, 15000);


test('credential store failures retain their safe recovery message in service status', async function () {
    var directory = await mkdtemp(join(root, 'credential-error-'));
    var worker = serviceWorker(directory, function (path, signal) {
        return serviceEngine(path, signal, {
            models: async function () { return [model]; },
            store: function (request) {
                return licenseStore(request, {
                    get: async function () { throw new Error('PRIVATE CREDENTIAL DETAILS'); },
                    set: async function () { throw new Error('Unexpected credential write'); }
                });
            },
            connect: async function () { throw new Error('Unexpected engine launch'); }
        });
    });
    try {
        var started = Date.now();
        var status = await serviceControl('status', directory);
        while (status.state !== 'failed') {
            if (Date.now() - started > 5000) { throw new Error('Credential failure did not appear'); }
            await Bun.sleep(20);
            status = await serviceControl('status', directory);
        }
        expect(status.message).toBe('Could not read the system credential store. Unlock it and try again.');
        expect(status.message).not.toContain('PRIVATE');
    } finally {
        await serviceControl('stop', directory);
        await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
    }
}, 10000);

function serviceWorker(directory: string, load: Parameters<typeof runServiceWorker>[1]) {
    return runServiceWorker(directory, load, function (path, getEngine) { return apiServer(path, getEngine, 0); });
}
