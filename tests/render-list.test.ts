import { test, expect } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import renderList from '../src/terminal/render-list.js';

test('model lists keep three rows visible and actions separate at the minimum terminal size', function () {
    var rows = [];
    for (var index = 0; index < 12; index++) {
        rows.push({ value: String(index), cells: ['Model ' + index, '1.0', '0.2'] });
    }
    for (var selected of ['0', '11', 'back']) {
        var output = stripVTControlCharacters(renderList({ rows,
            columns: [{ title: 'Model' }, { title: 'Version', width: 12 }, { title: 'Engine', width: 12 }],
            actions: [{ name: 'Install another model', value: 'install' }, { name: 'Go back', value: 'back' }],
            selected, width: 56, height: 12 }));
        expect(output.match(/Model \d+/g)?.length).toBe(3);
        expect(output).toContain('\n\n');
        expect(output).toContain('Install another model');
        expect(output).toContain('Go back');
        expect(output.split('\n').length - 1).toBeLessThanOrEqual(12);
        for (var line of output.split('\n')) {
            expect(line.length).toBeLessThanOrEqual(58);
        }
        if (selected === '0') {
            expect(output).toContain('↓ More below');
            expect(output).toContain('› Model 0');
        } else {
            expect(output).toContain('↑ More above');
            expect(output).toContain('Model 11');
        }
    }
});

test('empty lists retain their actions and explain the empty state', function () {
    var output = stripVTControlCharacters(renderList({ rows: [], selected: 'back', width: 56, height: 12,
        columns: [{ title: 'Model' }], emptyMessage: 'No models installed.', actions: [{ name: 'Go back', value: 'back' }] }));
    expect(output).toContain('No models installed.');
    expect(output).toContain('› Go back');
    expect(output).not.toContain('More below');
});
