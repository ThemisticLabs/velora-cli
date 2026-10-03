import { test, expect, beforeAll, afterAll } from 'bun:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, copyFile, chmod, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import installCliUpdate from '../src/updates/install-cli-update.js';
import releaseMetadata from '../src/updates/release-metadata.js';
import launchUpdateWorker from '../src/updates/launch-update-worker.js';
import updateState, { type UpdateState } from '../src/updates/update-state.js';
import updateFile from '../src/updates/update-file.js';
import directoryLock from '../src/system/directory-lock.js';
import { lstat } from 'node:fs/promises';
import selfTest from '../src/updates/self-test.js';
import apiKeys from '../src/api/api-keys.js';

var root = '';
var binary = '';
var keys = generateKeyPairSync('ed25519');
var publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

beforeAll(async function () {
    root = await mkdtemp(join(tmpdir(), 'velora-update-tests-'));
    binary = join(root, 'fixture');
    if (process.platform === 'win32') { binary += '.exe'; }
    var build = Bun.spawn([process.execPath, 'build', resolve('tests/fixtures/update-binary.ts'), '--compile', '--define', 'VELORA_COMPILED=true', '--outfile', binary], { stdout: 'ignore', stderr: 'pipe' });
    expect(await build.exited).toBe(0);
}, 60000);
afterAll(async function () { await rm(root, { recursive: true, force: true }); });

test.each(['signature', 'tampered', 'wrong-version', 'missing-platform', 'duplicate', 'oversized'])('signed metadata rejects unsafe releases: %s', function (scenario) {
    var manifest = { schemaVersion: 1, version: '1.0.0', assets: [{ name: 'velora-linux-x64', platform: 'linux', arch: 'x64', size: 128, sha256: 'a'.repeat(64) }] };
    if (scenario === 'wrong-version') { manifest.version = '2.0.0'; }
    if (scenario === 'missing-platform') { manifest.assets = []; }
    if (scenario === 'duplicate') { manifest.assets.push(manifest.assets[0]!); }
    if (scenario === 'oversized') { manifest.assets[0]!.size = 1024 ** 3; }
    var bytes = Buffer.from(JSON.stringify(manifest));
    var signature = sign(null, bytes, keys.privateKey);
    if (scenario === 'signature') { signature[0] = signature[0]! ^ 1; }
    if (scenario === 'tampered') { bytes = Buffer.from(bytes.toString().replace('128', '129')); }
    expect(function () { releaseMetadata(bytes, signature, '1.0.0', 'linux', 'x64', publicKey); }).toThrow();
});

test.each(['valid', 'bad-hash', 'bad-signature', 'bad-self-test', 'launch-failure', 'cancel'])('update preparation preserves the running binary and data: %s', async function (scenario) {
    var directory = await mkdtemp(join(root, 'prepare-'));
    var executable = join(directory, 'installed');
    await writeFile(executable, 'original binary', { mode: 0o755 });
    executable = await realpath(executable);
    await writeFile(join(directory, 'user-data'), 'keep this');
    var bytes = await readFile(binary);
    if (scenario === 'bad-self-test') { bytes = Buffer.from('not executable'); }
    var name = 'velora-' + process.platform + '-' + process.arch;
    if (process.platform === 'win32') { name = 'velora-windows-' + process.arch + '.exe'; }
    var hash = createHash('sha256').update(bytes).digest('hex');
    if (scenario === 'bad-hash') { hash = '0'.repeat(64); }
    var manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, version: '1.0.0', assets: [{ name, platform: process.platform, arch: process.arch, size: bytes.length, sha256: hash }] }));
    var signature = sign(null, manifest, keys.privateKey);
    if (scenario === 'bad-signature') { signature[0] = signature[0]! ^ 1; }
    var controller = new AbortController();
    var launched = false;
    var options = { executable, directory, publicKey, currentVersion: '0.0.1',
        transport: async function (input: string | URL | Request): Promise<Response> {
            var url = String(input);
            if (url.endsWith('release.json')) { return new Response(manifest); }
            if (url.endsWith('release.sig')) { return new Response(signature); }
            if (scenario === 'cancel') { controller.abort(); }
            return new Response(bytes);
        } as typeof fetch,
        launch: async function (): Promise<number> { launched = true; if (scenario === 'launch-failure') { throw new Error('Helper refused'); } return 123; }
    };
    try {
        if (scenario === 'valid') {
            await installCliUpdate('1.0.0', controller.signal, undefined, options);
            expect(launched).toBe(true);
            expect((await updateState(executable))?.phase).toBe('prepared');
            await expect(installCliUpdate('1.0.0', controller.signal, undefined, options)).rejects.toThrow('Another operation');
        } else {
            await expect(installCliUpdate('1.0.0', controller.signal, undefined, options)).rejects.toThrow();
            expect(await updateState(executable)).toBeNull();
            expect(await readdir(directory)).toEqual(expect.arrayContaining(['installed', 'user-data']));
            expect((await readdir(directory)).length).toBe(2);
        }
        expect(await readFile(executable, 'utf8')).toBe('original binary');
        expect(await readFile(join(directory, 'user-data'), 'utf8')).toBe('keep this');
    } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);

test.each(['install', 'rollback', 'interrupted', 'changed-target'])('compiled update helper installs or restores atomically: %s', async function (scenario) {
    var directory = await mkdtemp(join(root, 'apply-'));
    var workdir = await mkdtemp(join(directory, '.velora-update-'));
    var executable = join(directory, 'installed');
    if (scenario === 'rollback') { executable = join(directory, 'reject-installed'); }
    if (process.platform === 'win32') { executable += '.exe'; }
    var candidate = join(workdir, 'candidate');
    if (process.platform === 'win32') { candidate += '.exe'; }
    await writeFile(executable, 'original binary', { mode: 0o755 });
    await copyFile(binary, candidate);
    await chmod(candidate, 0o700);
    var parent = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' });
    await parent.exited;
    var lease = await directoryLock({ operation: 'acquire', path: executable + '.update.lock' });
    var state: UpdateState = { phase: 'prepared', workdir, version: '1.0.0', previousVersion: '0.0.1', previousHash: await updateFile(executable), nextHash: await updateFile(candidate), target: executable, dataDirectory: directory, parentPid: parent.pid, workerPid: 0, lockToken: lease.token };
    if (scenario === 'interrupted') {
        await updateFile(executable, join(workdir, 'previous'));
        await copyFile(candidate, executable);
        state.phase = 'installing';
    }
    if (scenario === 'changed-target') { await writeFile(executable, 'user replaced binary'); }
    await updateState(executable, state);
    var plan = join(workdir, 'plan.json');
    await writeFile(plan, JSON.stringify(state));
    if (scenario === 'interrupted') {
        await directoryLock({ operation: 'release', path: executable + '.update.lock', lease });
        lease = await directoryLock({ operation: 'acquire', path: executable + '.update.lock' });
        state.lockToken = lease.token;
        await updateState(executable, state);
    }
    var args = [candidate, '--finish-update', plan];
    if (scenario === 'interrupted') { args.push('--restore'); }
    try {
        var helper = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
        var output = await new Response(helper.stdout).text();
        expect(await helper.exited).toBe(0);
        expect(output).toBe('ready\n');
        var result = await updateState(executable);
        if (scenario === 'install') {
            expect(result?.phase).toBe('installed');
            expect(await updateFile(executable)).toBe(state.nextHash);
            expect(await readFile(join(workdir, 'previous'), 'utf8')).toBe('original binary');
        } else if (scenario === 'changed-target') {
            expect(result?.phase).toBe('failed');
            expect(await readFile(executable, 'utf8')).toBe('user replaced binary');
        } else {
            expect(result?.phase).toBe('restored');
            expect(await readFile(executable, 'utf8')).toBe('original binary');
        }
        await directoryLock({ operation: 'release', path: executable + '.update.lock', lease });
        expect(await readdir(directory)).not.toContain('installed.update.lock');
        if (process.platform !== 'win32' && scenario !== 'changed-target') {
            expect((await lstat(executable)).mode & 0o777).toBe(0o755);
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);

test('self-test reads saved hashes and settings without modifying user data', async function () {
    var directory = await mkdtemp(join(root, 'data-'));
    try {
        await apiKeys({ operation: 'create', name: 'Application', note: 'Keep' }, directory);
        await writeFile(join(directory, 'selected-model.json'), JSON.stringify({ id: 'skira7alpha3' }));
        var path = join(directory, 'api-keys.json');
        var contents = await readFile(path, 'utf8');
        await selfTest(directory);
        expect(await readFile(path, 'utf8')).toBe(contents);
        await writeFile(join(directory, 'selected-model.json'), '{}');
        await expect(selfTest(directory)).rejects.toThrow('selection');
        expect(await readFile(path, 'utf8')).toBe(contents);
    } finally { await rm(directory, { recursive: true, force: true }); }
});


test('detached update helper acknowledges readiness and finishes after its parent exits', async function () {
    var directory = await mkdtemp(join(root, 'handoff-'));
    var workdir = await mkdtemp(join(directory, '.velora-update-'));
    var executable = join(directory, 'installed');
    var candidate = join(workdir, 'candidate');
    if (process.platform === 'win32') { executable += '.exe'; candidate += '.exe'; }
    await writeFile(executable, 'original binary', { mode: 0o755 });
    await copyFile(binary, candidate);
    await chmod(candidate, 0o700);
    var parent = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' });
    await parent.exited;
    var lease = await directoryLock({ operation: 'acquire', path: executable + '.update.lock' });
    var state: UpdateState = { phase: 'prepared', workdir, version: '1.0.0', previousVersion: '0.0.1', previousHash: await updateFile(executable), nextHash: await updateFile(candidate), target: executable, dataDirectory: directory, parentPid: parent.pid, workerPid: 0, lockToken: lease.token };
    var plan = join(workdir, 'plan.json');
    await writeFile(plan, JSON.stringify(state));
    await updateState(executable, state);
    try {
        var pid = await launchUpdateWorker(candidate, plan);
        expect(pid).toBeGreaterThan(0);
        var started = Date.now();
        while (true) {
            try { process.kill(pid, 0); }
            catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ESRCH') { break; }
                throw error;
            }
            if (Date.now() - started > 20000) { process.kill(pid, 'SIGKILL'); throw new Error('Update helper did not finish'); }
            await Bun.sleep(50);
        }
        expect((await updateState(executable))?.phase).toBe('installed');
        expect(await readFile(join(workdir, 'previous'), 'utf8')).toBe('original binary');
    } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);

test('journal sync failure after publication removes the journal before its workspace', async function () {
    var directory = await mkdtemp(join(root, 'journal-fault-'));
    var executable = join(directory, 'installed');
    await writeFile(executable, 'original binary', { mode: 0o755 });
    await writeFile(join(directory, 'user-data'), 'keep this');
    try {
        var child = Bun.spawn([process.execPath, 'run', resolve('tests/fixtures/update-journal-failure.ts'), executable, directory, binary], { stdout: 'pipe', stderr: 'pipe' });
        var output = await new Response(child.stdout).text();
        var errors = await new Response(child.stderr).text();
        expect(errors).toBe('');
        expect(await child.exited).toBe(0);
        expect(output).toBe('clean\n');
        expect(await readFile(executable, 'utf8')).toBe('original binary');
        expect(await readFile(join(directory, 'user-data'), 'utf8')).toBe('keep this');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}, 30000);
