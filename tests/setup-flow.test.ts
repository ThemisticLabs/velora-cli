import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['navigation', 'complete', 'cancel-after-install'])('setup flow: %s', async function (scenario) {
    var output = '';
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/setup-flow.ts', import.meta.url)), scenario], {
        terminal: { cols: 90, rows: 30, data: function (_terminal, data) { output += Buffer.from(data).toString('utf8'); } }
    });
    var TEST_TIMEOUT_MS = 4000;
    var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
    try {
        expect(await child.exited).toBe(0);
        expect(output).toContain('Flow verified.');
        expect(output).not.toContain('FIXTURE-LICENSE');
        expect(output).not.toContain('\u001b[?1049h');
        expect(output).not.toContain('\u001b[?1049l');
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
