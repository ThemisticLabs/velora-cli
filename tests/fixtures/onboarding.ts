import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

var directory = await mkdtemp(join(tmpdir(), 'velora-onboarding-'));
var scenario = process.argv[2];
var events: string[] = [];
var popupCalls = 0;
var updateCalls = 0;
var tourCalls = 0;
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
var apiKeys = (await import('../../src/api/api-keys.js')).default;
var progress = (await import('../../src/setup/setup-progress.js')).default;
if (scenario === 'progress-error') { await writeFile(join(directory, 'setup.json'), '{broken'); }
if (scenario === 'resume') { await progress(2); }
if (scenario === 'done' || scenario === 'review') { await progress(4); }
var saveFailures = 0;
if (scenario === 'save-error') {
    mock.module('../../src/setup/setup-progress.js', function () { return { INTRO_STEPS: 4, default: async function (step?: number) {
        if (step !== undefined && saveFailures++ === 0) { throw new Error('Storage unavailable'); }
        return progress(step);
    } }; });
}
if (scenario === 'existing') { await apiKeys({ operation: 'create', name: 'Existing', note: '' }); }
mock.module('../../src/menu/api-keys.js', function () { return { default: async function (_directory: unknown, _copy: unknown, options: { createOnly: boolean }) {
    assert.equal(options.createOnly, true);
    events.push('key'); popupCalls++;
    if (scenario === 'cancel-popup' && popupCalls === 1) { return false; }
    await apiKeys({ operation: 'create', name: 'Editor', note: '' });
    return true;
} }; });
mock.module('../../src/menu/update-settings.js', function () { return { default: async function (options: { setup: boolean }) {
    assert.equal(options.setup, true); events.push('updates'); updateCalls++;
    if (scenario === 'back' && updateCalls === 1) { return false; }
    return true;
} }; });
mock.module('../../src/menu/autostart-settings.js', function () { return { default: async function (options: { setup: boolean }) {
    assert.equal(options.setup, true); events.push('autostart'); return true;
} }; });
mock.module('../../src/setup/select-option.js', function () { return { default: async function (config: { message: string; choices: { value: string }[] }) {
    for (var choice of config.choices) {
        if (choice.value === 'retry') {
            events.push('storage');
            if (scenario === 'progress-error') { await writeFile(join(directory, 'setup.json'), '{"step":0}'); }
            return 'retry';
        }
    }
    if (config.message) { events.push('tour'); tourCalls++; return 'next'; }
    if (scenario === 'exit') { return 'back'; }
    if (scenario === 'existing' || popupCalls > 0 && scenario !== 'cancel-popup') { return 'continue'; }
    return 'create';
} }; });
try {
    var onboarding = (await import('../../src/setup/onboarding.js')).default;
    assert.equal(await onboarding({ review: scenario === 'review' }), scenario !== 'exit');
    if (scenario === 'done' || scenario === 'exit') { assert.deepEqual(events, []); }
    if (scenario === 'resume') { assert.deepEqual(events, ['autostart', 'tour', 'tour', 'tour', 'tour']); }
    if (scenario === 'existing') { assert.deepEqual(events, ['updates', 'autostart', 'tour', 'tour', 'tour', 'tour']); }
    if (scenario === 'new' || scenario === 'review') { assert.deepEqual(events, ['key', 'updates', 'autostart', 'tour', 'tour', 'tour', 'tour']); }
    if (scenario === 'back') { assert.deepEqual(events, ['key', 'updates', 'updates', 'autostart', 'tour', 'tour', 'tour', 'tour']); }
    if (scenario === 'progress-error') { assert.deepEqual(events, ['storage', 'key', 'updates', 'autostart', 'tour', 'tour', 'tour', 'tour']); }
    if (scenario === 'save-error') { assert.deepEqual(events, ['key', 'storage', 'updates', 'autostart', 'tour', 'tour', 'tour', 'tour']); }
    if (scenario === 'cancel-popup') { assert.equal(popupCalls, 2); }
    if (scenario !== 'exit') { assert.equal(await progress(), 4); }
    process.stdout.write('Onboarding verified.\n');
} finally { await rm(directory, { recursive: true, force: true }); }
