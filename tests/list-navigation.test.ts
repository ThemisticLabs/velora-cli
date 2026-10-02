import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['up', 'down'])('shared navigation wraps across rows and actions: %s', async function (direction) {
    var output = '';
    var sent = false;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/list-navigation.ts', import.meta.url)), direction], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            output += Buffer.from(bytes).toString('utf8');
            if (!sent && output.includes('Last action')) {
                sent = true;
                var key = '\u001b[A';
                if (direction === 'down') {
                    key = '\u001b[B';
                }
                terminal.write(key + '\r');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        var selected = 'last';
        if (direction === 'down') {
            selected = 'first';
        }
        expect(output).toContain('Selected: ' + selected);
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
