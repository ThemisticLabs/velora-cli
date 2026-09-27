import { test, expect } from 'bun:test';
import documentationPath from '../src/system/documentation-path.js';

test.each(['nivora', 'skira7alpha4', 'skira61'])('published model documentation: %s', function (model) {
    expect(documentationPath('/velora/models/' + model)).toBe('/velora/models/' + model + '/');
});

test('unpublished model and unfinished sections open published overviews', function () {
    expect(documentationPath('/velora/models/skira7alpha3')).toBe('/velora/models/');
    expect(documentationPath('/velora/setup')).toBe('/velora/');
    expect(documentationPath('/velora/settings')).toBe('/velora/');
    expect(documentationPath('/velora/updates')).toBe('/velora/');
    expect(documentationPath('/velora/license-api/')).toBe('/velora/license-api/');
});
