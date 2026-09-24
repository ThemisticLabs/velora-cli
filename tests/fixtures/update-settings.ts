import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

var scenario = process.argv[2];
var directory = await mkdtemp(join(tmpdir(), 'velora-settings-'));
var model = { id: 'skira7alpha', name: 'Skira 7 Alpha', version: '1', revision: 'r1', sequence: 1, engineVersion: '0.1.1', selected: true };
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
try {
    var original = JSON.stringify({ checkAutomatically: true, installAutomatically: false });
    var cliPath = join(directory, 'cli-updates.json');
    var enginePath = join(directory, 'models', model.id, 'engine-updates.json');
    await mkdir(join(directory, 'models', model.id), { recursive: true });
    await writeFile(cliPath, original);
    await writeFile(enginePath, original);
    if (scenario === 'unreadable') {
        await writeFile(cliPath, '{broken');
    }
    await (await import('../../src/menu/update-settings.js')).default(model);
    var cli = await readFile(cliPath, 'utf8');
    var engine = await readFile(enginePath, 'utf8');
    if (scenario === 'unreadable') {
        assert.equal(cli, '{broken');
    } else if (scenario === 'disable') {
        assert.deepEqual(JSON.parse(cli), { checkAutomatically: false, installAutomatically: false });
    } else if (scenario === 'allow') {
        assert.deepEqual(JSON.parse(cli), { checkAutomatically: true, installAutomatically: true });
    } else {
        assert.equal(cli, original);
    }
    if (scenario === 'engine' || scenario === 'unreadable') {
        assert.deepEqual(JSON.parse(engine), { checkAutomatically: false, installAutomatically: false });
    } else {
        assert.equal(engine, original);
    }
    process.stdout.write('Permissions verified.\n');
} finally {
    await rm(directory, { recursive: true, force: true });
}
