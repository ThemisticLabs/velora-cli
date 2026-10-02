import { test, expect } from 'bun:test';
import doctorEngine from '../src/commands/doctor-engine.js';
import type { DoctorCheck } from '../src/commands/doctor.js';
import type engineSession from '../src/engine/engine-session.js';

test.each(['ready', 'engine failure', 'license denied', 'no model', 'load failure', 'wrong version', 'invalid inference', 'cancel'])('doctor runtime checks and cleanup: %s', async function (scenario) {
    var controller = new AbortController();
    var closed = 0;
    var operations: string[] = [];
    var checks: Parameters<typeof doctorEngine>[2] = {
        engine: { name: 'Engine', status: 'Waiting', detail: '' },
        license: { name: 'License', status: 'Waiting', detail: '' },
        model: { name: 'Selected model', status: 'Waiting', detail: '' },
        inference: { name: 'Inference', status: 'Waiting', detail: '' }
    };
    var services = {
        store: async function () { return 'PRIVATE-LICENSE'; },
        checkLicense: async function () {
            if (scenario === 'license denied') { return { ok: false as const, message: 'This license has expired.' }; }
            return { ok: true as const, expiresAt: '2026-11-01', registeredDevices: 1, maxDevices: 5, models: [] };
        },
        connect: async function () {
            if (scenario === 'engine failure') { throw new Error('PRIVATE-LICENSE diagnostic'); }
            return {
                installation: { release: { version: '0.4.4' } },
                close: async function () { closed++; },
                request: async function (operation: string) {
                    controller.signal.throwIfAborted();
                    operations.push(operation);
                    if (operation === 'load') {
                        if (scenario === 'load failure') { throw new Error('PRIVATE-LICENSE diagnostic'); }
                        var version = 'model-v1';
                        if (scenario === 'wrong version') { version = 'model-v2'; }
                        return { model_id: 'test-model', model_version: version, engine_version: '0.4.4' };
                    }
                    if (scenario === 'invalid inference') { return { placeholder_text: 42 }; }
                    return { placeholder_text: '[PERSON:1] lives in Berlin.', mapping: {} };
                }
            };
        } as unknown as typeof engineSession,
        models: async function () {
            if (scenario === 'no model') { return []; }
            return [{ id: 'test-model', name: 'Test model', version: 'model-v1', revision: 'r1', sequence: 1, engineVersion: '0.4.4', selected: true }];
        }
    };
    var task = doctorEngine('/unused', controller.signal, checks, function () {
        if (scenario === 'cancel' && checks.inference.status === 'Checking') { controller.abort(); }
    }, services);
    if (scenario === 'cancel') {
        await expect(task).rejects.toBeDefined();
        expect(closed).toBe(1);
        return;
    }
    await task;
    expect(JSON.stringify(checks)).not.toContain('PRIVATE-LICENSE');
    expect(closed).toBe(Number(scenario !== 'engine failure'));
    if (scenario === 'ready') {
        for (var check of Object.values(checks)) { expect(check.status).toBe('OK'); }
        expect(operations).toEqual(['load', 'predict']);
        expect(checks.engine.detail).toContain('0.4.4');
        expect(checks.model.detail).toContain('model-v1');
        return;
    }
    if (scenario === 'invalid inference') {
        expect(checks.inference.status).toBe('Error');
        return;
    }
    expect(checks.inference.status).toBe('Warning');
    expect(operations).not.toContain('predict');
    if (scenario === 'load failure' || scenario === 'wrong version') { expect(checks.model.status).toBe('Error'); }
    if (scenario === 'license denied') { expect(checks.license.status).toBe('Error'); }
    if (scenario === 'engine failure') { expect(checks.engine.status).toBe('Error'); }
});
