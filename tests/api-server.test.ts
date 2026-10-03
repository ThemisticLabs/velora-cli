import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import apiServer, { MAX_API_BODY_BYTES } from '../src/api/api-server.js';
import apiKeys from '../src/api/api-keys.js';
import type { ServiceEngine } from '../src/service/service-engine.js';
import DownloadError from '../src/downloads/download-error.js';

var engine: ServiceEngine = {
    model: 'model-a', engineVersion: '0.4.4', exited: new Promise<void>(function () {}), close: async function () {},
    request: async function (_operation, fields) { return { placeholder_text: fields?.text, mapping: {} }; }
};

test('HTTP uses current application keys and returns only the agreed response fields', async function () {
    var context = await start();
    try {
        var response = await fetch(context.url, { method: 'POST', headers: context.headers, body: JSON.stringify({ text: 'hello' }) });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ text: 'hello' });
        response = await fetch(context.url, { method: 'POST', headers: context.headers, body: JSON.stringify({ text: '', include_mapping: true }) });
        expect(await response.json()).toEqual({ text: '', mapping: {} });
        await apiKeys({ operation: 'revoke', id: context.id }, context.directory);
        response = await fetch(context.url, { method: 'POST', headers: context.headers, body: JSON.stringify({ text: 'hello' }) });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ error: { code: 'invalid_api_key' } });
    } finally { await context.close(); }
});

test.each([
    ['malformed', 400], ['array', 400], ['unknown field', 400], ['mapping flag', 400], ['missing text', 400],
    ['surrogate', 400], ['invalid key', 401], ['missing key', 401], ['content type', 415], ['compression', 415],
    ['origin', 403], ['browser', 403], ['host', 403], ['method', 405], ['route', 404]
])('HTTP rejects invalid boundary input: %s', async function (scenario, status) {
    var context = await start();
    try {
        var headers: Record<string, string> = { ...context.headers };
        var body = JSON.stringify({ text: 'hello' });
        var method = 'POST';
        var url = context.url;
        if (scenario === 'malformed') { body = '{'; }
        if (scenario === 'array') { body = '[]'; }
        if (scenario === 'unknown field') { body = JSON.stringify({ text: 'hello', model: 'other' }); }
        if (scenario === 'mapping flag') { body = JSON.stringify({ text: 'hello', include_mapping: 'yes' }); }
        if (scenario === 'missing text') { body = '{}'; }
        if (scenario === 'surrogate') { body = '{"text":"\\ud800"}'; }
        if (scenario === 'invalid key') { headers.Authorization = 'Bearer velora_' + 'a'.repeat(43); }
        if (scenario === 'missing key') { delete headers.Authorization; }
        if (scenario === 'content type') { headers['Content-Type'] = 'text/plain'; }
        if (scenario === 'compression') { headers['Content-Encoding'] = 'gzip'; }
        if (scenario === 'origin') { headers.Origin = 'https://example.test'; }
        if (scenario === 'browser') { headers['Sec-Fetch-Site'] = 'cross-site'; }
        if (scenario === 'host') { headers.Host = 'example.test'; }
        if (scenario === 'method') { method = 'PUT'; }
        if (scenario === 'route') { url += '?text=secret'; }
        var response = await fetch(url, { method, headers, body });
        expect(response.status).toBe(status);
        var error = await response.json();
        expect(error.error.message).not.toContain('secret');
        expect(Object.keys(error)).toEqual(['error']);
    } finally { await context.close(); }
});

test.each(['known length', 'chunked'])('body limits return 413 without running inference: %s', async function (scenario) {
    var calls = 0;
    var context = await start({ ...engine, request: async function () { calls++; throw new Error('Must not run'); } });
    try {
        var body = JSON.stringify({ text: 'a'.repeat(MAX_API_BODY_BYTES) });
        var status = await new Promise<number>(function (resolve, reject) {
            var request = httpRequest(context.url, { method: 'POST', headers: { ...context.headers } }, function (response) {
                response.resume(); response.once('end', function () { request.destroy(); resolve(response.statusCode!); });
            });
            request.on('error', reject);
            if (scenario === 'known length') { request.setHeader('Content-Length', Buffer.byteLength(body)); }
            request.write(body.slice(0, 100));
            request.end(body.slice(100));
        });
        expect(status).toBe(413);
        expect(calls).toBe(0);
        var response = await fetch(context.url, { method: 'POST', headers: context.headers, body: '{"text":"ok"}' });
        expect(response.status).toBe(503);
        expect(calls).toBe(1);
    } finally { await context.close(); }
});

test('concurrent inference is rejected and shutdown waits for the active result', async function () {
    var release: (value: Record<string, unknown>) => void;
    var entered: () => void;
    var started = new Promise<void>(function (resolve) { entered = resolve; });
    var context = await start({ ...engine, request: async function () {
        entered(); return new Promise<Record<string, unknown>>(function (resolve) { release = resolve; });
    } });
    var first = fetch(context.url, { method: 'POST', headers: context.headers, body: '{"text":"hello"}' });
    await started;
    var second = await fetch(context.url, { method: 'POST', headers: context.headers, body: '{"text":"hello"}' });
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('1');
    await second.text();
    var closed = false;
    var closing = context.close().then(function () { closed = true; });
    await Bun.sleep(30);
    expect(closed).toBe(false);
    release!({ placeholder_text: 'hello', mapping: {} });
    expect(await (await first).json()).toEqual({ text: 'hello' });
    await closing;
    expect(closed).toBe(true);
}, 10000);

test('client disconnection retains the busy slot until inference completes', async function () {
    var release: (value: Record<string, unknown>) => void;
    var entered: () => void;
    var started = new Promise<void>(function (resolve) { entered = resolve; });
    var context = await start({ ...engine, request: async function () {
        entered(); return new Promise<Record<string, unknown>>(function (resolve) { release = resolve; });
    } });
    var request = httpRequest(context.url, { method: 'POST', headers: { ...context.headers } });
    request.on('error', function () {});
    request.end('{"text":"hello"}');
    await started;
    request.destroy();
    try {
        var response = await fetch(context.url, { method: 'POST', headers: context.headers, body: '{"text":"hello"}' });
        expect(response.status).toBe(429);
        await response.text();
    } finally {
        release!({ placeholder_text: 'hello', mapping: {} });
        await context.close();
    }
}, 10000);

test.each(['crash', 'license', 'encoded limit', 'invalid response', 'engine timeout'])('engine failures return safe errors: %s', async function (scenario) {
    var context = await start({ ...engine, request: async function () {
        if (scenario === 'engine timeout') { throw new DownloadError('PRIVATE', 'engine_timeout'); }
        if (scenario === 'license') { throw new DownloadError('PRIVATE', 'license_denied'); }
        if (scenario === 'encoded limit') { throw new DownloadError('PRIVATE', 'request_too_large'); }
        if (scenario === 'invalid response') { return { placeholder_text: 'PRIVATE', mapping: {} }; }
        throw new Error('PRIVATE TEXT AND PATH');
    } });
    try {
        var response = await fetch(context.url, { method: 'POST', headers: context.headers, body: '{"text":"hello"}' });
        var status = 503;
        if (scenario === 'encoded limit') { status = 413; }
        if (scenario === 'engine timeout') { status = 504; }
        expect(response.status).toBe(status);
        expect(await response.text()).not.toContain('PRIVATE');
    } finally { await context.close(); }
});

async function start(loaded = engine) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-api-'));
    var created = await apiKeys({ operation: 'create', name: 'Fixture app', note: '' }, directory);
    var api = await apiServer(directory, function () { return loaded; }, 0);
    return { directory, id: created.keys[0]!.id, url: 'http://127.0.0.1:' + api.port + '/anonymize',
        headers: { Authorization: 'Bearer ' + created.key, 'Content-Type': 'application/json' },
        close: async function () { await api.close(); await rm(directory, { recursive: true, force: true }); } };
}


test('the exact byte limit is accepted and invalid UTF-8 fails before inference', async function () {
    var calls = 0;
    var context = await start({ ...engine, request: async function (_operation, fields) { calls++; return { placeholder_text: fields?.text, mapping: {} }; } });
    try {
        var length = MAX_API_BODY_BYTES - Buffer.byteLength(JSON.stringify({ text: '' }));
        var body = JSON.stringify({ text: 'a'.repeat(length) });
        expect(Buffer.byteLength(body)).toBe(MAX_API_BODY_BYTES);
        var response = await fetch(context.url, { method: 'POST', headers: context.headers, body });
        expect(response.status).toBe(200);
        expect((await response.json()).text.length).toBe(length);
        expect(calls).toBe(1);
        response = await fetch(context.url, { method: 'POST', headers: context.headers, body: new Uint8Array([0xff, 0xfe]) });
        expect(response.status).toBe(400);
        expect(calls).toBe(1);
    } finally { await context.close(); }
}, 10000);


test('a trickling body cannot occupy the processing slot indefinitely', async function () {
    var context = await start();
    var timer: ReturnType<typeof setInterval> | undefined;
    var request = httpRequest(context.url, { method: 'POST', headers: { ...context.headers } });
    request.on('error', function () {});
    try {
        var response = new Promise<number>(function (resolve, reject) {
            request.once('response', function (response) { response.resume(); response.once('end', function () { resolve(response.statusCode!); }); });
            request.once('error', reject);
        });
        request.write('{"text":"');
        timer = setInterval(function () { request.write('a'); }, 1000);
        expect(await response).toBe(408);
        clearInterval(timer);
        request.destroy();
        var next = await fetch(context.url, { method: 'POST', headers: context.headers, body: '{"text":"hello"}', keepalive: false });
        expect({ status: next.status, body: await next.json() }).toEqual({ status: 200, body: { text: 'hello' } });
    } finally {
        clearInterval(timer);
        request.destroy();
        await context.close();
    }
}, 22000);
