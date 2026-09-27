import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['valid', 'unknown', 'offline', 'retry', 'change', 'escape'])('startup license recovery: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var child = spawn([process.execPath, fileURLToPath(new URL('./fixtures/startup-license.ts', import.meta.url)), scenario], {
        terminal: { cols: 80, rows: 24, data: function (terminal, bytes) {
            var frame = Buffer.from(bytes).toString();
            output += frame;
            if (frame.includes('Continue to menu') && (phase === 0 || phase === 2)) {
                if (phase === 2 || scenario === 'unknown' || scenario === 'offline') {
                    phase = 3;
                    terminal.write('\u001b[B\u001b[B\r');
                } else if (scenario === 'retry') {
                    phase = 1;
                    terminal.write('\u001b[B\r');
                } else {
                    phase = 1;
                    terminal.write('\r');
                }
            }
            if (phase === 1 && frame.includes('License key:')) {
                phase = 2;
                if (scenario === 'escape') { terminal.write('\u001b'); }
                else { terminal.write('FIXTURE-NEW-KEY\r'); }
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Startup verified.');
        expect(output).not.toContain('FIXTURE-PRIVATE');
        if (scenario === 'offline') { expect(output).not.toContain('has expired'); }
        if (scenario === 'unknown') { expect(output).toContain('This license key was not found.'); }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
