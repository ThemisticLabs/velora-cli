import { mock } from 'bun:test';
import assert from 'node:assert/strict';

var scenario = process.argv[2];
var setupCalls = 0;
var licenseCalls = 0;
var updateCalls = 0;
var models = [{ id: 'skira7alpha', name: 'Skira 7 Alpha', version: '1', revision: 'r1', sequence: 1, engineVersion: '0.1.1', selected: true }];
if (scenario === 'switch') {
    for (var index = 1; index <= 12; index++) {
        models.push({ id: 'model-' + index, name: 'Model ' + index, version: '1', revision: 'r1', sequence: 1, engineVersion: '0.1.1', selected: false });
    }
}
mock.module('../../src/license/license-store.js', function () {
    return { default: async function () {
        if (scenario === 'first') {
            return null;
        }
        return 'FIXTURE-PRIVATE';
    } };
});
mock.module('../../src/setup/setup.js', function () {
    return { default: async function () { setupCalls++; return true; } };
});
mock.module('../../src/models/installed-models.js', function () {
    return { default: async function (action: { operation: string; id?: string }) {
        if (action.operation === 'select') {
            for (var model of models) {
                model.selected = model.id === action.id;
            }
        }
        if (action.operation === 'delete') {
            models = [];
        }
        return models;
    } };
});
mock.module('../../src/license/manage-license.js', function () {
    return { default: async function (request: { operation: string; license: string }) {
        licenseCalls++;
        assert.equal(request.operation, 'set');
        assert.equal(request.license, 'FIXTURE-LICENSE');
        return { ok: false, message: 'This license has expired.' };
    } };
});
mock.module('../../src/updates/cli-update.js', function () {
    var status = 'unavailable';
    if (scenario === 'current') {
        status = 'current';
    }
    return { default: async function () { updateCalls++; return null; }, updateCheckStatus: status, availableVersion: null };
});
await (await import('../../src/menu/main-menu.js')).default();
assert.equal(setupCalls, Number(scenario === 'first'));
if (scenario === 'delete') {
    assert.equal(models.length, 0);
} else if (scenario === 'switch') {
    assert.equal(models[12]?.selected, true);
    assert.equal(models[0]?.selected, false);
} else {
    assert.equal(models.length, 1);
}
assert.equal(licenseCalls, Number(scenario === 'license'));
assert.equal(updateCalls, Number(scenario === 'offline' || scenario === 'current'));
process.stdout.write('Menu verified.\n');
