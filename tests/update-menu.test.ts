import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json';

test.skipIf(process.platform === 'win32').each(['cli', 'model', 'cancel', 'no-model'])('update versions terminal: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var decoder = new TextDecoder();
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/update-menu.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            var frame = stripVTControlCharacters(decoder.decode(bytes, { stream: true }));
            output += frame;
            if (phase === 0 && frame.includes('Not checked')) {
                phase++;
                if (scenario === 'model' || scenario === 'cancel') {
                    terminal.write('\u001b[B');
                }
                terminal.write('\r');
                return;
            }
            if (phase === 1 && (frame.includes('Update available') || scenario === 'cancel' && frame.includes('Checking…'))) {
                phase++;
                terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Updates verified.');
        expect(output).toContain('Installed');
        expect(output).toContain('Available');
        expect(output).toContain(packageInfo.version);
        if (scenario === 'cli' || scenario === 'no-model') {
            expect(output).toContain('2.0.0');
        }
        if (scenario === 'model') {
            expect(output).toMatch(/Skira 7 Alpha\s+│\s+1\.0\s+│\s+1\.1/);
            expect(output).toMatch(/Engine\s+│\s+0\.1\.1\s+│\s+0\.2\.0/);
        }
        if (scenario === 'no-model') {
            expect(output).not.toContain('Engine');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
