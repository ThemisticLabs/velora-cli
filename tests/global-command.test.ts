import { test, expect } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };

test('bun link registers velora and runs it outside the source checkout', async function () {
    var root = await mkdtemp(join(tmpdir(), 'velora-global-command-'));
    var globalDirectory = join(root, 'global');
    var binDirectory = join(root, 'bin');
    var environment = { ...process.env, BUN_INSTALL: root, BUN_INSTALL_GLOBAL_DIR: globalDirectory, BUN_INSTALL_BIN: binDirectory };
    var COMMAND_TIMEOUT_MS = 10000;
    try {
        await mkdir(globalDirectory);
        await mkdir(binDirectory);
        await writeFile(join(globalDirectory, 'package.json'), '{}');
        var location = Bun.spawnSync([process.execPath, 'pm', 'bin', '-g'], { env: environment, timeout: COMMAND_TIMEOUT_MS });
        expect(location.exitCode, location.stderr.toString()).toBe(0);
        expect(await realpath(location.stdout.toString().trim())).toBe(await realpath(binDirectory));

        var linked = Bun.spawnSync([process.execPath, 'link'], {
            cwd: fileURLToPath(new URL('../', import.meta.url)), env: environment, timeout: COMMAND_TIMEOUT_MS
        });
        expect(linked.exitCode, linked.stderr.toString()).toBe(0);
        var executable = join(binDirectory, 'velora');
        if (process.platform === 'win32') { executable += '.exe'; }
        var version = Bun.spawnSync([executable, '--version'], { cwd: root, env: environment, timeout: COMMAND_TIMEOUT_MS });
        expect(version.exitCode, version.stderr.toString()).toBe(0);
        expect(version.stdout.toString().trim()).toBe(packageInfo.version);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
