import renderList, { type ListRow } from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import { createPrompt, useState } from '@inquirer/core';
import setSetupLayout from '../terminal/set-setup-layout.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import style from '../terminal/style.js';
import cliUpdatePreferences, { type CliUpdatePreferences } from '../updates/cli-update-preferences.js';
import engineUpdatePreferences from '../updates/engine-update-preferences.js';

type Scope = { name: string; engine?: boolean; saved: CliUpdatePreferences; readable: boolean };

export default async function updateSettings(): Promise<void> {
    var scopes: Scope[] = [
        { name: 'velora', saved: { checkAutomatically: null, installAutomatically: null }, readable: true },
        { name: 'Engine', engine: true, saved: { checkAutomatically: null, installAutomatically: null }, readable: true }
    ];
    for (var scope of scopes) {
        try {
            if (scope.engine) {
                scope.saved = await engineUpdatePreferences() || scope.saved;
            } else {
                scope.saved = await cliUpdatePreferences() || scope.saved;
            }
        } catch {
            scope.readable = false;
        }
    }
    var feedback = '';
    var selectedIndex = 0;
    var pending: CliUpdatePreferences[] = [];
    for (var scope of scopes) {
        pending.push({ ...scope.saved });
    }
    var rows: { scopeIndex: number; field: keyof CliUpdatePreferences; label: string }[] = [];
    for (var scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
        rows.push({ scopeIndex, field: 'checkAutomatically', label: 'Automatic checks' });
        rows.push({ scopeIndex, field: 'installAutomatically', label: 'Automatic installation' });
    }
    var values: string[] = [];
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        values.push(String(rowIndex));
    }
    values.push('save');
    while (true) {
        setSetupLayout('Settings / Update permissions', 'Save applies changes. Esc discards unsaved edits.', '↑/↓ Move · Enter Change · Esc Back · Ctrl+C Quit', '/velora/updates');
        var edit = createPrompt<CliUpdatePreferences[] | null, Record<string, never>>(function (_config, done) {
            var [draft, setDraft] = useState(pending);
            var selected = useListNavigation({ values, activateWithSpace: true, initialValue: values[selectedIndex],
                onBack: function () { done(null); },
                onSelect: function (value) {
                    var index = values.indexOf(value);
                    if (value === 'save') {
                        selectedIndex = index;
                        done(draft);
                        return;
                    }
                    var row = rows[index]!;
                    if (!scopes[row.scopeIndex]!.readable || row.field === 'installAutomatically' && !draft[row.scopeIndex]!.checkAutomatically) {
                        return;
                    }
                    var next = [...draft];
                    var preference = { ...next[row.scopeIndex]! };
                    preference[row.field] = !preference[row.field];
                    if (!preference.checkAutomatically) {
                        preference.installAutomatically = false;
                    }
                    next[row.scopeIndex] = preference;
                    feedback = '';
                    setDraft(next);
                }
            });
            var index = values.indexOf(selected);
            var width = setupDimensions().contentWidth;
            var listRows: ListRow[] = [];
            for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                var row = rows[rowIndex]!;
                var scope = scopes[row.scopeIndex]!;
                var value = draft[row.scopeIndex]![row.field];
                var state = 'Not set';
                if (value === true) {
                    state = 'On';
                }
                if (value === false) {
                    state = 'Off';
                }
                if (!scope.readable) {
                    state = 'Unavailable';
                }
                var listRow: ListRow = { value: String(rowIndex), cells: [row.label, state], group: String(row.scopeIndex) };
                if (row.field === 'checkAutomatically') {
                    listRow.section = scope.name;
                }
                listRows.push(listRow);
            }
            var output = renderList({ rows: listRows, columns: [{ title: '' }, { title: '', width: 12 }],
                actions: [{ name: 'Save changes', value: 'save' }], selected, width,
                height: setupDimensions().contentRows - 1 });
            var hint = feedback;
            if (index < rows.length) {
                var row = rows[index]!;
                hint = 'Check GitHub when velora starts.';
                if (row.field === 'installAutomatically') {
                    hint = 'Automatic installation is not available yet.';
                    if (!draft[row.scopeIndex]!.checkAutomatically) {
                        hint = 'Enable automatic checks first.';
                    }
                }
                if (scopes[row.scopeIndex]!.engine) {
                    if (row.field === 'checkAutomatically') {
                        hint = 'Check the engine when velora starts.';
                    }
                }
                if (!scopes[row.scopeIndex]!.readable) {
                    hint = 'Cannot read preferences. Check the settings file.';
                }
            }
            output += '  ' + style(hint.slice(0, width), 'muted');
            return useSetupScreen(output);
        });
        var draft = await edit({});
        if (!draft) {
            return;
        }
        pending = draft;
        feedback = 'No changes.';
        for (var index = 0; index < scopes.length; index++) {
            var scope = scopes[index]!;
            var next = draft[index]!;
            if (!scope.readable || next.checkAutomatically === scope.saved.checkAutomatically && next.installAutomatically === scope.saved.installAutomatically) {
                continue;
            }
            try {
                if (scope.engine) {
                    await engineUpdatePreferences({ checkAutomatically: next.checkAutomatically === true, installAutomatically: next.installAutomatically === true });
                } else {
                    await cliUpdatePreferences(next);
                }
                scope.saved = next;
                feedback = 'Saved.';
            } catch {
                feedback = 'Could not save ' + scope.name + '. Check storage access.';
                break;
            }
        }
    }
}
