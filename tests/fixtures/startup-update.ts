import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

var directory = process.env.VELORA_TEST_DIRECTORY!;
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
var updateSettings = (await import('../../src/menu/update-settings.js')).default;
var saved = await updateSettings({ setup: true });
if (saved) {
    var preferences = JSON.parse(await readFile(join(directory, 'cli-updates.json'), 'utf8'));
    assert.equal(preferences.installAutomatically, false);
    process.stdout.write('Setup consent saved.\n');
}
