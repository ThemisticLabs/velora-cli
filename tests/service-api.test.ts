import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import serviceWorker from '../src/service/service-worker.js';
import serviceControl from '../src/service/service-control.js';
import servicePaths from '../src/service/service-paths.js';
import apiServer from '../src/api/api-server.js';
import apiSettings from '../src/api/api-settings.js';
import apiKeys from '../src/api/api-keys.js';
import type { ServiceStatus } from '../src/service/service-request.js';


test('an occupied configured port fails before any engine load', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-port-conflict-'));
    var occupied = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: function () { return new Response('Unrelated service'); } });
    await apiSettings(occupied.port, directory);
    var loads = 0;
    var worker = serviceWorker(directory, async function () { loads++; throw new Error('Must not load'); });
    try {
        var status = await waitFor(directory, 'failed');
        expect(status.state).toBe('failed');
        if (status.state === 'failed') { expect(status.message).toContain('port ' + occupied.port + ' is already in use'); }
        expect(loads).toBe(0);
        expect(await (await fetch(occupied.url)).text()).toBe('Unrelated service');
    } finally {
        await serviceControl('stop', directory);
        await worker;
        await occupied.stop(true);
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
        await rm(directory, { recursive: true, force: true });
    }
}, 10000);

test.each(['wait', 'close interactive'])('service Stop drains inference when controlling session chooses to %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-drain-'));
    var key = await apiKeys({ operation: 'create', name: 'Fixture app', note: '' }, directory);
    var enter: () => void;
    var entered = new Promise<void>(function (resolve) { enter = resolve; });
    var release: ((result: Record<string, unknown>) => void) | undefined;
    var engineClosed = false;
    var worker = serviceWorker(directory, async function () {
        return { model: 'model-a', engineVersion: '0.4.4', exited: new Promise<void>(function () {}),
            request: async function () { enter(); return new Promise<Record<string, unknown>>(function (resolve) { release = resolve; }); },
            close: async function () { engineClosed = true; } };
    }, function (path, getEngine) { return apiServer(path, getEngine, 0); });
    try {
        var status = await waitFor(directory, 'running');
        if (status.state !== 'running') { throw new Error('Service not ready'); }
        var response = fetch('http://127.0.0.1:' + status.port + '/anonymize', { method: 'POST',
            headers: { Authorization: 'Bearer ' + key.key, 'Content-Type': 'application/json' }, body: '{"text":"hello"}' });
        await entered;
        var stopped = false;
        var controller = new AbortController();
        var stopping = serviceControl('stop', directory, undefined, controller.signal).then(function (result) { stopped = true; return result; });
        await waitFor(directory, 'stopping');
        expect(stopped).toBe(false);
        expect(engineClosed).toBe(false);
        if (scenario === 'close interactive') {
            controller.abort();
            await expect(stopping).rejects.toThrow();
            expect((await serviceControl('status', directory)).state).toBe('stopping');
            expect(engineClosed).toBe(false);
        }
        release!({ placeholder_text: 'hello', mapping: {} });
        expect(await (await response).json()).toEqual({ text: 'hello' });
        if (scenario === 'wait') { expect(await stopping).toEqual({ state: 'stopped' }); }
        await worker;
        expect(engineClosed).toBe(true);
    } finally {
        release?.({ placeholder_text: 'hello', mapping: {} });
        await serviceControl('stop', directory);
        await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
        await rm(directory, { recursive: true, force: true });
    }
}, 10000);

test('a failed model load releases the reserved HTTP port', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-load-failure-'));
    var port = 0;
    var worker = serviceWorker(directory, async function () { throw new Error('PRIVATE'); }, async function (path, getEngine) {
        var api = await apiServer(path, getEngine, 0); port = api.port; return api;
    });
    try {
        var status = await waitFor(directory, 'failed');
        if (status.state === 'failed') { expect(status.message).not.toContain('PRIVATE'); }
        var replacement = Bun.serve({ hostname: '127.0.0.1', port, fetch: function () { return new Response('Rebound'); } });
        expect(replacement.port).toBe(port);
        await replacement.stop(true);
    } finally {
        await serviceControl('stop', directory); await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
        await rm(directory, { recursive: true, force: true });
    }
}, 10000);

async function waitFor(directory: string, state: ServiceStatus['state']): Promise<ServiceStatus> {
    var started = Date.now();
    while (true) {
        var status = await serviceControl('status', directory);
        if (status.state === state) { return status; }
        if (Date.now() - started > 5000) { throw new Error('Service did not reach ' + state); }
        await Bun.sleep(20);
    }
}
