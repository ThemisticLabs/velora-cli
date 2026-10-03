import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };

var COMMANDS = [
    { args: ['--version'], expected: packageInfo.version },
    { args: ['--help'], expected: 'Usage: velora' },
    { args: ['doctor'], expected: 'Fixture doctor called.' },
    { args: ['license', 'status'], expected: 'Fixture license called.' },
    { args: ['setup', '--help'], expected: 'Usage: velora setup' }
];
test.skipIf(process.platform === 'win32').each(COMMANDS)('explicit command bypasses pending startup work: $args', async function (command) {
    for (var scenario of ['update', 'recovery']) {
        var output = '';
        var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/cli-startup-routing.ts', import.meta.url)), scenario, ...command.args], {
            terminal: { cols: 90, rows: 30, data: function (_terminal, bytes) { output += Buffer.from(bytes).toString('utf8'); } }
        });
        var TEST_TIMEOUT_MS = 4000;
        var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
        try {
            expect(await child.exited, output).toBe(0);
            expect(output).toContain(command.expected);
            expect(output).not.toContain('Fixture recovery called.');
            expect(output).not.toContain('Fixture startup called.');
        } finally {
            clearTimeout(timeout);
            child.kill();
            child.terminal?.close();
        }
    }
});

test.skipIf(process.platform === 'win32').each(['normal', 'update', 'recovery'])('menu starts retain startup lifecycle: %s', async function (scenario) {
    for (var args of [[], ['setup']]) {
        var output = '';
        var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/cli-startup-routing.ts', import.meta.url)), scenario, ...args], {
            terminal: { cols: 90, rows: 30, data: function (_terminal, bytes) { output += Buffer.from(bytes).toString('utf8'); } }
        });
        var TEST_TIMEOUT_MS = 4000;
        var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
        try {
            expect(await child.exited, output).toBe(0);
            expect(output).toContain('Fixture recovery called.');
            if (scenario === 'recovery') {
                expect(output).not.toContain('Fixture startup called.');
            } else {
                expect(output).toContain('Fixture startup called.');
            }
            if (scenario === 'normal') {
                expect(output).toContain('Fixture menu called.');
            } else {
                expect(output).not.toContain('Fixture menu called.');
            }
        } finally {
            clearTimeout(timeout);
            child.kill();
            child.terminal?.close();
        }
    }
});
