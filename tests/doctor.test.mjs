import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

var DOCTOR_PATH = fileURLToPath(new URL('../src/doctor.ts', import.meta.url));

test('doctor checks PATH without executing the command and removes its storage probe', function () {
    var directory = mkdtempSync(join(tmpdir(), 'velora-doctor-test-'));
    try {
        var commandName = 'velora';
        if (process.platform === 'win32') {
            commandName = 'velora.cmd';
        }
        writeFileSync(join(directory, commandName), '#!/bin/sh\necho SHOULD_NOT_RUN\n', { mode: 0o700 });
        var result = runDoctor(directory, 'ready', directory);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /HTTP 200/);
        assert.match(result.stdout, /parent is writable/);
        assert.ok(result.stdout.includes(join(directory, commandName)));
        assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN|\u001b\[/);
        assert.equal(result.stderr, '');
        assert.deepEqual(readdirSync(directory), [commandName]);
    } finally {
        rmSync(directory, { recursive: true });
    }
});

test.each(['unavailable', 'http error'])('doctor reports missing PATH and server failure without failing the command: %s', function (scenario) {
    var directory = mkdtempSync(join(tmpdir(), 'velora-doctor-test-'));
    try {
        var result = runDoctor(directory, scenario);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Add the folder containing velora to PATH/);
        assert.match(result.stdout, /Action\s+License server/);
        if (scenario === 'http error') {
            assert.match(result.stdout, /HTTP 503/);
        } else {
            assert.match(result.stdout, /Connection failed or timed out/);
        }
        assert.doesNotMatch(result.stdout, /Checking|Waiting|\u001b\[/);
        assert.equal(result.stderr, '');
        assert.deepEqual(readdirSync(directory), []);
    } finally {
        rmSync(directory, { recursive: true });
    }
});

test.each(['existing', 'file', 'permission', 'write', 'cleanup', 'write and cleanup'])('doctor identifies storage failures and cleans up: %s', function (scenario) {
    var directory = mkdtempSync(join(tmpdir(), 'velora-doctor-test-'));
    try {
        if (scenario === 'file') {
            writeFileSync(join(directory, 'data'), 'Keep this file.');
        } else {
            mkdirSync(join(directory, 'data'));
        }
        var result = runDoctor(directory, scenario);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /HTTP 200/);
        assert.equal(result.stderr, '');
        if (scenario === 'existing') {
            assert.match(result.stdout, /OK\s+Storage/);
            assert.match(result.stdout, /Writable/);
        } else {
            assert.match(result.stdout, /Action\s+Storage/);
        }
        if (scenario === 'file') {
            assert.match(result.stdout, /ENOTDIR/);
            assert.match(result.stdout, /A file occupies part of the storage path/);
            assert.deepEqual(readdirSync(directory), ['data']);
            return;
        }
        if (scenario === 'permission') {
            assert.match(result.stdout, /create a test directory.*EACCES/);
            assert.match(result.stdout, /permissions/);
        }
        if (scenario === 'write' || scenario === 'write and cleanup') {
            assert.match(result.stdout, /write a test file.*ENOSPC/);
            assert.match(result.stdout, /Free disk space/);
        }
        var remainingFiles = readdirSync(join(directory, 'data'));
        if (scenario === 'cleanup' || scenario === 'write and cleanup') {
            assert.equal(remainingFiles.length, 1);
            assert.match(remainingFiles[0], /^\.velora-doctor-/);
            assert.ok(result.stdout.includes(join(directory, 'data', remainingFiles[0])));
            assert.match(result.stdout, /Could not remove the test directory/);
            assert.match(result.stdout, /remove it manually/);
        } else {
            assert.deepEqual(remainingFiles, []);
        }
    } finally {
        rmSync(directory, { recursive: true });
    }
});

function runDoctor(directory, scenario, commandPath = '') {
    var script = `
        import { mock } from 'bun:test';
        import * as filesystem from 'node:fs/promises';
        var original = { ...filesystem };
        var scenario = ${JSON.stringify(scenario)};
        mock.module('node:fs/promises', function () {
            return {
                ...original,
                mkdtemp: async function (...args) {
                    if (scenario === 'permission') {
                        throw Object.assign(new Error('Test permission failure'), { code: 'EACCES' });
                    }
                    return original.mkdtemp(...args);
                },
                writeFile: async function (...args) {
                    if (scenario === 'write' || scenario === 'write and cleanup') {
                        throw Object.assign(new Error('Test disk full'), { code: 'ENOSPC' });
                    }
                    return original.writeFile(...args);
                },
                rm: async function (...args) {
                    if (scenario === 'cleanup' || scenario === 'write and cleanup') {
                        throw Object.assign(new Error('Test cleanup failure'), { code: 'EACCES' });
                    }
                    return original.rm(...args);
                }
            };
        });
        var { default: doctor } = await import(${JSON.stringify(DOCTOR_PATH)});
        await doctor(async function (url, options) {
            if (url !== 'https://api.themistic.com/v1/license/check' || options.method !== 'GET' || options.body || options.headers || options.redirect !== 'error') {
                throw new Error('Unexpected request');
            }
            if (scenario === 'unavailable') {
                throw new TypeError('Network unavailable');
            }
            if (scenario === 'http error') {
                return new Response('', { status: 503 });
            }
            return new Response('', { status: 200 });
        }, ${JSON.stringify(join(directory, 'data'))});
    `;
    return spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, PATH: commandPath, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10000
    });
}
