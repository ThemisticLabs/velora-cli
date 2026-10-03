import { test, expect } from 'bun:test';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform !== 'darwin').each(['open', 'settings', 'quit-select', 'quit-popup', 'quit-switch', 'quit-license', 'quit-task', 'quit-download'])('menu bar reaches the interactive setup: %s', async function (scenario) {
    var output = '';
    var continued = false;
    var decoder = new TextDecoder();
    var child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/setup-session.ts', import.meta.url)), scenario], {
        terminal: { cols: 80, rows: 30, data: function (terminal, bytes) {
            output += decoder.decode(bytes, { stream: true });
            if (scenario === 'settings' && !continued && output.includes('Continue setup')) {
                continued = true;
                terminal.write('\r');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Setup session verified.');
        expect(output).not.toContain('Could not open velora.');
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
