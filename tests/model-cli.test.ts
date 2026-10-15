import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import directoryLock from '../src/system/directory-lock.js';
import servicePaths from '../src/service/service-paths.js';

var executable = '../dist/velora';
if (process.platform === 'win32') {
    executable += '.exe';
}
var CLI_PATH = process.env.VELORA_TEST_BINARY || fileURLToPath(new URL(executable, import.meta.url));

test('compiled model commands expose help and reject missing or extra arguments', function () {
    for (var args of [['models'], ['models', '--help'], ['models', 'list', '--help'], ['models', 'install', '--help'], ['models', 'select', '--help']]) {
        var result = spawnSync(CLI_PATH, args, { cwd: tmpdir(), encoding: 'utf8', timeout: 5000 });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('velora models');
    }
    for (var args of [['models', 'install'], ['models', 'select'], ['models', 'list', 'extra'], ['models', 'select', 'model-a', 'extra']]) {
        var result = spawnSync(CLI_PATH, args, { encoding: 'utf8', timeout: 5000 });
        expect(result.status, result.stderr).toBe(1);
        expect(result.stdout).toBe('');
    }
});

test('compiled model commands list and select isolated packages without license access', async function () {
    var home = await mkdtemp(join(tmpdir(), 'velora-model-cli-'));
    var directory = join(home, 'velora');
    if (process.platform === 'darwin') {
        directory = join(home, 'Library', 'Application Support', 'velora');
    }
    var environment = { ...process.env, HOME: home, XDG_DATA_HOME: home, LOCALAPPDATA: home };
    try {
        var empty = spawnSync(CLI_PATH, ['models', 'list', '--json'], { env: environment, encoding: 'utf8', timeout: 5000 });
        expect(empty.status, empty.stderr).toBe(0);
        expect(JSON.parse(empty.stdout)).toEqual([]);
        var missing = spawnSync(CLI_PATH, ['models', 'select', 'model-a'], { env: environment, encoding: 'utf8', timeout: 5000 });
        expect(missing.status).toBe(1);
        expect(missing.stdout).toBe('');
        expect(missing.stderr).toContain('This model is not installed.');
        for (var id of ['model-a', 'model-b']) {
            var root = join(directory, 'models', id);
            await mkdir(join(root, 'installed', id, 'r1'), { recursive: true });
            await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: id, revision: 'r1', version: '1.0', sequence: 1 }));
        }
        var select = spawnSync(CLI_PATH, ['models', 'select', 'model-b'], { env: environment, encoding: 'utf8', timeout: 5000 });
        expect(select.status, select.stderr).toBe(0);
        expect(select.stdout).toContain('Selected model model-b.');
        expect(JSON.parse(await readFile(join(directory, 'selected-model.json'), 'utf8'))).toEqual({ id: 'model-b' });
        var list = spawnSync(CLI_PATH, ['models', 'list', '--json'], { env: environment, encoding: 'utf8', timeout: 5000 });
        expect(list.status, list.stderr).toBe(0);
        expect(JSON.parse(list.stdout)[1]).toMatchObject({ id: 'model-b', version: '1.0', selected: true });
        var installed = spawnSync(CLI_PATH, ['models', 'install', 'model-a'], { env: environment, encoding: 'utf8', timeout: 5000 });
        expect(installed.status, installed.stderr).toBe(0);
        expect(installed.stdout).toContain('already installed');
        expect(installed.stderr).toBe('');
        var path = servicePaths(directory).lock;
        var lease = await directoryLock({ operation: 'acquire', path });
        try {
            var busy = spawnSync(CLI_PATH, ['models', 'select', 'model-a'], { env: environment, encoding: 'utf8', timeout: 5000 });
            expect(busy.status).toBe(1);
            expect(busy.stderr).toContain('Stop the velora service');
            expect(JSON.parse(await readFile(join(directory, 'selected-model.json'), 'utf8')).id).toBe('model-b');
        } finally {
            await directoryLock({ operation: 'release', path, lease });
        }
        var invalid = spawnSync(CLI_PATH, ['models', 'install', '../outside'], { env: environment, encoding: 'utf8', timeout: 5000 });
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('Invalid model identifier');
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('compiled model commands reject unknown subcommands', function () {
    var result = spawnSync(CLI_PATH, ['models', 'unexpected-command'], { encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
});
