import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.each(['allow', 'disable', 'cancel', 'back', 'engine'])('edit update permissions: %s', async function (scenario) {
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/update-settings.ts', import.meta.url)), scenario], { stdout: 'pipe', stderr: 'pipe' });
    var output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
});
