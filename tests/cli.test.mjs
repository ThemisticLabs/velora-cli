import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';

var CLI_PATH = fileURLToPath(new URL('../dist/velora', import.meta.url));
var packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('help works from another directory through every supported form', function () {
    for (var args of [[], ['help'], ['--help'], ['-h']]) {
        var result = spawnSync(CLI_PATH, args, { cwd: tmpdir(), encoding: 'utf8' });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Usage: velora/);
        assert.match(result.stdout, /not available yet/);
        assert.equal(result.stderr, '');
    }
});

test('version matches the package metadata', function () {
    for (var flag of ['--version', '-v']) {
        var result = spawnSync(CLI_PATH, [flag], { encoding: 'utf8' });
        assert.equal(result.status, 0);
        assert.equal(result.stdout.trim(), packageInfo.version);
    }
});

test('a misspelled command suggests help without executing it', function () {
    var result = spawnSync(CLI_PATH, ['hepl'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Did you mean help/);
    assert.equal(result.stdout, '');
});

test('a misspelled option suggests the supported option', function () {
    var result = spawnSync(CLI_PATH, ['--versoin'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Did you mean --version/);
    assert.equal(result.stdout, '');
});

test('unsupported commands and extra arguments fail', function () {
    for (var args of [['unrelated-command'], ['help', 'setup']]) {
        var result = spawnSync(CLI_PATH, args, { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /error:/);
        assert.equal(result.stdout, '');
    }
});

test('standalone binary runs without a runtime or project files', function () {
    var result = spawnSync(CLI_PATH, ['--version'], {
        cwd: tmpdir(),
        env: { PATH: '' },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), packageInfo.version);
    assert.equal(result.stderr, '');
});

test('help supports color without changing its content', function () {
    var plain = spawnSync(CLI_PATH, ['--help'], { env: { PATH: '' }, encoding: 'utf8' });
    var colored = spawnSync(CLI_PATH, ['--help'], { env: { PATH: '', FORCE_COLOR: '1' }, encoding: 'utf8' });
    assert.equal(colored.status, 0);
    assert.match(colored.stdout, /\u001b\[38;2;104;107;231m/);
    assert.doesNotMatch(plain.stdout, /\u001b\[/);
    assert.equal(colored.stdout.replace(/\u001b\[[0-9;]*m/g, ''), plain.stdout);
});

test('NO_COLOR and dumb terminals disable help colors', function () {
    for (var environment of [{ NO_COLOR: '', FORCE_COLOR: '1' }, { TERM: 'dumb', FORCE_COLOR: '1' }]) {
        var result = spawnSync(CLI_PATH, ['--help'], { env: { PATH: '', ...environment }, encoding: 'utf8' });
        assert.equal(result.status, 0);
        assert.doesNotMatch(result.stdout, /\u001b\[/);
    }
});

test('a reported white terminal background uses themistic ultramarine', function () {
    var result = spawnSync(CLI_PATH, ['--help'], {
        env: { PATH: '', FORCE_COLOR: '1', COLORFGBG: '0;15' },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\u001b\[38;2;37;37;204m/);
});

test('setup requires an interactive terminal and exposes preview help', function () {
    var result = spawnSync(CLI_PATH, ['setup'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /interactive terminal/);
    var help = spawnSync(CLI_PATH, ['setup', '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /preview/);
});

test('doctor is discoverable and has command help without running checks', function () {
    var help = spawnSync(CLI_PATH, ['doctor', '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: velora doctor/);
    assert.match(help.stdout, /server connection/);
    assert.doesNotMatch(help.stdout, /No license checked|HTTP [0-9]/);
    var typo = spawnSync(CLI_PATH, ['doctr'], { encoding: 'utf8' });
    assert.equal(typo.status, 1);
    assert.match(typo.stderr, /Did you mean doctor/);
});
