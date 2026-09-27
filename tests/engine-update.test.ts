import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import engineRuntime from '../src/engine/engine-runtime.js';
import engineUpdate from '../src/updates/engine-update.js';
import enginePackage from './fixtures/engine-package.js';

test.each(['newer', 'current', 'older', 'missing', 'invalid', 'no license', 'missing runtime', 'corrupt runtime'])('independent engine update: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-engine-check-'));
    try {
        var fixture = await enginePackage();
        var installed = { ...fixture.release, version: '0.4.1' };
        await mkdir(join(directory, 'engine'));
        if (scenario !== 'missing') {
            var value = JSON.stringify(installed);
            if (scenario === 'invalid') { value = '{broken'; }
            await writeFile(join(directory, 'engine', 'bootstrap.json'), value);
        }
        var installation = join(directory, 'engine', installed.revision);
        if (scenario !== 'missing runtime') {
            await mkdir(join(installation, 'package'), { recursive: true });
            for (var [name, bytes] of Object.entries(fixture.files)) {
                await writeFile(join(installation, 'package', name), bytes);
            }
            await engineRuntime(join(installation, 'package'), join(installation, 'runtime'), installed, new AbortController().signal, fixture.publicKey);
            if (scenario === 'corrupt runtime') {
                await writeFile(join(installation, 'runtime', 'themistic-engine', 'themistic-engine'), 'corrupted');
            }
        }
        var version = '0.4.2';
        if (scenario === 'current') { version = '0.4.1'; }
        if (scenario === 'older') { version = '0.4.0'; }
        var availableFixture = await enginePackage('valid', version);
        var release = availableFixture.release;
        var requests = 0;
        var report = await engineUpdate(new AbortController().signal, {
            install: async function () { throw new Error('A check must not install an engine.'); },
            verify: async function (packagePath, runtimePath, release, signal) { return engineRuntime(packagePath, runtimePath, release, signal, fixture.publicKey); },
            directory: function () { return directory; },
            target: async function () { return 'macosx-14.0-arm64'; },
            store: async function () { if (scenario === 'no license') { return null; } return 'FIXTURE-LICENSE'; },
            request: async function (binding) {
                requests++;
                expect(binding).toEqual({ operation: 'resolve', license_key: 'FIXTURE-LICENSE', runtime_target: 'macosx-14.0-arm64' });
                return { metadata: { engine: release }, body: Buffer.alloc(0) };
            }
        });
        if (scenario === 'newer' || scenario === 'missing') {
            expect(report.available).toBe('0.4.2');
        } else {
            expect(report.available).toBeUndefined();
            if (scenario !== 'current' && scenario !== 'older') { expect(report.current).not.toBe(true); }
        }
        if (scenario === 'no license' || scenario === 'invalid' || scenario === 'missing runtime' || scenario === 'corrupt runtime') { expect(requests).toBe(0); }
        if (scenario === 'current' || scenario === 'older') { expect(report.installed).toBe('0.4.1'); }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
