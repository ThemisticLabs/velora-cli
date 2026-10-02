import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['save', 'invalid', 'back', 'default', 'unreadable'])('API port menu: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var decoder = new TextDecoder();
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/api-settings.ts', import.meta.url)), scenario], {
        terminal: { cols: 70, rows: 22, data: function (terminal, bytes) {
            var frame = decoder.decode(bytes, { stream: true });
            output += frame;
            if (phase === 0 && scenario === 'unreadable' && frame.includes('Could not read API settings')) {
                phase = 3;
                terminal.write('\u001b');
                return;
            }
            if (phase === 0 && frame.includes('http://127.0.0.1:8001')) {
                phase = 1;
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
            if (phase === 1 && scenario === 'invalid' && frame.includes('Choose a port')) {
                phase = 2;
                terminal.write('\u00159000\r');
                return;
            }
            if ((phase === 1 || phase === 2) && frame.includes('Port saved:')) {
                phase = 3;
                terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Port settings verified.');
        if (scenario === 'save' || scenario === 'invalid') {
            expect(output).toContain('Port saved: 9000.');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
