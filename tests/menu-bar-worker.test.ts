import { expect, test } from 'bun:test';

test('menubar controls serialize service actions, reject unknown actions and release ownership', async function () {
    var child = Bun.spawn([process.execPath, 'run', 'tests/fixtures/menu-bar-worker.ts'], { stdout: 'pipe', stderr: 'pipe' });
    var error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
});
