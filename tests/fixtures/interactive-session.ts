import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

var directory = await mkdtemp(join(tmpdir(), 'velora-interactive-test-'));
var scenario = process.argv[2];
process.env.TERM_PROGRAM = 'ghostty';
var originalSpawn = Bun.spawn;
Bun.spawn = function () {
    return { stdout: new Blob(['fixture-terminal\n']).stream(), exited: Promise.resolve(0) };
} as unknown as typeof Bun.spawn;
var { default: session } = await import('../../src/system/interactive-session.js');
var { default: navigation } = await import('../../src/terminal/interactive-navigation.js');
try {
    var registration = await session('register', directory);
    assert(registration && 'close' in registration);
    try {
        assert.equal((await stat(join(directory, 'interactive-session.json'))).mode & 0o777, 0o600);
        var target = await session('open', directory);
        assert.deepEqual(target, { application: 'Ghostty', id: 'fixture-terminal' });
        assert.equal(navigation.settings, false);
        if (scenario === 'settings') {
            await session('settings', directory);
            assert.equal(navigation.settings, true);
            assert.equal(navigation.controller.signal.aborted, true);
        }
        if (scenario === 'duplicate') {
            assert.equal(await session('register', directory), null);
            assert.deepEqual(await session('open', directory), target);
        }
        if (scenario === 'unauthorized') {
            await Bun.write(join(directory, 'interactive-session.json'), JSON.stringify({ token: 'A'.repeat(43) }));
            await assert.rejects(session('settings', directory), /did not respond/);
            assert.equal(navigation.settings, false);
        }
    } finally { await registration.close(); }
    if (scenario === 'stale') {
        var directoryId = createHash('sha256').update(directory).digest('hex').slice(0, 16);
        var endpoint = '/tmp/velora-interactive-' + process.getuid!() + '-' + directoryId + '.sock';
        var stale = originalSpawn([process.execPath, '-e', 'Bun.serve({unix: process.argv[1], fetch: function () {return new Response();}}); console.log("ready");', endpoint], { stdout: 'pipe', stderr: 'pipe' });
        try {
            var reader = stale.stdout.getReader();
            await reader.read();
            reader.releaseLock();
            stale.kill('SIGKILL');
            await stale.exited;
            await Bun.write(join(directory, 'interactive-session.json'), JSON.stringify({ token: 'A'.repeat(43) }));
            assert.equal(await session('open', directory), null);
            assert.equal(await session('settings', directory), null);
        } finally {
            stale.kill();
            await unlink(endpoint).catch(function () {});
        }
    }
    assert.equal(await session('open', directory), null);
} finally {
    Bun.spawn = originalSpawn;
    await rm(directory, { recursive: true, force: true });
}
