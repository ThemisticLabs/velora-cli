import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import dataDirectory from './data-directory.js';
import { IS_COMPILED } from './build-mode.js';

export default async function menuBar(directory = dataDirectory()): Promise<{ available: boolean }> {
    if (process.platform !== 'darwin') { return { available: true }; }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    var readyPath = join(directory, 'menubar-ready.json');
    try {
        var ready = JSON.parse(await readFile(readyPath, 'utf8'));
        if (Number.isSafeInteger(ready.pid) && ready.pid > 0) {
            process.kill(ready.pid, 0);
            return { available: true };
        }
    } catch {}
    var args = ['--menubar-worker', directory];
    if (!IS_COMPILED) {
        args.unshift(fileURLToPath(new URL('../cli.ts', import.meta.url)));
        args.unshift('run');
    }
    var child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    var failed = false;
    child.once('error', function () { failed = true; });
    child.unref();
    var START_TIMEOUT_MS = 5000;
    var READY_POLL_MS = 50;
    var deadline = Date.now() + START_TIMEOUT_MS;
    while (!failed && Date.now() < deadline) {
        try {
            var ready = JSON.parse(await readFile(readyPath, 'utf8'));
            if (Number.isSafeInteger(ready.pid) && ready.pid > 0) {
                process.kill(ready.pid, 0);
                return { available: true };
            }
        } catch {}
        await Bun.sleep(READY_POLL_MS);
    }
    return { available: false };
}
