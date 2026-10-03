import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type downloadModel from '../../src/downloads/download-model.js';

var directory = await mkdtemp(join(tmpdir(), 'velora-setup-session-'));
var scenario = process.argv[2];
process.env.TERM_PROGRAM = 'ghostty';
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
var originalSpawn = Bun.spawn;
Bun.spawn = function () {
    return { stdout: new Blob(['setup-terminal\n']).stream(), exited: Promise.resolve(0) };
} as unknown as typeof Bun.spawn;
var session = (await import('../../src/system/interactive-session.js')).default;
var navigation = (await import('../../src/terminal/interactive-navigation.js')).default;
var select = (await import('../../src/setup/select-option.js')).default;
var settingsOpened = false;
mock.module('../../src/menu/settings-menu.js', function () { return { default: async function () {
    settingsOpened = true;
    assert.equal(navigation.initializing, false);
    navigation.quit = true;
} }; });
mock.module('../../src/license/license-store.js', function () { return { default: async function () { return 'FIXTURE-LICENSE'; } }; });
mock.module('../../src/license/startup-license.js', function () { return { default: async function () { return true; } }; });
mock.module('../../src/updates/engine-update-preferences.js', function () { return { default: async function () { return null; } }; });
mock.module('../../src/models/installed-models.js', function () { return { default: async function () { return []; } }; });
mock.module('../../src/service/service-control.js', function () { return { default: async function () { return { state: 'stopped' }; } }; });
mock.module('../../src/downloads/download-model.js', function () { return { default: async function (options: Parameters<typeof downloadModel>[0]) {
    await new Promise<void>(function (_resolve, reject) {
        options.signal!.addEventListener('abort', function () { reject(options.signal!.reason); }, { once: true });
    });
} }; });
mock.module('../../src/setup/onboarding.js', function () { return { default: async function () {
    assert.equal(navigation.initializing, true);
    assert.deepEqual(await session('open', directory), { application: 'Ghostty', id: 'setup-terminal' });
    if (scenario === 'open') { return false; }
    if (scenario === 'settings') {
        await session('settings', directory);
        assert.equal(navigation.controller.signal.aborted, false);
        await select({ message: '', choices: [{ name: 'Continue setup', value: 'continue' }] });
        return true;
    }
    var quit = (async function () {
        await Bun.sleep(50);
        await session('quit', directory);
    })();
    try {
        if (scenario === 'quit-popup') {
            await (await import('../../src/terminal/popup.js')).default({ title: 'Add API key', description: '', background: function () { return ''; },
                fields: [{ name: 'name', label: 'Name', required: true, maxLength: 40 }], submit: 'Create', onSubmit: async function () { return { message: 'Created.' }; } });
        } else if (scenario === 'quit-switch') {
            await (await import('../../src/terminal/switch-list.js')).default({ rows: [{ value: 'login', name: 'Start at login', enabled: false, hint: '' }], saveLabel: 'Save and continue' });
        } else if (scenario === 'quit-license') {
            await (await import('../../src/setup/license-input.js')).default({});
        } else if (scenario === 'quit-task') {
            await (await import('../../src/terminal/run-terminal-task.js')).default(async function (signal) {
                await new Promise<void>(function (_resolve, reject) { signal.addEventListener('abort', function () { reject(signal.reason); }, { once: true }); });
            });
        } else if (scenario === 'quit-download') {
            await (await import('../../src/setup/download-screen.js')).default('FIXTURE-LICENSE', {
                id: 'fixture', name: 'Fixture', description: '', strengths: '', limitations: '', downloadReason: null, canDownload: true
            });
        } else {
            await select({ message: '', choices: [{ name: 'Create API key', value: 'create' }] });
        }
        assert.fail('The setup prompt did not close on Quit.');
    } finally {
        await quit;
    }
} }; });
try {
    await (await import('../../src/menu/main-menu.js')).default();
    assert.equal(settingsOpened, scenario === 'settings');
    assert.equal(await Bun.file(join(directory, 'interactive-session.json')).exists(), false);
    assert.equal(navigation.initializing, false);
    assert.equal(navigation.quit, false);
    process.stdout.write('Setup session verified.\n');
} finally {
    Bun.spawn = originalSpawn;
    await rm(directory, { recursive: true, force: true });
}
