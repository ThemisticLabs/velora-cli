import { test, expect } from 'bun:test';
import { dirname } from 'node:path';
import enginePackage from './fixtures/engine-package.js';
import engineSession from '../src/engine/engine-session.js';
import type bootstrapEngine from '../src/engine/bootstrap-engine.js';

var executable = process.env.VELORA_TEST_ENGINE_BINARY;
test.skipIf(!executable)('native 0.4.4 protocol rejects combined installation', async function () {
    var fixture = await enginePackage('valid', '0.4.4');
    var bootstrap: typeof bootstrapEngine = async function () {
        return { executable: executable!, packagePath: dirname(executable!), runtimePath: dirname(executable!),
            release: fixture.release, target: fixture.release.runtime_target };
    };
    var session = await engineSession('ISOLATED-TEST-LICENSE', AbortSignal.timeout(10000), undefined, bootstrap);
    try {
        var version = await session.request('version');
        expect(version.version).toBe('0.4.4');
        expect(version.capabilities).toContain('install_model');
        await expect(session.request('install')).rejects.toThrow('The engine rejected the request');
        await expect(session.request('install_model')).rejects.toThrow('The engine rejected the request');
    } finally {
        await session.close();
    }
}, 15000);
