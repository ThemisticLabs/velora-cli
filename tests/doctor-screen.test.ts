import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['complete', 'back', 'resize'])('doctor screen progress, logs and navigation: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/doctor-screen.ts', import.meta.url)), scenario], {
        env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: undefined, FORCE_COLOR: '1' },
        terminal: { cols: 70, rows: 24, data: function (terminal, bytes) {
            var frame = Buffer.from(bytes).toString('utf8');
            output += frame;
            if (phase === 0 && frame.includes('Checking 127.0.0.1')) {
                phase = 1;
                if (scenario === 'back') { terminal.write('\u001b'); }
                if (scenario === 'resize') { terminal.resize(40, 10); }
                return;
            }
            if (scenario === 'resize' && phase === 1 && frame.includes('Enlarge terminal')) {
                phase = 2;
                terminal.resize(70, 24);
                return;
            }
            if (frame.includes('Checks complete.')) {
                expect(output).toContain('100%');
                expect(output).toContain('Available now');
                expect(output).toContain('\u001b[32mOK  Local API port');
                expect(output).toContain('\u001b[38;5;208mWarning  Global command');
                expect(output).toContain('\u001b[31mError  License');
                terminal.write('\r');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Doctor screen verified.');
        expect(output).toContain('50%');
        expect(output).not.toContain('These checks do not verify');
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
