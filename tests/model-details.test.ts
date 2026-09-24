import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['install', 'back', 'resize', 'unavailable'])('model details terminal: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var decoder = new TextDecoder();
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/model-details.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            var frame = stripVTControlCharacters(decoder.decode(bytes, { stream: true }));
            output += frame;
            if (phase === 0 && frame.includes('Your models.')) {
                phase++;
                terminal.write('\r');
                return;
            }
            if (phase === 1 && frame.includes('Model details.')) {
                phase++;
                terminal.write('\u001b[C');
                return;
            }
            if (phase === 2 && frame.includes('Page 2 of')) {
                phase++;
                if (scenario === 'install') {
                    terminal.write('\r');
                } else if (scenario === 'resize') {
                    terminal.resize(40, 10);
                } else {
                    terminal.write('\u001b');
                }
                return;
            }
            if (phase === 3 && scenario === 'resize' && frame.includes('Enlarge terminal')) {
                phase++;
                terminal.write('\u001b');
                setTimeout(function () { terminal.resize(60, 20); }, 100);
                return;
            }
            if (phase >= 3 && frame.includes('Your models.')) {
                phase++;
                terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Details verified.');
        expect(output).toContain('Page 2 of');
        expect(output).toContain('Esc Back');
        expect(output).not.toContain('Go back');
        expect(output).not.toContain('I Install');
        expect(output).not.toContain('No entries.');
        if (scenario === 'unavailable') {
            expect(output).not.toContain('› Install model');
            expect(output).not.toContain('Enter Install');
        } else {
            expect(output).toContain('› Install model');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
