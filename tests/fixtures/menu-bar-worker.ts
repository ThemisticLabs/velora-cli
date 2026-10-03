import type { spawn } from 'node:child_process';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Object.defineProperty(process, 'platform', { value: 'darwin' });
var directory = await mkdtemp(join(tmpdir(), 'velora-menubar-test-'));
var native = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: function () { native.emit('close', 0); } });
var launch = function () { setTimeout(function () { native.stdout.write('ready\n'); }, 0); return native; } as unknown as typeof spawn;
var state = 'stopped';
var operations: string[] = [];
var releaseStart: () => void;
var started = new Promise<void>(function (resolve) { releaseStart = resolve; });
mock.module('../../src/service/service-control.js', function () {
    return { default: async function (operation: string) {
        if (operation === 'start') { operations.push(operation); state = 'starting'; await started; state = 'running'; }
        if (operation === 'stop') { operations.push(operation); state = 'stopped'; }
        return { state };
    } };
});
mock.module('../../src/system/open-interactive.js', function () {
    return { default: async function (page: string, path: string) { assert.equal(path, directory); operations.push(page); } };
});
var { default: worker } = await import('../../src/system/menu-bar-worker.js');
var task = worker(directory, launch);
try {
    for (var attempt = 0; attempt < 100 && !await Bun.file(join(directory, 'menubar-ready.json')).exists(); attempt++) { await Bun.sleep(10); }
    assert(await Bun.file(join(directory, 'menubar-ready.json')).exists());
    native.stdout.write('service\n');
    await Bun.sleep(30);
    native.stdout.write('service\n');
    native.stdout.write('unknown\n');
    await Bun.sleep(30);
    assert.deepEqual(operations, ['start']);
    releaseStart!();
    await Bun.sleep(30);
    native.stdout.write('service\n');
    await Bun.sleep(30);
    native.stdout.write('settings\n');
    await Bun.sleep(30);
    native.stdout.write('open\n');
    await Bun.sleep(30);
    assert.deepEqual(operations, ['start', 'stop', 'settings', 'open']);
} finally {
    releaseStart!();
    native.emit('close', 0);
    await task;
    assert.equal(await Bun.file(join(directory, 'menubar-ready.json')).exists(), false);
    await rm(directory, { recursive: true, force: true });
}
