import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['yes', 'no', 'cancel'])('startup consent terminal: %s', async function (choice) {
    var root = await mkdtemp(join(tmpdir(), 'velora-startup-'));
    try {
        for (var launch = 0; launch < 3; launch++) {
            var output = '';
            var sent = false;
            var answeredInstallation = false;
            var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/startup-update.ts', import.meta.url))], {
                env: { ...process.env, VELORA_TEST_DIRECTORY: root },
                terminal: {
                    cols: 90, rows: 30,
                    data: function (terminal, data) {
                        output += Buffer.from(data).toString('utf8');
                        if (sent && !answeredInstallation && output.includes('Allow automatic installation when available?')) {
                            answeredInstallation = true;
                            terminal.write('\r');
                        }
                        if (sent || !output.includes('Check for velora updates on startup?')) {
                            return;
                        }
                        sent = true;
                        if (choice === 'cancel') {
                            terminal.write('\u0003');
                            return;
                        }
                        if (choice === 'yes') {
                            terminal.write('\u001b[B');
                        }
                        terminal.write('\r');
                    }
                }
            });
            var TEST_TIMEOUT_MS = 4000;
            var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
            try {
                expect(await child.exited).toBe(0);
                if (launch === 0) {
                    expect(sent).toBe(false);
                    expect(await readdir(root)).toEqual(['cli-updates.json']);
                    expect(JSON.parse(await readFile(join(root, 'cli-updates.json'), 'utf8'))).toEqual({ checkAutomatically: null, installAutomatically: null });
                    continue;
                }
                if (choice === 'cancel') {
                    expect(output).toContain('Cancelled.');
                    expect(JSON.parse(await readFile(join(root, 'cli-updates.json'), 'utf8'))).toEqual({ checkAutomatically: null, installAutomatically: null });
                    expect(sent).toBe(true);
                    continue;
                }
                expect(output).toContain('Usage:');
                expect(sent).toBe(launch === 1);
                expect(JSON.parse(await readFile(join(root, 'cli-updates.json'), 'utf8'))).toEqual({ checkAutomatically: choice === 'yes', installAutomatically: false });
                if (choice === 'yes') {
                    expect(await readFile(join(root, 'requests'), 'utf8')).toBe('request\n'.repeat(launch));
                } else {
                    expect(await readdir(root)).toEqual(['cli-updates.json']);
                }
            } finally {
                clearTimeout(timeout);
                child.kill();
                child.terminal?.close();
            }
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
