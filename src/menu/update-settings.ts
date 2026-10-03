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

export default async function updateSettings(options: { setup?: boolean } = {}): Promise<boolean> {
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
    var feedbackTone: 'muted' | 'OK' | 'Error' = 'muted';
    var feedback = '';
    var selectedIndex = 0;
    var pending: CliUpdatePreferences[] = [];
    for (var scope of scopes) {
        var preference = { ...scope.saved };
        if (options.setup) {
            preference.checkAutomatically = preference.checkAutomatically === true;
            preference.installAutomatically = preference.installAutomatically === true;
        }
        pending.push(preference);
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
        var title = 'Settings / Update permissions';
        if (options.setup) { title = 'Setup 2 of 5 / Automatic updates'; }
        var saveLabel = 'Save changes';
        var description = 'Save applies changes. Esc discards unsaved edits.';
        if (options.setup) {
            saveLabel = 'Save and continue';
            description = 'Choose your preferences, then select Save and continue.';
        }
        setSetupLayout(title, description, '/velora/updates', '↑/↓ Move · Enter Change · Esc Back · Ctrl+C Quit');
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
                actions: [{ name: saveLabel, value: 'save', primary: true }], selected, width,
                height: setupDimensions().contentRows - 1 });
            var hint = feedback;
            var hintTone: 'muted' | 'OK' | 'Warning' | 'Error' = feedbackTone;
            if (index < rows.length) {
                hintTone = 'muted';
                var row = rows[index]!;
                hint = 'Check GitHub when velora starts.';
                if (row.field === 'installAutomatically') {
                    hint = 'Install signed velora releases on startup. Restart to use the new version.';
                    if (scopes[row.scopeIndex]!.engine) { hint = 'Automatic engine installation is not available yet.'; }
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
                    hintTone = 'Warning';
                    hint = 'Cannot read preferences. Check the settings file.';
                }
            }
            output += '  ' + style(hint.slice(0, width), hintTone);
            return useSetupScreen(output);
        });
        var draft = await edit({});
        if (!draft) {
            return false;
        }
        pending = draft;
        feedback = 'No changes.';
        feedbackTone = 'muted';
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
                feedbackTone = 'OK';
            } catch {
                feedbackTone = 'Error';
                feedback = 'Could not save ' + scope.name + '. Check storage access.';
                break;
            }
        }
        var allReadable = true;
        for (var scope of scopes) { allReadable = allReadable && scope.readable; }
        if (options.setup && allReadable && feedbackTone !== 'Error') { return true; }
    }
}
