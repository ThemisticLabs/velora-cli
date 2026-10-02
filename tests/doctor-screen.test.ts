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


test.skipIf(process.platform === 'win32')('completed doctor results remain reachable in a small terminal and after resize', async function () {
    var output = '';
    var phase = 0;
    var decoder = new TextDecoder();
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/doctor-screen.ts', import.meta.url)), 'scroll'], {
        env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: undefined, FORCE_COLOR: '1' },
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            output += decoder.decode(bytes, { stream: true });
            var frame = output.slice(output.lastIndexOf('\u001b[H\u001b[2J'));
            if (!frame.includes('Checks complete.') || !frame.includes('Press F1 to open documentation')) { return; }
            if (phase === 0 && frame.includes('↓ More below')) {
                expect(frame).toContain('EARLY STORAGE FAILURE');
                expect(frame).not.toContain('FINAL INFERENCE RESULT');
                phase++;
                terminal.write('\u001b[B');
                return;
            }
            if (phase === 1 && frame.includes('↑ More above') && frame.includes('EARLY STORAGE FAILURE')) {
                phase++;
                terminal.write('\u001b[F');
                return;
            }
            if (phase === 2 && frame.includes('FINAL INFERENCE RESULT')) {
                expect(frame).toContain('FINAL INFERENCE RESULT');
                expect(frame).not.toContain('EARLY STORAGE FAILURE');
                phase++;
                terminal.write('\u001b[A');
                return;
            }
            if (phase === 3 && frame.includes('↓ More below') && !frame.includes('FINAL INFERENCE RESULT')) {
                phase++;
                terminal.write('\u001b[H');
                return;
            }
            if (phase === 4 && frame.includes('EARLY STORAGE FAILURE')) {
                phase++;
                terminal.resize(90, 45);
                return;
            }
            if (phase === 5 && frame.includes('EARLY STORAGE FAILURE') && frame.includes('FINAL INFERENCE RESULT')) {
                phase++;
                terminal.write('\r');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(phase).toBe(6);
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
