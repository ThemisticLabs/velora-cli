import { mock } from 'bun:test';
import assert from 'node:assert/strict';

var scenario = process.argv[2];
var cliCalls = 0;
var modelCalls = 0;
var cancelled = false;
var model = { id: 'skira7alpha', name: 'Skira 7 Alpha', version: '1.0', revision: 'r1', sequence: 1, engineVersion: '0.1.1', selected: true };
mock.module('../../src/updates/cli-update.js', function () {
    return { availableVersion: null, updateCheckStatus: 'available', default: async function () {
        cliCalls++;
        return '2.0.0';
    } };
});
mock.module('../../src/updates/model-update.js', function () {
    return { default: async function (_model: unknown, signal: AbortSignal) {
        modelCalls++;
        if (scenario === 'cancel') {
            await new Promise<void>(function (resolve) {
                signal.addEventListener('abort', function () { cancelled = true; resolve(); }, { once: true });
            });
        }
        return { message: 'Update available. Package installation is not available yet.', available: { version: '1.1', engineVersion: '0.2.0' } };
    } };
});
var showUpdates = (await import('../../src/menu/update-menu.js')).default;
if (scenario === 'no-model') {
    await showUpdates();
} else {
    await showUpdates(model);
}
assert.equal(cliCalls, Number(scenario === 'cli' || scenario === 'no-model'));
assert.equal(modelCalls, Number(scenario === 'model' || scenario === 'cancel'));
assert.equal(cancelled, scenario === 'cancel');
process.stdout.write('Updates verified.\n');
