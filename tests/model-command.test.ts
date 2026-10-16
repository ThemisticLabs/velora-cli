import { test, expect } from 'bun:test';
import { fileURLToPath } from 'node:url';

var FIXTURE = fileURLToPath(new URL('./fixtures/model-command.ts', import.meta.url));
test.each([
    { scenario: 'empty', code: 0, message: 'No models installed.' },
    { scenario: 'list', code: 0, message: 'model-b · model-b · Version 1.0 · Selected' },
    { scenario: 'available', code: 0, message: 'model-c · MODEL-C · Available for download' },
    { scenario: 'no-entitlements', code: 0, message: 'No models included in this license.' },
    { scenario: 'select', code: 0, message: 'Selected model model-a.' },
    { scenario: 'busy', code: 1, message: 'Stop the velora service' },
    { scenario: 'missing-model', code: 1, message: 'This model is not installed.' },
    { scenario: 'select-empty', code: 1, message: 'This model is not installed.' },
    { scenario: 'install', code: 0, message: 'Installed model model-c.' },
    { scenario: 'already-installed', code: 0, message: 'already installed.' },
    { scenario: 'missing-license', code: 1, message: 'No license saved.' },
    { scenario: 'withdrawn', code: 1, message: 'not available for download.' },
    { scenario: 'not-entitled', code: 1, message: 'not included in your license.' },
    { scenario: 'invalid-id', code: 1, message: 'Invalid model identifier.' },
    { scenario: 'download-failure', code: 1, message: 'Could not manage models.' },
    { scenario: 'cancel-license', code: 130, message: 'Model operation cancelled.' },
    { scenario: 'cancel-before-select', code: 130, message: 'Model operation cancelled.' },
    { scenario: 'cancel-refresh', code: 143, message: 'Model operation cancelled.' },
    { scenario: 'cancel-download', code: 143, message: 'Model operation cancelled.' },
    { scenario: 'cleanup', code: 1, message: 'Installed, but cleanup failed.' },
    { scenario: 'interrupt-cleanup', code: 130, message: 'Model installed before cancellation completed.' },
    { scenario: 'terminate-cleanup', code: 143, message: 'Model installed before cancellation completed.' },
    { scenario: 'terminate-failed-cleanup', code: 143, message: 'Installed, but cleanup failed.' }
])('noninteractive model command: $scenario', async function (scenario) {
    var cancelledAfterInstall = ['interrupt-cleanup', 'terminate-cleanup', 'terminate-failed-cleanup'].includes(scenario.scenario);
    var child = Bun.spawn([process.execPath, FIXTURE, scenario.scenario], { stdout: 'pipe', stderr: 'pipe' });
    var output = await new Response(child.stdout).text();
    var errors = await new Response(child.stderr).text();
    expect(await child.exited, output + errors).toBe(scenario.code);
    expect(output + errors).toContain(scenario.message);
    expect(output + errors).not.toContain('FIXTURE-PRIVATE-LICENSE');
    expect(output + errors).not.toContain('\u001b[');
    if (scenario.code !== 0 && scenario.scenario !== 'cleanup' && !cancelledAfterInstall) {
        expect(output).toBe('');
    }
    if (cancelledAfterInstall) {
        expect(output).toContain('Installed model model-c.');
        expect(errors).toContain('Model installed before cancellation completed.');
        expect(errors).not.toContain('partial downloads');
    }
    if (scenario.scenario === 'install') {
        expect(errors).toContain('may register this device');
        expect(errors).toContain('Download: 50%');
        expect(errors).not.toContain('Download: 55%');
        expect(errors.match(/Download: 100%/g)).toHaveLength(1);
    }
    if (['empty', 'list', 'select', 'already-installed'].includes(scenario.scenario)) {
        expect(errors).toBe('');
    }
});

test.each(['json', 'available-json', 'available-changed'])('model list emits parseable JSON without credentials: %s', async function (scenario) {
    var child = Bun.spawn([process.execPath, FIXTURE, scenario], { stdout: 'pipe', stderr: 'pipe' });
    var output = await new Response(child.stdout).text();
    var errors = await new Response(child.stderr).text();
    expect(await child.exited, errors).toBe(0);
    var models = JSON.parse(output);
    expect(models[0].id).toBe('model-a');
    if (scenario === 'available-changed') {
        expect(models[0].selected).toBe(true);
        expect(models[1].selected).toBe(false);
    } else {
        expect(models[1].selected).toBe(true);
    }
    expect(output + errors).not.toContain('FIXTURE-PRIVATE-LICENSE');
    if (scenario === 'json') {
        expect(models).toHaveLength(2);
        expect(errors).toBe('');
    } else {
        expect(models).toHaveLength(3);
        expect(models[0].installed).toBe(true);
        expect(models[2]).toMatchObject({ id: 'model-c', installed: false, canDownload: true, selected: false });
    }
});
