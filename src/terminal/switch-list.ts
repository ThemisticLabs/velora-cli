import navigation from './interactive-navigation.js';
import { createPrompt, useState } from '@inquirer/core';
import renderList, { type ListRow } from './render-list.js';
import useListNavigation from './use-list-navigation.js';
import setupDimensions from './setup-dimensions.js';
import useSetupScreen from './use-setup-screen.js';
import style from './style.js';

export type SwitchRow = {
    value: string;
    name: string;
    enabled: boolean | null;
    hint: string;
    group?: string;
    section?: string;
    unavailable?: string;
    requires?: string;
};
type SwitchOptions = {
    rows: SwitchRow[];
    saveLabel: string;
    initialValue?: string;
    feedback?: string;
    feedbackTone?: 'muted' | 'OK' | 'Error';
};

export default async function switchList(config: SwitchOptions): Promise<SwitchRow[] | null> {
    var prompt = createPrompt<SwitchRow[] | null, Record<string, never>>(function (_config, done) {
        var [draft, setDraft] = useState(config.rows);
        var [changed, setChanged] = useState(false);
        var values: string[] = [];
        for (var row of draft) { values.push(row.value); }
        values.push('save');
        var selected = useListNavigation({ values, initialValue: config.initialValue, activateWithSpace: true,
            onBack: function () { done(null); },
            onSelect: function (value) {
                if (value === 'save') { done(draft); return; }
                var index = values.indexOf(value);
                var row = draft[index]!;
                if (row.unavailable) { return; }
                for (var required of draft) {
                    if (required.value === row.requires && !required.enabled) { return; }
                }
                var next = [...draft];
                next[index] = { ...row, enabled: !row.enabled };
                if (!next[index]!.enabled) {
                    for (var dependentIndex = 0; dependentIndex < next.length; dependentIndex++) {
                        if (next[dependentIndex]!.requires === value) {
                            next[dependentIndex] = { ...next[dependentIndex]!, enabled: false };
                        }
                    }
                }
                setChanged(true);
                setDraft(next);
            }
        });
        var rows: ListRow[] = [];
        var hint = config.feedback || '';
        var hintTone: 'muted' | 'OK' | 'Warning' | 'Error' = config.feedbackTone || 'muted';
        if (changed) { hint = ''; hintTone = 'muted'; }
        for (var row of draft) {
            var state = 'Not set';
            if (row.enabled === true) { state = 'On'; }
            if (row.enabled === false) { state = 'Off'; }
            if (row.unavailable) { state = 'Unavailable'; }
            rows.push({ value: row.value, cells: [row.name, state], group: row.group, section: row.section });
            if (row.value !== selected) { continue; }
            hint = row.hint;
            hintTone = 'muted';
            for (var required of draft) {
                if (required.value === row.requires && !required.enabled) { hint = 'Enable ' + required.name.toLowerCase() + ' first.'; }
            }
            if (row.unavailable) { hint = row.unavailable; hintTone = 'Warning'; }
        }
        var dimensions = setupDimensions();
        var output = renderList({ rows, columns: [{ title: '' }, { title: '', width: 12 }],
            actions: [{ name: config.saveLabel, value: 'save' }], selected,
            width: dimensions.contentWidth, height: dimensions.contentRows - 1 });
        output += '  ' + style(hint.slice(0, dimensions.contentWidth), hintTone);
        return useSetupScreen(output);
    });
    return prompt({}, { signal: navigation.controller.signal });
}
