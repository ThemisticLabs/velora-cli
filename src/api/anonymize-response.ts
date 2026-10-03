export type AnonymizeResponse = { text: string; mapping?: Record<string, {
    original: string; type: string; occurrences: { start: number; end: number }[];
}> };

export default function anonymizeResponse(input: string, result: Record<string, unknown>, includeMapping: boolean): AnonymizeResponse {
    if (typeof result.placeholder_text !== 'string' || !result.mapping || typeof result.mapping !== 'object' || Array.isArray(result.mapping)) {
        throw new Error('Invalid inference response.');
    }
    var offsets = [0];
    var offset = 0;
    for (var character of input) {
        offset += character.length;
        offsets.push(offset);
    }
    var usedIds = new Set<string>();
    for (var match of input.matchAll(/\[[\p{L}_][\p{L}\p{N}_]{0,127}:([0-9]+)\]/gu)) {
        usedIds.add(match[1]!.replace(/^0+/, '') || '0');
    }
    for (var id of Object.keys(result.mapping)) {
        if (!/^[1-9][0-9]*$/.test(id)) { throw new Error('Invalid mapping identifier.'); }
        if (usedIds.has(id)) { throw new Error('Mapping conflicts with a placeholder in the input.'); }
        usedIds.add(id);
    }
    var nextId = 1;
    var mapping: NonNullable<AnonymizeResponse['mapping']> = {};
    var segments: { start: number; end: number; token: string; sourceToken: string }[] = [];
    for (var [id, value] of Object.entries(result.mapping)) {
        if (!value || typeof value !== 'object' || typeof value.text !== 'string' || typeof value.label !== 'string' ||
            !/^[\p{L}_][\p{L}\p{N}_]{0,127}$/u.test(value.label) || !Array.isArray(value.occurrences) || value.occurrences.length === 0) {
            throw new Error('Invalid inference mapping.');
        }
        var variants = new Map<string, string>();
        var sourceToken = '[' + value.label + ':' + id + ']';
        for (var occurrence of value.occurrences) {
            if (!occurrence || typeof occurrence !== 'object' || !Number.isSafeInteger(occurrence.start) || !Number.isSafeInteger(occurrence.end) ||
                occurrence.start < 0 || occurrence.end <= occurrence.start || occurrence.end >= offsets.length) {
                throw new Error('Invalid mapping occurrence.');
            }
            var original = value.text;
            if ('text' in occurrence) {
                if (typeof occurrence.text !== 'string') { throw new Error('Invalid mapping original.'); }
                original = occurrence.text;
            }
            if (input.slice(offsets[occurrence.start], offsets[occurrence.end]) !== original) {
                throw new Error('Mapping does not match the input.');
            }
            var token = variants.get(original);
            if (!token) {
                var identifier = id;
                if (variants.size > 0) {
                    while (usedIds.has(String(nextId))) { nextId++; }
                    identifier = String(nextId++);
                    usedIds.add(identifier);
                }
                token = '[' + value.label + ':' + identifier + ']';
                variants.set(original, token);
                mapping[token] = { original, type: value.label, occurrences: [] };
            }
            mapping[token]!.occurrences.push({ start: occurrence.start, end: occurrence.end });
            segments.push({ start: offsets[occurrence.start]!, end: offsets[occurrence.end]!, token, sourceToken });
        }
    }
    segments.sort(function (left, right) { return left.start - right.start; });
    var cursor = 0;
    var output = '';
    var engineOutput = '';
    for (var segment of segments) {
        if (segment.start < cursor) { throw new Error('Mapping occurrences overlap.'); }
        var unchanged = input.slice(cursor, segment.start);
        output += unchanged + segment.token;
        engineOutput += unchanged + segment.sourceToken;
        cursor = segment.end;
    }
    output += input.slice(cursor);
    engineOutput += input.slice(cursor);
    if (engineOutput !== result.placeholder_text) { throw new Error('Mapping does not match the anonymized text.'); }
    var response: AnonymizeResponse = { text: output };
    if (includeMapping) { response.mapping = mapping; }
    return response;
}
