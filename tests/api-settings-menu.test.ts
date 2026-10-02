import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['save', 'invalid', 'back', 'default', 'unreadable', 'reset'])('API port menu: %s', async function (scenario) {
    var output = '';
    var coloredOutput = '';
    var phase = 0;
    var decoder = new TextDecoder();
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/api-settings.ts', import.meta.url)), scenario], {
        env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: undefined, FORCE_COLOR: '1' },
        terminal: { cols: 70, rows: 22, data: function (terminal, bytes) {
            var raw = decoder.decode(bytes, { stream: true });
            coloredOutput += raw;
            var frame = stripVTControlCharacters(raw);
            output = stripVTControlCharacters(coloredOutput);
            if (phase === 0 && scenario === 'unreadable' && frame.includes('Could not read API settings')) {
                phase = 3;
                terminal.write('\u001b');
                return;
            }
            if (phase === 0 && frame.includes('Reset to default')) {
                phase = 1;
                if (scenario === 'reset') {
                    terminal.write('\u001b[A\r');
                    return;
                }
                terminal.write('\r');
                return;
            }
            if (phase === 1 && frame.includes('Enter Save')) {
                phase = 2;
                if (scenario === 'back') {
                    terminal.write('\u00159000\u001b');
                    return;
                }
                if (scenario === 'default') {
                    terminal.write('\r');
                    return;
                }
                if (scenario === 'invalid') {
                    terminal.write('\u001565536\r');
                    return;
                }
                terminal.write('\u00159000\r');
                return;
            }
            if (phase === 2 && scenario === 'back' && frame.includes('Reset to default')) {
                phase = 4;
                terminal.write('\u001b');
                return;
            }
            if (phase === 2 && scenario === 'invalid' && frame.includes('Choose a port')) {
                phase = 3;
                terminal.write('\u00159000\r');
                return;
            }
            if (phase > 0 && phase < 4 && frame.includes('Saved.')) {
                phase = 4;
                expect(frame).toContain('Reset to default');
                if (scenario === 'reset') {
                    terminal.write('\u001b[B\r');
                    return;
                }
                terminal.write('\u001b');
                return;
            }
            if (phase === 4 && scenario === 'reset' && frame.includes('Enter Save')) {
                phase = 5;
                expect(frame).toContain('Port: 8001');
                terminal.write('\u001b');
                return;
            }
            if (phase === 5 && frame.includes('Reset to default')) {
                phase = 6;
                terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Port settings verified.');
        if (scenario === 'save' || scenario === 'invalid') {
            expect(output).toContain('Port: 9000');
            expect(output).toContain('Saved.');
            expect(output).not.toContain('Port saved:');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
