import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

var DOCTOR_PATH = fileURLToPath(new URL('../src/doctor.ts', import.meta.url));

test('doctor checks PATH without executing the discovered command and sends no credentials', function () {
    var directory = mkdtempSync(join(tmpdir(), 'velora-doctor-test-'));
    try {
        var commandName = 'velora';
        if (process.platform === 'win32') {
            commandName = 'velora.cmd';
        }
        writeFileSync(join(directory, commandName), '#!/bin/sh\necho SHOULD_NOT_RUN\n', { mode: 0o700 });
        var script = `
            import doctor from ${JSON.stringify(DOCTOR_PATH)};
            await doctor(async function (url, options) {
                if (url !== 'https://api.themistic.com/v1/license/check' || options.method !== 'GET' || options.body || options.headers || options.redirect !== 'error') {
                    throw new Error('Unexpected request');
                }
                return new Response('', { status: 200 });
            });
        `;
        var result = spawnSync(process.execPath, ['-e', script], {
            env: { ...process.env, PATH: directory, NO_COLOR: '1' }, encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /HTTP 200/);
        assert.match(result.stdout, /Writable|parent is writable/);
        assert.ok(result.stdout.includes(join(directory, commandName)));
        assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN|\u001b\[/);
        assert.equal(result.stderr, '');
    } finally {
        rmSync(directory, { recursive: true });
    }
});

test.each(['unavailable', 'http error'])('doctor reports missing PATH and server failure: %s', function (scenario) {
    var response = "throw new TypeError('Network unavailable');";
    if (scenario === 'http error') {
        response = "return new Response('', { status: 503 });";
    }
    var script = `import doctor from ${JSON.stringify(DOCTOR_PATH)}; await doctor(async function () { ${response} });`;
    var result = spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, PATH: '', NO_COLOR: '1' }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Add the folder containing velora to PATH/);
    assert.match(result.stdout, /Action\s+License server/);
    if (scenario === 'http error') {
        assert.match(result.stdout, /HTTP 503/);
    } else {
        assert.match(result.stdout, /Connection failed or timed out/);
    }
    assert.doesNotMatch(result.stdout, /Checking|Waiting|\u001b\[/);
    assert.equal(result.stderr, '');
});
