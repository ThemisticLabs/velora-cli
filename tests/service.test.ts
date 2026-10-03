import { expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import serviceControl, { type ServiceLaunch } from '../src/service/service-control.js';
import { spawn } from 'node:child_process';
import servicePaths from '../src/service/service-paths.js';

var CLI_PATH = fileURLToPath(new URL('../dist/velora', import.meta.url));
if (process.platform === 'win32') { CLI_PATH += '.exe'; }
var fixture = fileURLToPath(new URL('./fixtures/service-control.ts', import.meta.url));

var fixtureLaunch: ServiceLaunch = function (_command, args, options) {
    return spawn(process.execPath, ['run', fileURLToPath(new URL('./fixtures/service-worker.ts', import.meta.url)), args.at(-1)!], options);
};
test('the detached service survives its launcher and concurrent starts share one instance', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-service-'));
    var paths = servicePaths(directory);
    try {
        expect(await serviceControl('status', directory)).toEqual({ state: 'stopped' });
        var children = [];
        for (var index = 0; index < 3; index++) {
            children.push(Bun.spawn([process.execPath, 'run', fixture, 'start', directory], { stdout: 'pipe', stderr: 'pipe' }));
        }
        var pids = new Set<number>();
        for (var child of children) {
            var response = JSON.parse(await new Response(child.stdout).text());
            expect(await new Response(child.stderr).text()).toBe('');
            expect(await child.exited).toBe(0);
            expect(response.state).toBe('running');
            pids.add(response.pid);
        }
        expect(pids.size).toBe(1);
        var status = await serviceControl('status', directory);
        expect(status.state).toBe('running');
        if (status.state === 'running') { expect(pids.has(status.pid)).toBe(true); }
        expect(await serviceControl('start', directory, fixtureLaunch)).toEqual(status);
        if (process.platform !== 'win32') {
            expect((await lstat(paths.record)).mode & 0o777).toBe(0o600);
            expect((await lstat(paths.endpoint)).mode & 0o777).toBe(0o600);
        }
        expect(await serviceControl('stop', directory)).toEqual({ state: 'stopped' });
        expect(await serviceControl('status', directory)).toEqual({ state: 'stopped' });
        expect(await serviceControl('stop', directory)).toEqual({ state: 'stopped' });
        var restarted = await serviceControl('start', directory, fixtureLaunch);
        expect(restarted.state).toBe('running');
        if (restarted.state === 'running') { expect(pids.has(restarted.pid)).toBe(false); }
    } finally {
        await serviceControl('stop', directory);
        await rm(directory, { recursive: true, force: true });
        await rm(paths.runtime, { recursive: true, force: true });
    }
}, 30000);

test('a crashed service can restart without deleting user data', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-service-crash-'));
    var paths = servicePaths(directory);
    try {
        await writeFile(join(directory, 'user-data'), 'keep this');
        var status = await serviceControl('start', directory, fixtureLaunch);
        expect(status.state).toBe('running');
        if (status.state !== 'running') { throw new Error('Service did not start'); }
        process.kill(status.pid, 'SIGKILL');
        var started = Date.now();
        while (true) {
            try {
                process.kill(status.pid, 0);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ESRCH') { break; }
                throw error;
            }
            if (Date.now() - started > 5000) { throw new Error('Killed service remained active'); }
            await Bun.sleep(20);
        }
        expect(await serviceControl('status', directory)).toEqual({ state: 'stopped' });
        var restarted = await serviceControl('start', directory, fixtureLaunch);
        expect(restarted.state).toBe('running');
        if (restarted.state === 'running') { expect(restarted.pid).not.toBe(status.pid); }
        expect(await readFile(join(directory, 'user-data'), 'utf8')).toBe('keep this');
    } finally {
        await serviceControl('stop', directory);
        await rm(directory, { recursive: true, force: true });
        await rm(paths.runtime, { recursive: true, force: true });
    }
}, 20000);

test('unauthorized control messages cannot stop the service', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-service-auth-'));
    var paths = servicePaths(directory);
    try {
        var status = await serviceControl('start', directory, fixtureLaunch);
        await new Promise<void>(function (resolve, reject) {
            var socket = createConnection(paths.endpoint);
            socket.once('error', reject);
            socket.once('close', function () { resolve(); });
            socket.once('connect', function () {
                socket.write(JSON.stringify({ operation: 'stop', token: 'a'.repeat(43) }) + '\n');
            });
        });
        expect(await serviceControl('status', directory)).toEqual(status);
    } finally {
        await serviceControl('stop', directory);
        await rm(directory, { recursive: true, force: true });
        await rm(paths.runtime, { recursive: true, force: true });
    }
}, 15000);

test('invalid control information fails closed', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-service-invalid-'));
    try {
        await writeFile(servicePaths(directory).record, '{}');
        await expect(serviceControl('start', directory, fixtureLaunch)).rejects.toThrow('Invalid service control');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('the compiled worker reports missing setup without reading credentials and rejects a second worker', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-service-native-'));
    var paths = servicePaths(directory);
    var httpPort = createServer();
    await new Promise<void>(function (resolve) { httpPort.listen(0, '127.0.0.1', resolve); });
    var address = httpPort.address();
    if (!address || typeof address === 'string') { throw new Error('Port unavailable'); }
    await writeFile(join(directory, 'api.json'), JSON.stringify({ port: address.port }));
    await new Promise<void>(function (resolve) { httpPort.close(function () { resolve(); }); });
    var worker = Bun.spawn([CLI_PATH, '--service-worker', directory], { cwd: tmpdir(), env: { ...process.env, PATH: '' }, stdout: 'pipe', stderr: 'pipe' });
    try {
        var started = Date.now();
        while (true) {
            var status = await serviceControl('status', directory);
            if (status.state === 'failed') { break; }
            if (Date.now() - started > 5000) { throw new Error('Compiled worker did not start'); }
            await Bun.sleep(20);
        }
        expect(await serviceControl('status', directory)).toEqual({ state: 'failed', pid: worker.pid, message: 'Select an installed model in velora before starting the service.' });
        var second = Bun.spawn([CLI_PATH, '--service-worker', directory], { stdout: 'ignore', stderr: 'ignore' });
        expect(await second.exited).toBe(1);
        expect(await serviceControl('status', directory)).toEqual({ state: 'failed', pid: worker.pid, message: 'Select an installed model in velora before starting the service.' });
        await serviceControl('stop', directory);
        expect(await worker.exited).toBe(0);
        expect(await new Response(worker.stdout).text()).toBe('');
        expect(await new Response(worker.stderr).text()).toBe('');
    } finally {
        await serviceControl('stop', directory);
        worker.kill();
        await worker.exited;
        await rm(directory, { recursive: true, force: true });
        await rm(paths.runtime, { recursive: true, force: true });
    }
}, 15000);


test('start aborts promptly when the observed service stops during startup', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-start-stop-'));
    var paths = servicePaths(directory);
    var token = 'a'.repeat(43);
    if (process.platform !== 'win32') {
        await mkdir(paths.runtime, { mode: 0o700 });
    }
    await writeFile(paths.record, JSON.stringify({ pid: process.pid, token }));
    var server = createServer(function (socket) {
        socket.once('data', async function () {
            await rm(paths.record);
            socket.end(JSON.stringify({ state: 'starting', pid: process.pid }) + '\n');
        });
    });
    await new Promise<void>(function (resolve) { server.listen(paths.endpoint, resolve); });
    try {
        await expect(serviceControl('start', directory)).rejects.toThrow('stopped during startup');
    } finally {
        await new Promise<void>(function (resolve) { server.close(function () { resolve(); }); });
        await rm(paths.runtime, { recursive: true, force: true });
        await rm(directory, { recursive: true, force: true });
    }
}, 2000);


test('closing an interactive startup wait leaves its detached service running', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-service-close-'));
    var paths = servicePaths(directory);
    await writeFile(join(directory, 'delay-engine'), 'fixture');
    var controller = new AbortController();
    var starting = serviceControl('start', directory, fixtureLaunch, controller.signal);
    var cancelled = starting.catch(function (error: unknown) { return error; });
    try {
        var deadline = Date.now() + 5000;
        while ((await serviceControl('status', directory)).state !== 'starting') {
            if (Date.now() > deadline) { throw new Error('Service did not start'); }
            await Bun.sleep(20);
        }
        controller.abort();
        expect(await cancelled).toBe(controller.signal.reason);
        await Bun.sleep(500);
        var status = await serviceControl('status', directory);
        expect(status.state).toBe('running');
        expect(await Bun.file(join(directory, 'engine-closed')).exists()).toBe(false);
    } finally {
        controller.abort();
        await cancelled;
        await serviceControl('stop', directory);
        await rm(directory, { recursive: true, force: true });
        await rm(paths.runtime, { recursive: true, force: true });
    }
}, 10000);
