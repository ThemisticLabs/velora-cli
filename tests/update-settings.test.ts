import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['allow', 'disable', 'cancel', 'back', 'engine', 'unreadable'])('inline update permissions: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/update-settings.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            var frame = Buffer.from(bytes).toString('utf8');
            output += frame;
            if (phase === 0 && frame.includes('Save changes')) {
                phase++;
                if (scenario === 'back') {
                    terminal.write('\u001b');
                    return;
                }
                if (scenario === 'cancel') {
                    terminal.write(' ');
                    return;
                }
                if (scenario === 'allow') {
                    terminal.write('\u001b[B \u001b[B\u001b[B\u001b[B\r');
                    return;
                }
                if (scenario === 'engine' || scenario === 'unreadable') {
                    terminal.write('\u001b[B\u001b[B \u001b[B\u001b[B\r');
                    return;
                }
                terminal.write(' \u001b[B\u001b[B\u001b[B\u001b[B\r');
                return;
            }
            if (phase === 1 && (frame.includes('Saved.') || scenario === 'cancel' && frame.includes('Automatic checks'))) {
                phase++;
                terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Permissions verified.');
        expect(output).toContain('Engine · Skira 7 Alpha');
        expect(output).not.toContain('Edit permissions');
        expect(output).not.toContain('Allow automatic update checks?');
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
