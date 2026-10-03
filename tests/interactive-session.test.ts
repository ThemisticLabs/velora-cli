import { expect, test } from 'bun:test';

for (var scenario of ['settings', 'setup-settings', 'duplicate', 'unauthorized', 'stale', 'quit']) {
    test.skipIf(process.platform !== 'darwin')('interactive session routing: ' + scenario, async function () {
        var child = Bun.spawn([process.execPath, 'run', 'tests/fixtures/interactive-session.ts', scenario], { stdout: 'pipe', stderr: 'pipe' });
        var error = await new Response(child.stderr).text();
        expect(await child.exited, error).toBe(0);
    });
}
