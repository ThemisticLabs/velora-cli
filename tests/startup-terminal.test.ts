import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['yes', 'no', 'cancel'])('setup consent terminal: %s', async function (choice) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-consent-terminal-'));
    var output = '';
    var sent = false;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/startup-update.ts', import.meta.url))], {
        env: { ...process.env, VELORA_TEST_DIRECTORY: directory },
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            output += Buffer.from(bytes).toString('utf8');
            if (sent || !output.includes('[ Save and continue ]')) { return; }
            sent = true;
            if (choice === 'cancel') { terminal.write(' \u001b'); return; }
            var keys = '\u001b[B\u001b[B\u001b[B\u001b[B\r';
            if (choice === 'yes') { keys = ' ' + keys; }
            terminal.write(keys);
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 4000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(sent).toBe(true);
        expect(output).toContain('Setup 2 of 5');
        if (choice === 'cancel') { expect(await readdir(directory)).toEqual([]); return; }
        expect(output).toContain('Setup consent saved.');
        expect(JSON.parse(await readFile(join(directory, 'cli-updates.json'), 'utf8'))).toEqual({ checkAutomatically: choice === 'yes', installAutomatically: false });
        expect(JSON.parse(await readFile(join(directory, 'engine-updates.json'), 'utf8'))).toEqual({ checkAutomatically: false, installAutomatically: false });
    } finally { clearTimeout(timeout); child.kill(); child.terminal?.close(); await rm(directory, { recursive: true, force: true }); }
});
