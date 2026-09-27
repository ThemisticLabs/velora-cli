import { afterAll, beforeAll, test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

test.each(['valid', 'progress', 'error', 'exit', 'hang', 'oversized', 'malformed', 'wrong id', 'old version'])('local engine protocol: %s', async function (scenario) {
    var previous = process.env.VELORA_TEST_ENGINE_SCENARIO;
    process.env.VELORA_TEST_ENGINE_SCENARIO = scenario;
    var controller = new AbortController();
    var bootstrap = async function () {
        return { executable, packagePath: directory, release: { version: '0.4.1' }, target: 'macosx-14.0-arm64' };
    } as unknown as typeof bootstrapEngine;
    var progress: number[] = [];
    var session: Awaited<ReturnType<typeof engineSession>> | undefined;
    var timer: ReturnType<typeof setTimeout> | undefined;
    try {
        if (scenario === 'hang') { timer = setTimeout(function () { controller.abort(); }, 100); }
        var task = engineSession('FIXTURE-LICENSE', controller.signal, function (value) { progress.push(value.downloaded); }, bootstrap);
        if (!['valid', 'progress', 'error'].includes(scenario)) {
            await expect(task).rejects.toBeInstanceOf(Error);
            return;
        }
        session = await task;
        if (scenario === 'error') {
            await expect(session.request('models', { license_key: 'FIXTURE-LICENSE' })).rejects.toThrow('verified installation');
        } else if (scenario === 'progress') {
            await session.request('install', { model_id: 'model-a' });
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
