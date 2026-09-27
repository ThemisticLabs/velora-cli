import { afterAll, beforeAll, test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import downloadModel from '../src/downloads/download-model.js';
import installedModels from '../src/models/installed-models.js';
import enginePackage from './fixtures/engine-package.js';
import engineSession from '../src/engine/engine-session.js';
import type bootstrapEngine from '../src/engine/bootstrap-engine.js';

var directory: string;
var executable: string;
beforeAll(async function () {
    directory = await mkdtemp(join(tmpdir(), 'velora-engine-process-'));
    executable = join(directory, 'fixture');
    if (process.platform === 'win32') { executable += '.exe'; }
    execFileSync(process.execPath, ['build', './tests/fixtures/engine-process.ts', '--compile', '--outfile', executable], { stdio: 'pipe' });
});
afterAll(async function () { await rm(directory, { recursive: true, force: true }); });

test.each(['valid', 'progress', 'error', 'exit', 'hang', 'oversized', 'malformed', 'wrong id', 'old version', 'no capability', 'install-valid', 'install-unconfirmed'])('local engine protocol: %s', async function (scenario) {
    var previous = process.env.VELORA_TEST_ENGINE_SCENARIO;
    process.env.VELORA_TEST_ENGINE_SCENARIO = scenario;
    var controller = new AbortController();
    var fixture = await enginePackage();
    var bootstrap: typeof bootstrapEngine = async function () {
        return { executable, packagePath: directory, runtimePath: directory, release: fixture.release, target: 'macosx-14.0-arm64' };
    };
    var progress: number[] = [];
    var session: Awaited<ReturnType<typeof engineSession>> | undefined;
    var timer: ReturnType<typeof setTimeout> | undefined;
    try {
        if (scenario === 'hang') { timer = setTimeout(function () { controller.abort(); }, 100); }
        if (scenario.startsWith('install-')) {
            var installationRoot = await mkdtemp(join(tmpdir(), 'velora-process-install-'));
            try {
                var transfer = downloadModel({ license: 'FIXTURE-LICENSE', modelId: 'model-a',
                    root: join(installationRoot, 'models', 'model-a'), signal: controller.signal,
                    connect: function (license, signal, onProgress) { return engineSession(license, signal, onProgress, bootstrap); },
                    onProgress: function (event) { progress.push(event.downloaded); } });
                if (scenario === 'install-valid') {
                    await transfer;
                    expect((await installedModels({ operation: 'list' }, installationRoot))[0]?.id).toBe('model-a');
                    expect(progress).toContain(1);
                } else {
                    await expect(transfer).rejects.toThrow('did not confirm');
                    expect(await installedModels({ operation: 'list' }, installationRoot)).toEqual([]);
                }
                var entries = await readdir(join(installationRoot, 'models'));
                expect(entries).not.toContain('engine');
                expect(entries).not.toContain('.velora.lock');
            } finally {
                await rm(installationRoot, { recursive: true, force: true });
            }
            return;
        }
        var task = engineSession('FIXTURE-LICENSE', controller.signal, function (value) { progress.push(value.downloaded); }, bootstrap);
        if (!['valid', 'progress', 'error', 'no capability'].includes(scenario)) {
            await expect(task).rejects.toBeInstanceOf(Error);
            return;
        }
        session = await task;
        if (scenario === 'no capability') {
            await expect(session.request('install_model', { model_id: 'model-a' })).rejects.toThrow('Update the engine in Settings');
            expect(await session.request('models', { license_key: 'FIXTURE-LICENSE' })).toEqual({ status: 'ok', models: [] });
        } else if (scenario === 'error') {
            await expect(session.request('models', { license_key: 'FIXTURE-LICENSE' })).rejects.toThrow('verified installation');
        } else if (scenario === 'progress') {
            await session.request('install_model', { model_id: 'model-a' });
            expect(progress).toEqual([1, 0]);
        } else {
            expect(await session.request('models', { license_key: 'FIXTURE-LICENSE' })).toEqual({ status: 'ok', models: [] });
        }
    } finally {
        clearTimeout(timer);
        await session?.close();
        if (previous === undefined) { delete process.env.VELORA_TEST_ENGINE_SCENARIO; } else { process.env.VELORA_TEST_ENGINE_SCENARIO = previous; }
    }
});
