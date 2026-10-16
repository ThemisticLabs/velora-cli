import { mock } from 'bun:test';
import assert from 'node:assert/strict';

var scenario = process.argv[2];
var requests: string[] = [];
var starts = 0;
var copied = '';
mock.module('../../src/service/service-control.js', function () {
    return { default: async function (operation: string) {
        if (operation === 'start') { starts++; }
        if (scenario === 'start' && starts === 0) { return { state: 'stopped' }; }
        return { state: 'running', pid: process.pid, port: 8001, model: 'model-a', engineVersion: '0.4.4' };
    } };
});
mock.module('../../src/api/anonymize-text.js', function () {
    return { default: async function (text: string, mapping: boolean) {
        assert.equal(mapping, true);
        requests.push(text);
        if (scenario === 'retry' && requests.length === 1) {
            throw Object.assign(new Error('Fixture service busy.'), { name: 'AnonymizeError' });
        }
        var output = 'Hallo [PERSON:1].';
        if (!text) { output = ''; }
        if (scenario === 'long') {
            output = '';
            for (var index = 0; index < 40; index++) { output += 'line-' + index + '\n'; }
        }
        if (scenario === 'unicode') { output = 'a'.repeat(55) + '🙂👩‍👩‍👧‍👦é'; }
        if (scenario === 'wide') { output = ('界'.repeat(50) + '\n').repeat(12); }
        return { text: output, mapping: { '[PERSON:1]': { original: 'Anna Müller', type: 'PERSON', occurrences: [{ start: 6, end: 17 }] } } };
    } };
});
mock.module('../../src/system/copy-clipboard.js', function () {
    return { default: async function (text: string) { copied = text; return true; } };
});
process.stdout.write('\u001b[?1049h');
try {
    await (await import('../../src/menu/anonymize.js')).default();
    var expectedRequests = 1;
    if (scenario === 'cancel-input') { expectedRequests = 0; }
    if (scenario === 'retry') { expectedRequests = 2; assert.equal(requests[0], requests[1]); }
    assert.equal(requests.length, expectedRequests);
    var expectedText = 'Hallo Anna Müller.';
    if (scenario === 'long-input') { expectedText = 'a'.repeat(1000); }
    if (scenario === 'wide-input') { expectedText = '界'.repeat(1000); }
    if (scenario === 'edit-input') { expectedText = 'abZc'; }
    if (requests.length && scenario !== 'empty') { assert.equal(requests[0], expectedText); }
    if (scenario === 'empty') { assert.equal(requests[0], ''); }
    assert.equal(starts, Number(scenario === 'start'));
    if (scenario === 'copy') { assert.equal(copied, 'Hallo [PERSON:1].'); }
} finally {
    process.stdout.write('\u001b[?25h\u001b[?1049l');
}
process.stdout.write('Anonymize menu verified.\n');
