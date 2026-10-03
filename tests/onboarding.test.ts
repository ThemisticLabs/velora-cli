import { test, expect } from 'bun:test';
import { fileURLToPath } from 'node:url';

test.each(['new', 'existing', 'resume', 'done', 'review', 'back', 'exit', 'cancel-popup', 'progress-error', 'save-error'])('onboarding order and resumption: %s', async function (scenario) {
    var child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/onboarding.ts', import.meta.url)), scenario], { stdout: 'pipe', stderr: 'pipe' });
    var timeout = setTimeout(function () { child.kill(); }, 3000);
    try {
        var output = await new Response(child.stdout).text();
        var errors = await new Response(child.stderr).text();
        expect(await child.exited, errors).toBe(0);
        expect(output).toContain('Onboarding verified.');
    } finally { clearTimeout(timeout); child.kill(); }
});
