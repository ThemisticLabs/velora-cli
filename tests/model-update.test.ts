import { test, expect } from 'bun:test';
import modelUpdate from '../src/updates/model-update.js';
import type engineSession from '../src/engine/engine-session.js';
import enginePackage from './fixtures/engine-package.js';

test.each(['model', 'engine', 'current', 'invalid', 'no license'])('manual update plan: %s', async function (scenario) {
    var fixture = await enginePackage();
    var model = { id: 'model-a', name: 'Model A', version: '1', revision: 'r1', sequence: 1, engineVersion: '0.4.1', selected: true };
    if (scenario === 'engine') { model.engineVersion = '0.4.0'; }
    var release: unknown = { model_id: 'model-a', version: '1', revision: 'r1', sequence: 1 };
    if (scenario === 'model') { release = { model_id: 'model-a', version: '2', revision: 'r2', sequence: 2 }; }
    if (scenario === 'invalid') { release = {}; }
    var requests = 0;
    var closed = false;
    var connect = async function () {
        return {
            installation: { target: 'macosx-14.0-arm64' },
            request: async function (operation: string) {
                expect(operation).toBe('device');
                return { hw: 'a'.repeat(64), runtime_target: 'macosx-14.0-arm64' };
            },
            close: async function () { closed = true; }
        };
    } as unknown as typeof engineSession;
    var services: NonNullable<Parameters<typeof modelUpdate>[2]> = {
        store: async function () {
            if (scenario === 'no license') { return null; }
            return 'FIXTURE-LICENSE';
        },
        connect,
        request: async function (binding, _signal, _transport, _key, _size, endpoint) {
            requests++;
            expect(endpoint).toBe('check');
            expect(binding.operation).toBe('resolve');
            expect(binding.hw).toBe('a'.repeat(64));
            return { metadata: { model: release, engine: fixture.release }, body: Buffer.alloc(0) };
        }
    };
    var task = modelUpdate(model, new AbortController().signal, services);
    if (scenario === 'invalid') {
        await expect(task).rejects.toThrow();
    } else {
        var result = await task;
        if (scenario === 'model') { expect(result.available).toEqual({ version: '2', engineVersion: '' }); }
        if (scenario === 'engine') { expect(result.available).toEqual({ version: '', engineVersion: '0.4.1' }); }
        if (scenario === 'current') { expect(result.available).toBeUndefined(); }
    }
    if (scenario === 'no license') {
        expect(requests).toBe(0);
    } else {
        expect(closed).toBe(true);
    }
});
