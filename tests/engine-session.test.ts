import { afterAll, beforeAll, test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import downloadModel from '../src/downloads/download-model.js';
import installedModels from '../src/models/installed-models.js';
import enginePackage from './fixtures/engine-package.js';
import engineSession from '../src/engine/engine-session.js';
import bootstrapEngine from '../src/engine/bootstrap-engine.js';

var directory: string;
var executable: string;
beforeAll(async function () {
    directory = await mkdtemp(join(tmpdir(), 'velora-engine-process-'));
    executable = join(directory, 'fixture');
    if (process.platform === 'win32') { executable += '.exe'; }
    execFileSync(process.execPath, ['build', './tests/fixtures/engine-process.ts', '--compile', '--outfile', executable], { stdio: 'pipe' });
});
afterAll(async function () { await rm(directory, { recursive: true, force: true }); });

test('engine exit status survives a preceding stdin error', function () {
    var fixture = fileURLToPath(new URL('./fixtures/engine-connection-error.ts', import.meta.url));
    var result = Bun.spawnSync([process.execPath, fixture]);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain('Connection error verified.');
});

test.each(['compatible', 'engine update required'])('new models reuse one verified engine: %s', async function (scenario) {
    var storage = await mkdtemp(join(tmpdir(), 'velora-shared-engine-'));
    var previousScenario = process.env.VELORA_TEST_ENGINE_SCENARIO;
    var previousLog = process.env.VELORA_TEST_ENGINE_REQUEST_LOG;
    process.env.VELORA_TEST_ENGINE_SCENARIO = 'install-valid';
    process.env.VELORA_TEST_ENGINE_REQUEST_LOG = join(storage, 'engine-requests.log');
    try {
        var fixture = await enginePackage('valid', '0.4.1', 'engine-r1', 1, await readFile(executable));
        var signal = new AbortController().signal;
        var options = { directory: storage, transport: fixture.transport, publicKey: fixture.publicKey, target: 'macosx-14.0-arm64' };
        var initial = await bootstrapEngine('FIXTURE-LICENSE', signal, undefined, options);
        var requestCount = fixture.requests.length;
        var saved = await readFile(join(storage, 'engine', 'bootstrap.json'));
        var initialFiles = await readdir(join(storage, 'engine'), { recursive: true });
        initialFiles.sort();
        var originalExecutable = await stat(initial.executable);
        var bootstrap: typeof bootstrapEngine = function (license, operationSignal, progress) {
            return bootstrapEngine(license, operationSignal, progress, options);
        };
        var connect: typeof engineSession = function (license, operationSignal, progress) {
            return engineSession(license, operationSignal, progress, bootstrap);
        };
        var messages: string[] = [];
        var onProgress = function (progress: { message: string }) { messages.push(progress.message); };
        await downloadModel({ license: 'FIXTURE-LICENSE', modelId: 'model-a', root: join(storage, 'models', 'model-a'), signal, onProgress, connect });
        expect(fixture.requests.length).toBe(requestCount);
        // A newer advertised release must not turn a model request into an engine update.
        fixture.release.version = '0.4.2';
        fixture.release.revision = 'engine-r2';
        fixture.release.sequence = 2;
        if (scenario === 'engine update required') {
            process.env.VELORA_TEST_ENGINE_SCENARIO = 'install-update-required';
        }
        var second = downloadModel({ license: 'FIXTURE-LICENSE', modelId: 'model-b', root: join(storage, 'models', 'model-b'), signal, onProgress, connect });
        if (scenario === 'compatible') {
            await second;
            expect((await installedModels({ operation: 'list' }, storage)).length).toBe(2);
        } else {
            await expect(second).rejects.toThrow('Update the engine in Settings');
            expect((await installedModels({ operation: 'list' }, storage)).length).toBe(1);
        }
        expect(fixture.requests.length).toBe(requestCount);
        expect(await readFile(join(storage, 'engine', 'bootstrap.json'))).toEqual(saved);
        var retainedFiles = await readdir(join(storage, 'engine'), { recursive: true });
        retainedFiles.sort();
        expect(retainedFiles).toEqual(initialFiles);
        var retainedExecutable = await stat(initial.executable);
        expect(retainedExecutable.ino).toBe(originalExecutable.ino);
        expect(retainedExecutable.mtimeMs).toBe(originalExecutable.mtimeMs);
        expect(messages).not.toContain('Preparing the engine download.');
        expect(await readFile(join(storage, 'engine-requests.log'), 'utf8')).toBe('version\nmodels\ninstall_model\nversion\nmodels\ninstall_model\n');
        var modelFolders = await readdir(join(storage, 'models'));
        modelFolders.sort();
        expect(modelFolders).toEqual(['model-a', 'model-b']);
    } finally {
        if (previousScenario === undefined) { delete process.env.VELORA_TEST_ENGINE_SCENARIO; } else { process.env.VELORA_TEST_ENGINE_SCENARIO = previousScenario; }
        if (previousLog === undefined) { delete process.env.VELORA_TEST_ENGINE_REQUEST_LOG; } else { process.env.VELORA_TEST_ENGINE_REQUEST_LOG = previousLog; }
        await rm(storage, { recursive: true, force: true });
    }
}, 120000);

test.each(['valid', 'progress', 'error', 'exit', 'exit-error', 'hang', 'oversized', 'malformed', 'wrong id', 'old version', 'no capability', 'install-valid', 'install-unconfirmed'])('local engine protocol: %s', async function (scenario) {
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
        if (scenario === 'exit-error') {
            await expect(task).rejects.toThrow('Exit code: 7.');
            return;
        }
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
            expect((await session.request('version')).version).toBe('0.4.1');
        } else if (scenario === 'progress') {
            await session.request('install_model', { model_id: 'model-a' });
            expect(progress).toEqual([0, 1, 0]);
        } else {
            expect(await session.request('models', { license_key: 'FIXTURE-LICENSE' })).toEqual({ status: 'ok', models: [] });
        }
    } finally {
        clearTimeout(timer);
        await session?.close();
        if (previous === undefined) { delete process.env.VELORA_TEST_ENGINE_SCENARIO; } else { process.env.VELORA_TEST_ENGINE_SCENARIO = previous; }
    }
}, 15000);
