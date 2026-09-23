import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['error', 'disk full', 'cleanup failure', 'cancel-after-install', 'cancel-during-finalize', 'cancel-before-install'])('download terminal: %s', async function (scenario) {
    var root = await mkdtemp(join(tmpdir(), 'velora-terminal-'));
    var output = '';
    var sent = false;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/download-screen.ts', import.meta.url)), scenario], {
        env: { ...process.env, VELORA_TEST_DIRECTORY: root },
        terminal: {
            cols: 90, rows: 30,
            data: function (terminal, data) {
                output += Buffer.from(data).toString('utf8');
                if (sent) {
                    return;
                }
                if (['error', 'disk full', 'cleanup failure'].includes(scenario) && output.includes('Enter Continue')) {
                    sent = true;
                    terminal.write('\r');
                }
                if (scenario === 'cancel-after-install' && output.includes('Download complete.') ||
                    scenario === 'cancel-during-finalize' && output.includes('Finishing fixture installation.') ||
                    scenario === 'cancel-before-install' && output.includes('Waiting for fixture transfer.')) {
                    sent = true;
                    terminal.write('\u0003');
                }
            }
        }
    });
    var TEST_TIMEOUT_MS = 4000;
    var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
    try {
        expect(await child.exited).toBe(0);
        expect(sent).toBe(true);
        expect(output).not.toContain('TEST-LICENSE-KEY');
        expect(output).not.toContain('Engine version not supplied');
        expect(output).not.toContain('Local API setup comes next');
        expect(output).toContain('\u001b[?1049l');
        if (scenario === 'cleanup failure') {
            expect(output).toContain('Installed, but cleanup failed.');
            expect(output).toContain('Outcome: complete');
        } else if (scenario === 'error') {
            expect(output).toContain('Download failed. Check your connection and try again.');
            expect(output).toContain('Outcome: failed');
        } else if (scenario === 'disk full') {
            expect(output).toContain('Not enough storage space.');
            expect(output).not.toContain('Private filesystem diagnostic');
            expect(output).toContain('Outcome: failed');
        } else if (scenario === 'cancel-before-install') {
            expect(output).toContain('Outcome: cancelled\r');
        } else {
            expect(output).toContain('Outcome: cancelled-after-install');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
        await rm(root, { recursive: true, force: true });
    }
});
