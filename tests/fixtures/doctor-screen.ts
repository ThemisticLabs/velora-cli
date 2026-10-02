import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import type { DoctorCheck } from '../../src/commands/doctor.js';

var scenario = process.argv[2];
var cancelled = false;
mock.module('../../src/commands/doctor.js', function () {
    return { default: async function (_transport: unknown, _directory: unknown, options: { signal: AbortSignal; onProgress: (checks: DoctorCheck[]) => void }) {
        var checks: DoctorCheck[] = [
            { name: 'System', status: 'Info', detail: 'Test system' },
            { name: 'Local API port', status: 'Checking', detail: 'Checking 127.0.0.1:8001' }
        ];
        options.onProgress(checks);
        await new Promise<void>(function (resolve) {
            var timer = setTimeout(function () {
                options.signal.removeEventListener('abort', onAbort);
                resolve();
            }, 1000);
            var onAbort = function () {
                clearTimeout(timer);
                cancelled = true;
                resolve();
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
        });
        if (options.signal.aborted) { return; }
        checks[1]!.status = 'OK';
        checks[1]!.detail = 'Available now';
        checks.push({ name: 'Global command', status: 'Warning', detail: 'Not in PATH' });
        checks.push({ name: 'License', status: 'Error', detail: 'This license has expired.' });
        if (scenario === 'scroll') {
            checks = [
                { name: 'System', status: 'Info', detail: 'Test system' },
                { name: 'Global command', status: 'OK', detail: 'Command found' },
                { name: 'Storage', status: 'Error', detail: 'EARLY STORAGE FAILURE' },
                { name: 'Local API port', status: 'OK', detail: 'Available now' },
                { name: 'License server', status: 'OK', detail: 'HTTP 200' },
                { name: 'Engine', status: 'OK', detail: 'Version 0.4.4' },
                { name: 'License', status: 'OK', detail: 'Valid' },
                { name: 'Selected model', status: 'OK', detail: 'Loaded' },
                { name: 'Inference', status: 'OK', detail: 'FINAL INFERENCE RESULT' }
            ];
        }
        options.onProgress(checks);
    } };
});
await (await import('../../src/menu/doctor-screen.js')).default();
assert.equal(cancelled, scenario === 'back');
process.stdout.write('Doctor screen verified.\n');
