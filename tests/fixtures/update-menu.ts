import { mock } from 'bun:test';
import assert from 'node:assert/strict';

var scenario = process.argv[2];
var cliCalls = 0;
var engineInstalls = 0;
var cliInstalls = 0;
var cached: { installed: string; available?: string; current?: boolean; message: string } | null = null;
if (scenario === 'cached' || scenario === 'install-engine' || scenario === 'install-error') {
    cached = { installed: '0.4.2', available: '0.4.3', message: 'Update available.' };
}
var cancelled = false;
mock.module('../../src/updates/cli-update.js', function () {
    var status = 'available';
    if (scenario === 'current-cli') { status = 'current'; }
    if (scenario === 'offline-cli') { status = 'unavailable'; }
    var version: string | null = null;
    if (cached || scenario === 'install-cli' || scenario === 'cli-install-error') { version = '2.0.0'; }
    return { availableVersion: version, updateCheckStatus: status, default: async function () {
        cliCalls++;
        if (scenario === 'current-cli' || scenario === 'offline-cli') { return null; }
        return '2.0.0';
    } };
});
mock.module('../../src/updates/install-cli-update.js', function () {
    return { cliUpdatePending: false, default: async function (version: string) {
        assert.equal(version, '2.0.0');
        cliInstalls++;
        if (scenario === 'cli-install-error') { throw Object.assign(new Error('Private storage diagnostic'), { code: 'ENOSPC' }); }
    } };
});
mock.module('../../src/updates/engine-update.js', function () {
    return { availableEngineVersion: null, lastEngineCheck: cached, default: async function (signal: AbortSignal, _services: unknown, install?: { version: string }) {
        if (install) {
            assert.equal(install.version, '0.4.3');
            engineInstalls++;
            if (scenario === 'install-error') { throw Object.assign(new Error('Private storage diagnostic'), { code: 'ENOSPC' }); }
            cached!.installed = '0.4.3';
            cached!.current = true;
            cached!.message = 'Engine updated.';
            delete cached!.available;
            return cached;
        }
        if (scenario === 'cancel') {
            await new Promise<void>(function (resolve) {
                signal.addEventListener('abort', function () { cancelled = true; resolve(); }, { once: true });
            });
        }
        if (scenario === 'current-engine') { return { installed: '0.4.1', current: true, message: 'The engine is up to date.' }; }
        if (scenario === 'broken-engine') { return { message: 'The engine installation is incomplete.' }; }
        return { installed: '0.4.1', available: '0.4.2', message: 'Update available.' };
    } };
});
var showUpdates = (await import('../../src/menu/update-menu.js')).default;
await showUpdates();
assert.equal(cliCalls, Number(scenario === 'cli' || scenario === 'no-model' || scenario === 'current-cli' || scenario === 'offline-cli'));
assert.equal(cliInstalls, Number(scenario === 'install-cli' || scenario === 'cli-install-error'));
assert.equal(cancelled, scenario === 'cancel');
assert.equal(engineInstalls, Number(scenario === 'install-engine' || scenario === 'install-error'));
process.stdout.write('Updates verified.\n');
