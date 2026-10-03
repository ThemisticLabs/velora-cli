import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

var directory = await mkdtemp(join(tmpdir(), 'velora-intro-terminal-'));
var registrationSaved = false;
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
mock.module('../../src/system/autostart.js', function () { return { default: async function (enabled?: boolean) {
    if (enabled !== undefined) { registrationSaved = true; assert.equal(enabled, false); }
    return { supported: true, enabled: false };
} }; });
try {
    var onboarding = (await import('../../src/setup/onboarding.js')).default;
    assert.equal(await onboarding(), true);
    assert.equal(registrationSaved, true);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'setup.json'), 'utf8')), { step: 4 });
    for (var scope of ['cli', 'engine']) {
        assert.deepEqual(JSON.parse(await readFile(join(directory, scope + '-updates.json'), 'utf8')), { checkAutomatically: false, installAutomatically: false });
    }
    process.stdout.write('Introductory terminal verified.\n');
} finally { await rm(directory, { recursive: true, force: true }); }
