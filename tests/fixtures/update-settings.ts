import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

var scenario = process.argv[2];
var directory = await mkdtemp(join(tmpdir(), 'velora-settings-'));
var model = { id: 'skira7alpha', name: 'Skira 7 Alpha', version: '1', revision: 'r1', sequence: 1, engineVersion: '0.1.1', selected: true };
var answers = ['edit', 'no', 'back'];
if (scenario === 'allow') {
    answers = ['edit', 'yes', 'yes', 'back'];
}
if (scenario === 'cancel') {
    answers = ['edit', 'yes', 'back'];
}
if (scenario === 'back') {
    answers = ['back'];
}
var messages: string[] = [];
mock.module('../../src/system/data-directory.js', function () { return { default: function () { return directory; } }; });
mock.module('../../src/setup/select-option.js', function () {
    return { default: async function (config: { message: string; choices: { value: string }[] }) {
        messages.push(config.message);
        var answer = answers.shift();
        var valid = false;
        for (var item of config.choices) {
            if (item.value === answer) {
                valid = true;
            }
        }
        assert.ok(valid);
        return answer;
    } };
});
try {
    var original = JSON.stringify({ checkAutomatically: true, installAutomatically: false });
    var cliPath = join(directory, 'cli-updates.json');
    var enginePath = join(directory, 'models', model.id, 'engine-updates.json');
    await mkdir(join(directory, 'models', model.id), { recursive: true });
    await writeFile(cliPath, original);
    await writeFile(enginePath, original);
    var edit = (await import('../../src/menu/update-settings.js')).default;
    if (scenario === 'engine') {
        await writeFile(cliPath, '{broken');
        await edit(model);
        assert.equal(await readFile(cliPath, 'utf8'), '{broken');
        assert.deepEqual(JSON.parse(await readFile(enginePath, 'utf8')), { checkAutomatically: false, installAutomatically: false });
    } else {
        await edit();
        assert.equal(await readFile(enginePath, 'utf8'), original);
        if (scenario === 'back' || scenario === 'cancel') {
            assert.equal(await readFile(cliPath, 'utf8'), original);
        } else {
            assert.deepEqual(JSON.parse(await readFile(cliPath, 'utf8')), { checkAutomatically: scenario === 'allow', installAutomatically: scenario === 'allow' });
        }
    }
    assert.ok(messages[0]?.includes('Automatic checks: On'));
    assert.ok(messages[0]?.includes('Automatic installation: Off'));
    assert.equal(answers.length, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
