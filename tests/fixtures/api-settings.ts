import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

var directory = await mkdtemp(join(tmpdir(), 'velora-api-menu-'));
var scenario = process.argv[2];
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
try {
    var original = '{"port":8001}';
    if (scenario === 'reset') {
        original = '{"port":9000}';
    }
    if (scenario === 'unreadable') {
        original = '{broken';
    }
    await writeFile(join(directory, 'api.json'), original);
    await (await import('../../src/menu/api-settings.js')).default();
    var stored = await readFile(join(directory, 'api.json'), 'utf8');
    if (scenario === 'save' || scenario === 'invalid') {
        assert.equal(JSON.parse(stored).port, 9000);
    } else if (scenario === 'default' || scenario === 'reset') {
        assert.equal(JSON.parse(stored).port, 8001);
    } else {
        assert.equal(stored, original);
    }
    process.stdout.write('Port settings verified.\n');
} finally {
    await rm(directory, { recursive: true, force: true });
}
