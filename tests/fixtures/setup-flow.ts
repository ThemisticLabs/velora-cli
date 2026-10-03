import { mock } from 'bun:test';
import assert from 'node:assert/strict';

var scenario = process.argv[2];
var choices = ['license', 'saved', 'download'];
if (scenario === 'navigation') {
    choices = ['public', 'back', 'license', 'saved', 'retry', 'saved', 'back', 'download', 'license', 'saved'];
}
if (scenario === 'get-license') {
    choices = ['purchase', 'back', 'license', 'saved', 'download'];
}
if (scenario === 'cancel-after-install') {
    choices = ['license', 'saved', 'download'];
}
var model = { id: 'skira7alpha', name: 'Skira 7 Alpha', description: '', strengths: '', limitations: '', canDownload: true, downloadReason: null };
var installedModel = { ...model, id: 'other-model', name: 'Installed model' };
if (scenario === 'all-installed') {
    choices = ['license', 'saved', 'back'];
}
var checks = 0;
var lists = 0;
var downloads = 0;
var purchaseMessages = 0;
mock.module('../../src/setup/select-option.js', function () {
    return { default: async function (config: { back?: boolean; message: string; choices: { value: string }[] }) {
        if (config.message === 'How would you like to begin?') {
            var accessChoices = [];
            for (var item of config.choices) { accessChoices.push(item.value); }
            assert.deepEqual(accessChoices, ['license', 'purchase', 'public']);
        }
        if (config.message === 'License purchases are not available yet.') {
            purchaseMessages++;
            assert.equal(checks, 0);
        }
        var choice = choices.shift();
        var found = choice === 'back' && config.back === true;
        for (var item of config.choices) {
            if (item.value === choice) {
                found = true;
            }
        }
        assert.ok(found);
        return choice;
    } };
});
mock.module('../../src/license/license-store.js', function () {
    return { default: async function () { return 'FIXTURE-LICENSE'; } };
});
mock.module('../../src/license/manage-license.js', function () {
    return { default: async function () {
        checks++;
        if (scenario === 'navigation' && checks === 1) {
            return { ok: false, message: 'Fixture unavailable.' };
        }
        return { ok: true, license: 'FIXTURE-LICENSE', saved: false, expiresAt: '2026-10-18T00:00:00Z', registeredDevices: 1, maxDevices: 50, models: [model, installedModel] };
    } };
});
mock.module('../../src/setup/model-list.js', function () {
    return { default: async function (models: typeof model[]) {
        assert.deepEqual(models, [model]);
        lists++;
        if (scenario === 'navigation' && lists === 3) {
            return 'back';
        }
        if (scenario === 'navigation' && lists === 4) {
            return 'finish';
        }
        return model;
    } };
});
mock.module('../../src/setup/download-screen.js', function () {
    return { default: async function () {
        downloads++;
        if (scenario === 'navigation') {
            return 'failed';
        }
        if (scenario === 'cancel-after-install') {
            return 'cancelled-after-install';
        }
        return 'complete';
    } };
});
mock.module('../../src/models/installed-models.js', function () {
    return { default: async function () {
        if (scenario === 'all-installed') {
            return [model, installedModel];
        }
        return [installedModel];
    } };
});
var setup = (await import('../../src/setup/setup.js')).default;
try {
    assert.equal(await setup(), true);
    assert.notEqual(scenario, 'cancel-after-install');
} catch (error) {
    assert.equal(scenario, 'cancel-after-install');
    assert.equal((error as Error).name, 'ExitPromptError');
}
assert.equal(choices.length, 0);
if (scenario === 'all-installed') {
    assert.equal(downloads, 0);
    assert.equal(lists, 0);
} else {
    assert.equal(downloads, 1);
}
if (scenario === 'navigation') {
    assert.equal(checks, 3);
    assert.equal(lists, 4);
}
if (scenario === 'get-license') {
    assert.equal(purchaseMessages, 1);
    assert.equal(checks, 1);
    assert.equal(lists, 1);
}
process.stdout.write('Flow verified.\n');
