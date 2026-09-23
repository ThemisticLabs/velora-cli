import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32')('lowercase input reveals each newly typed letter', async function () {
    var stage = 0;
    var output = '';
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/license-input.ts', import.meta.url))], {
        env: { ...process.env, NO_COLOR: '1' },
        terminal: { cols: 90, rows: 30, data: function (terminal, data) {
            output += stripVTControlCharacters(Buffer.from(data).toString('utf8'));
            if (stage === 0 && output.includes('License key:')) {
                stage++;
                terminal.write('a');
            } else if (stage === 1 && output.includes('License key: A')) {
                stage++;
                terminal.write('b');
            } else if (stage === 2 && output.includes('License key: * B')) {
                stage++;
                terminal.write('c');
            } else if (stage === 3 && output.includes('License key: * * C')) {
                stage++;
                terminal.write('\r');
            }
        } }
    });
    var TEST_TIMEOUT_MS = 3000;
    var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
    try {
        expect(await child.exited, 'Input stage: ' + stage).toBe(0);
        expect(stage).toBe(4);
        expect(output).toContain('Input verified.');
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
