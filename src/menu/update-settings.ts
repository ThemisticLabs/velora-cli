import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrompt, isEnterKey, useKeypress, useState } from '@inquirer/core';
import setSetupLayout from '../terminal/set-setup-layout.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import style from '../terminal/style.js';
import cliUpdatePreferences, { type CliUpdatePreferences } from '../updates/cli-update-preferences.js';
import engineUpdatePreferences from '../updates/engine-update-preferences.js';
import dataDirectory from '../system/data-directory.js';
import type { InstalledModel } from '../models/installed-models.js';

type Scope = { name: string; modelId?: string; saved: CliUpdatePreferences; readable: boolean };

export default async function updateSettings(model?: InstalledModel): Promise<void> {
    var scopes: Scope[] = [{ name: 'velora', saved: { checkAutomatically: null, installAutomatically: null }, readable: true }];
    if (model) {
        scopes.push({ name: 'Engine · ' + model.name, modelId: model.id, saved: { checkAutomatically: false, installAutomatically: false }, readable: true });
    }
    for (var scope of scopes) {
        try {
            if (!scope.modelId) {
                scope.saved = await cliUpdatePreferences() || scope.saved;
                continue;
            }
            var value: unknown = JSON.parse(await readFile(join(dataDirectory(), 'models', scope.modelId, 'engine-updates.json'), 'utf8'));
            if (typeof value !== 'object' || value === null || !('checkAutomatically' in value) || typeof value.checkAutomatically !== 'boolean' ||
                !('installAutomatically' in value) || typeof value.installAutomatically !== 'boolean' || value.installAutomatically && !value.checkAutomatically) {
                throw new Error('Invalid engine preferences.');
            }
            scope.saved = { checkAutomatically: value.checkAutomatically, installAutomatically: value.installAutomatically };
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                scope.readable = false;
            }
        }
    }
    var feedback = '';
    var selectedIndex = 0;
    var pending: CliUpdatePreferences[] = [];
    for (var scope of scopes) {
        pending.push({ ...scope.saved });
    }
    while (true) {
        setSetupLayout('Settings / Update permissions', 'Save applies changes. Esc discards unsaved edits.', '↑/↓ Move · Enter Change · Esc Back · Ctrl+C Quit', '/velora/updates');
        var edit = createPrompt<CliUpdatePreferences[] | null, Record<string, never>>(function (_config, done) {
            var [index, setIndex] = useState(selectedIndex);
            var [draft, setDraft] = useState(pending);
            var rows: { scopeIndex: number; field: keyof CliUpdatePreferences; label: string }[] = [];
            for (var scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
                rows.push({ scopeIndex, field: 'checkAutomatically', label: 'Automatic checks' });
                rows.push({ scopeIndex, field: 'installAutomatically', label: 'Automatic installation' });
            }
            useKeypress(function (key) {
                if (key.name === 'escape') {
                    done(null);
                    return;
                }
                if (setupDimensions().tooSmall) {
                    return;
                }
                if (key.name === 'down') {
                    setIndex(Math.min(rows.length, index + 1));
                }
                if (key.name === 'up') {
                    setIndex(Math.max(0, index - 1));
                }
                if (!isEnterKey(key) && key.name !== 'space') {
                    return;
                }
                if (index === rows.length) {
                    if (isEnterKey(key)) {
                        selectedIndex = index;
                        done(draft);
                    }
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
            });
            var width = setupDimensions().contentWidth;
            var output = '';
            for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                var row = rows[rowIndex]!;
                var scope = scopes[row.scopeIndex]!;
                if (row.field === 'checkAutomatically') {
                    output += '  ' + style(scope.name.slice(0, width), 'strong') + '\n';
                }
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
                var marker = '  ';
                if (index === rowIndex) {
                    marker = '› ';
                }
                var line = marker + row.label.padEnd(width - state.length - marker.length) + state;
                if (index === rowIndex) {
                    line = style(line, 'accent');
                }
                output += '  ' + line + '\n';
                if (row.field === 'installAutomatically') {
                    output += '  ' + style('─'.repeat(width), 'divider') + '\n';
                }
            }
            var save = '  Save changes';
            if (index === rows.length) {
                save = style('› Save changes', 'accent');
            }
            output += '  ' + save + '\n';
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
                if (scopes[row.scopeIndex]!.modelId) {
                    hint = 'Engine automation is not available yet.';
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
                if (scope.modelId) {
                    await engineUpdatePreferences(scope.modelId, { checkAutomatically: next.checkAutomatically === true, installAutomatically: next.installAutomatically === true });
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
