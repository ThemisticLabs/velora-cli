import { mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as childProcess from 'node:child_process';
import assert from 'node:assert/strict';
import type bootstrapEngine from '../../src/engine/bootstrap-engine.js';
import enginePackage from './engine-package.js';

mock.module('node:child_process', function () {
    return { ...childProcess, spawn: function () {
        var child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(), stdout: new PassThrough(),
            exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
            kill: function () { return true; }
        });
        child.stdin.once('data', function () {
            child.stdin.emit('error', new Error('PRIVATE-DIAGNOSTIC'));
            child.exitCode = 7;
            child.emit('close', 7, null);
        });
        return child;
    } };
});
var engineSession = (await import('../../src/engine/engine-session.js')).default;
var fixture = await enginePackage();
var bootstrap: typeof bootstrapEngine = async function () {
    return { executable: 'fixture', packagePath: 'fixture', runtimePath: 'fixture', release: fixture.release, target: 'win-amd64' };
};
await assert.rejects(engineSession('FIXTURE-LICENSE', new AbortController().signal, undefined, bootstrap), function (error: unknown) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Engine 0\.4\.1 stopped during version/);
    assert.match(error.message, /Exit code: 7\./);
    assert.doesNotMatch(error.message, /PRIVATE-DIAGNOSTIC|FIXTURE-LICENSE/);
    return true;
});
process.stdout.write('Connection error verified.\n');
