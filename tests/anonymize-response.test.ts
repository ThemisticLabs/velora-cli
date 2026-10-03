import { expect, test } from 'bun:test';
import anonymizeResponse from '../src/api/anonymize-response.js';

var input = '🙂 Anna ANNA Anna';
var result = {
    placeholder_text: '🙂 [PERSON:1] [PERSON:1] [PERSON:1]',
    mapping: { '1': { label: 'PERSON', text: 'Anna', occurrences: [
        { start: 2, end: 6 }, { start: 7, end: 11, text: 'ANNA' }, { start: 12, end: 16 }
    ] } }
};

test('Unicode positions and original variants retain the agreed mapping shape', function () {
    expect(anonymizeResponse(input, result, true)).toEqual({
        text: '🙂 [PERSON:1] [PERSON:2] [PERSON:1]', mapping: {
            '[PERSON:1]': { original: 'Anna', type: 'PERSON', occurrences: [{ start: 2, end: 6 }, { start: 12, end: 16 }] },
            '[PERSON:2]': { original: 'ANNA', type: 'PERSON', occurrences: [{ start: 7, end: 11 }] }
        }
    });
    expect(anonymizeResponse(input, result, false)).toEqual({ text: '🙂 [PERSON:1] [PERSON:2] [PERSON:1]' });
});

test.each(['missing mapping', 'missing text', 'incorrect text', 'incorrect offsets', 'overlap', 'unsafe label', 'unsafe id', 'empty occurrences'])('invalid engine mappings fail closed: %s', function (scenario) {
    var broken: Record<string, unknown> = structuredClone(result);
    var mapping = broken.mapping as Record<string, { label: string; text: string; occurrences: { start: number; end: number; text?: string }[] }>;
    var entry = mapping['1']!;
    if (scenario === 'missing mapping') { delete broken.mapping; }
    if (scenario === 'missing text') { delete broken.placeholder_text; }
    if (scenario === 'incorrect text') { broken.placeholder_text = 'PRIVATE'; }
    if (scenario === 'incorrect offsets') { entry.occurrences[0]!.start = 3; }
    if (scenario === 'overlap') { entry.occurrences.push({ start: 2, end: 6 }); }
    if (scenario === 'unsafe label') { entry.label = 'PERSON]'; }
    if (scenario === 'unsafe id') { mapping['bad-id'] = entry; delete mapping['1']; }
    if (scenario === 'empty occurrences') { entry.occurrences = []; }
    expect(function () { anonymizeResponse(input, broken, true); }).toThrow();
});

test('literal placeholders in the input remain separate from recognized entities', function () {
    expect(anonymizeResponse('[PERSON:1] Anna', { placeholder_text: '[PERSON:1] [PERSON:2]', mapping: {
        '2': { text: 'Anna', label: 'PERSON', occurrences: [{ start: 11, end: 15 }] }
    } }, true)).toEqual({ text: '[PERSON:1] [PERSON:2]', mapping: {
        '[PERSON:2]': { original: 'Anna', type: 'PERSON', occurrences: [{ start: 11, end: 15 }] }
    } });
    expect(function () { anonymizeResponse('[PERSON:1] Anna', { placeholder_text: '[PERSON:1] [PERSON:1]', mapping: {
        '1': { text: 'Anna', label: 'PERSON', occurrences: [{ start: 11, end: 15 }] }
    } }, true); }).toThrow();
});
