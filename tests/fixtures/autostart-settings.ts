import { mock } from 'bun:test';
import assert from 'node:assert/strict';

var scenario = process.argv[2];
var enabled = scenario === 'settings-disable';
var writes: boolean[] = [];
var failed = false;
mock.module('../../src/system/autostart.js', function () { return { default: async function (value?: boolean) {
    if (value !== undefined) {
        writes.push(value);
        if (scenario === 'save-error' && !failed) { failed = true; throw new Error('Cannot save'); }
        enabled = value;
    }
    return { supported: scenario !== 'unsupported', enabled };
} }; });
var settings = (await import('../../src/menu/autostart-settings.js')).default;
var setup = scenario !== 'settings-disable';
var continued = await settings({ setup });
if (scenario === 'cancel') { assert.equal(continued, false); assert.deepEqual(writes, []); }
if (scenario === 'setup-off') { assert.equal(continued, true); assert.deepEqual(writes, [false]); }
if (scenario === 'setup-on') { assert.equal(continued, true); assert.deepEqual(writes, [true]); }
if (scenario === 'settings-disable') { assert.deepEqual(writes, [false]); }
if (scenario === 'save-error') { assert.equal(continued, true); assert.deepEqual(writes, [true, true]); }
if (scenario === 'unsupported') { assert.equal(continued, true); assert.deepEqual(writes, []); }
process.stdout.write('Login preferences verified.\n');
