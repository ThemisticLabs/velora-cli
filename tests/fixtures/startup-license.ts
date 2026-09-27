import { mock } from 'bun:test';
import assert from 'node:assert/strict';
var scenario = process.argv[2];
var calls = 0;
var saves = 0;
mock.module('../../src/license/license-access.js', function () {
    return { default: async function () {
        calls++;
        if (scenario === 'valid' || scenario === 'retry' && calls > 1) { return { ok: true }; }
        if (scenario === 'offline') { return { ok: false, message: 'The server could not be reached.' }; }
        return { ok: false, reason: 'unknown_key', message: 'This license key was not found.' };
    } };
});
mock.module('../../src/license/manage-license.js', function () {
    return { default: async function (request: { license: string }) {
        assert.equal(request.license, 'FIXTURE-NEW-KEY');
        saves++;
        return { ok: true };
    } };
});
var verified = await (await import('../../src/license/startup-license.js')).default('FIXTURE-PRIVATE');
assert.equal(verified, ['valid', 'retry', 'change'].includes(scenario));
assert.equal(saves, Number(scenario === 'change'));
assert.equal(calls, 1 + Number(scenario === 'retry'));
process.stdout.write('Startup verified.\n');
