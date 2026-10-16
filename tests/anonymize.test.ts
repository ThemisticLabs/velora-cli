import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import anonymizeText from '../src/api/anonymize-text.js';
import apiServer, { MAX_API_BODY_BYTES } from '../src/api/api-server.js';
import serviceWorker from '../src/service/service-worker.js';
import serviceControl from '../src/service/service-control.js';
import servicePaths from '../src/service/service-paths.js';
import type { ServiceEngine } from '../src/service/service-engine.js';
import DownloadError from '../src/downloads/download-error.js';

var executable = '../dist/velora';
if (process.platform === 'win32') { executable += '.exe'; }
var CLI_PATH = process.env.VELORA_TEST_BINARY || fileURLToPath(new URL(executable, import.meta.url));
var PIPE_SCENARIOS = ['closed'];
if (process.platform !== 'win32') { PIPE_SCENARIOS.push('cancelled'); }

test('local text requests reuse the running service without creating application keys', async function () {
    var context = await start();
    try {
        var result = await anonymizeText('Hallo Anna Müller.', true, new AbortController().signal, context.directory);
        expect(result).toEqual({ text: 'Hallo [PERSON:1].', mapping: {
            '[PERSON:1]': { original: 'Anna Müller', type: 'PERSON', occurrences: [{ start: 6, end: 17 }] }
        } });
        expect(await anonymizeText('🙂\nhello\n', false, new AbortController().signal, context.directory)).toEqual({ text: '🙂\nhello\n' });
        expect(await anonymizeText('', false, new AbortController().signal, context.directory)).toEqual({ text: '' });
        expect(context.loads()).toBe(1);
        expect(await Bun.file(join(context.directory, 'api-keys.json')).exists()).toBe(false);
    } finally { await context.close(); }
});

test('private service credentials do not grant browser access or accept a guessed token', async function () {
    var context = await start();
    try {
        var record = JSON.parse(await readFile(servicePaths(context.directory).record, 'utf8'));
        for (var token of ['', 'x'.repeat(43), 'é'.repeat(43)]) {
            var response = await fetch(context.url, { method: 'POST', headers: {
                'Content-Type': 'application/json', 'x-velora-control-token': token
            }, body: '{"text":"private"}' });
            expect(response.status).toBe(401);
        }
        var browser = await fetch(context.url, { method: 'POST', headers: {
            'Content-Type': 'application/json', 'x-velora-control-token': record.token, Origin: 'https://example.test'
        }, body: '{"text":"private"}' });
        expect(browser.status).toBe(403);
        expect(context.requests()).toBe(0);
    } finally { await context.close(); }
});

test.each(['stdin', 'file', 'dash', 'json', 'mapping', 'empty'])('compiled anonymize reads UTF-8 and keeps stdout clean: %s', async function (scenario) {
    var context = await start();
    var input = 'Hallo Anna Müller.';
    if (scenario === 'empty') { input = ''; }
    var args = ['anonymize'];
    if (scenario === 'file') {
        var path = join(context.home, 'input.txt');
        await writeFile(path, input);
        args.push(path);
    }
    if (scenario === 'dash') { args.push('-'); }
    if (scenario === 'json') { args.push('--json'); }
    if (scenario === 'mapping') { args.push('--mapping'); }
    try {
        var child = Bun.spawn([CLI_PATH, ...args], { env: context.environment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        child.stdin.write(input);
        child.stdin.end();
        var output = await new Response(child.stdout).text();
        var errors = await new Response(child.stderr).text();
        expect(await child.exited, errors).toBe(0);
        expect(errors).toBe('');
        if (scenario === 'json' || scenario === 'mapping') {
            var result = JSON.parse(output);
            expect(result.text).toBe('Hallo [PERSON:1].');
            if (scenario === 'mapping') { expect(result.mapping['[PERSON:1]'].original).toBe('Anna Müller'); }
            else { expect(result).not.toHaveProperty('mapping'); }
        } else if (scenario === 'empty') {
            expect(output).toBe('');
        } else {
            expect(output).toBe('Hallo [PERSON:1].');
        }
        expect(context.loads()).toBe(1);
        expect((await serviceControl('status', context.directory)).state).toBe('running');
    } finally { await context.close(); }
});

test.each(['invalid UTF-8', 'too large', 'encoded size', 'missing file', 'private engine error'])('compiled anonymize fails without leaking input: %s', async function (scenario) {
    var context = await start(scenario === 'private engine error');
    var input = Buffer.from('PRIVATE-INPUT');
    var args = ['anonymize'];
    if (scenario === 'invalid UTF-8') { input = Buffer.from([0xff]); }
    if (scenario === 'too large') { input = Buffer.alloc(MAX_API_BODY_BYTES + 1, 97); }
    if (scenario === 'encoded size') { input = Buffer.alloc(MAX_API_BODY_BYTES / 2, 0); }
    if (scenario === 'missing file') { args.push(join(context.home, 'missing.txt')); }
    try {
        var child = Bun.spawn([CLI_PATH, ...args], { env: context.environment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        child.stdin.write(input);
        child.stdin.end();
        var output = await new Response(child.stdout).text();
        var errors = await new Response(child.stderr).text();
        expect(await child.exited, errors).toBe(1);
        expect(output).toBe('');
        expect(errors).not.toContain('PRIVATE-INPUT');
        expect(errors).not.toContain('PRIVATE-ENGINE');
        if (scenario === 'invalid UTF-8') { expect(errors).toContain('valid UTF-8'); }
        if (scenario === 'too large') { expect(errors).toContain('too large'); }
        if (scenario === 'encoded size') { expect(errors).toContain('encoded JSON request'); }
        if (scenario !== 'private engine error') { expect(context.requests()).toBe(0); }
    } finally { await context.close(); }
});

test('anonymize reports a stopped service without reading credentials or starting it', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-anonymize-stopped-'));
    try {
        await expect(anonymizeText('private', false, new AbortController().signal, directory)).rejects.toThrow('serve start --headless');
        expect(await Bun.file(servicePaths(directory).record).exists()).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('anonymize tells users to stop a failed service before starting it again', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-anonymize-failed-'));
    var worker = serviceWorker(directory, async function () {
        throw new DownloadError('The selected model could not be loaded.');
    }, function (path, getEngine, _port, token) { return apiServer(path, getEngine, 0, token); });
    try {
        var deadline = Date.now() + 5000;
        while ((await serviceControl('status', directory)).state !== 'failed') {
            if (Date.now() >= deadline) { throw new Error('Fixture service did not fail.'); }
            await Bun.sleep(10);
        }
        await expect(anonymizeText('private', false, new AbortController().signal, directory)).rejects.toThrow('velora serve stop');
        await expect(serviceControl('start', directory)).rejects.toThrow('The selected model could not be loaded.');
        expect((await serviceControl('status', directory)).state).toBe('failed');
    } finally {
        await serviceControl('stop', directory);
        await worker;
        await rm(servicePaths(directory).runtime, { recursive: true, force: true });
        await rm(directory, { recursive: true, force: true });
    }
});

test.skipIf(process.platform === 'win32')('SIGTERM while reading stdin returns 143 without stopping the service', async function () {
    var context = await start();
    var child = Bun.spawn([CLI_PATH, 'anonymize'], { env: context.environment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    try {
        child.stdin.write('private');
        await Bun.sleep(100);
        child.kill('SIGTERM');
        var output = await new Response(child.stdout).text();
        var errors = await new Response(child.stderr).text();
        expect(await child.exited, errors).toBe(143);
        expect(output).toBe('');
        expect(errors).toContain('cancelled');
        expect((await serviceControl('status', context.directory)).state).toBe('running');
    } finally { child.kill(); await child.exited; await context.close(); }
});

test.skipIf(process.platform === 'win32')('cancelling the CLI during inference leaves the service busy until the engine finishes', async function () {
    var release: () => void;
    var pending = new Promise<void>(function (resolve) { release = resolve; });
    var context = await start(false, pending);
    var child = Bun.spawn([CLI_PATH, 'anonymize'], { env: context.environment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    try {
        child.stdin.write('private');
        child.stdin.end();
        var deadline = Date.now() + 3000;
        while (context.requests() === 0) {
            if (Date.now() >= deadline) { throw new Error('The CLI did not submit its request.'); }
            await Bun.sleep(10);
        }
        child.kill('SIGTERM');
        var errors = await new Response(child.stderr).text();
        expect(await child.exited, errors).toBe(143);
        expect(await new Response(child.stdout).text()).toBe('');
        await expect(anonymizeText('another request', false, new AbortController().signal, context.directory)).rejects.toThrow('busy');
        expect(context.requests()).toBe(1);
        expect((await serviceControl('status', context.directory)).state).toBe('running');
    } finally { release!(); child.kill(); await child.exited; await context.close(); }
});

test.each(PIPE_SCENARIOS)('anonymize handles a %s stdout pipe without leaking input', async function (scenario) {
    var context = await start();
    var child = spawn(CLI_PATH, ['anonymize'], { env: context.environment, stdio: ['pipe', 'pipe', 'pipe'] });
    var exited = once(child, 'exit');
    var closed = once(child, 'close');
    var errors = '';
    child.stderr.on('data', function (chunk) { errors += chunk.toString(); });
    try {
        if (scenario === 'closed') { child.stdout.destroy(); }
        child.stdin.end('PRIVATE-INPUT'.repeat(120000));
        var code = 1;
        if (scenario === 'cancelled') {
            // Readable mode leaves stdout paused so the child cannot finish its large write.
            await once(child.stdout, 'readable');
            child.kill('SIGTERM');
            code = 143;
        }
        var result = await exited;
        child.stdout.destroy();
        await closed;
        expect(result[0], errors).toBe(code);
        expect(errors).not.toContain('PRIVATE-INPUT');
        expect(errors).not.toContain('Unhandled');
        expect(errors).not.toContain('at anonymizeCommand');
    } finally { child.kill(); child.stdout.destroy(); await closed; await context.close(); }
});

async function start(fail = false, pending?: Promise<void>) {
    var home = await mkdtemp(join(tmpdir(), 'velora-anonymize-'));
    var directory = join(home, 'velora');
    if (process.platform === 'darwin') { directory = join(home, 'Library', 'Application Support', 'velora'); }
    await mkdir(directory, { recursive: true });
    // Compiled CLI tests share a synthetic menubar owner instead of opening native UI.
    await writeFile(join(directory, 'menubar-ready.json'), JSON.stringify({ pid: process.pid }));
    var loads = 0;
    var requests = 0;
    var worker = serviceWorker(directory, async function (): Promise<ServiceEngine> {
        loads++;
        return { model: 'model-a', engineVersion: '0.4.4', exited: new Promise<void>(function () {}), close: async function () {},
            request: async function (_operation, fields) {
                requests++;
                if (pending) { await pending; }
                if (fail) { throw new DownloadError('PRIVATE-ENGINE PRIVATE-INPUT'); }
                if (fields?.text === 'Hallo Anna Müller.') {
                    return { placeholder_text: 'Hallo [PERSON:1].', mapping: {
                        '1': { text: 'Anna Müller', label: 'PERSON', occurrences: [{ start: 6, end: 17 }] }
                    } };
                }
                return { placeholder_text: fields?.text, mapping: {} };
            }
        };
    }, function (path, getEngine, _port, token) { return apiServer(path, getEngine, 0, token); });
    var deadline = Date.now() + 5000;
    while (true) {
        var status = await serviceControl('status', directory);
        if (status.state === 'running') { var port = status.port; break; }
        if (Date.now() >= deadline) { throw new Error('Fixture service did not start.'); }
        await Bun.sleep(10);
    }
    return { home, directory, url: 'http://127.0.0.1:' + port + '/anonymize',
        environment: { ...process.env, HOME: home, XDG_DATA_HOME: home, LOCALAPPDATA: home, NO_COLOR: '1', TERM: 'dumb' },
        loads: function () { return loads; }, requests: function () { return requests; },
        close: async function () {
            await serviceControl('stop', directory);
            await worker;
            await rm(servicePaths(directory).runtime, { recursive: true, force: true });
            await rm(home, { recursive: true, force: true });
        }
    };
}
