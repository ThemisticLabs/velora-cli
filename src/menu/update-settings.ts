import switchList, { type SwitchRow } from '../terminal/switch-list.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
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
    var initialValue = 'velora:checkAutomatically';
    if (options.setup) { initialValue = 'save'; }
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
        var switches = [];
        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            var row = rows[rowIndex]!;
            var scope = scopes[row.scopeIndex]!;
            var hint = 'Check GitHub when velora starts.';
            if (scope.engine) { hint = 'Check the engine when velora starts.'; }
            if (row.field === 'installAutomatically') {
                hint = 'Install signed velora releases on startup.';
                if (scope.engine) { hint = 'Automatic engine installation is not available yet.'; }
            }
            var option: SwitchRow = { value: scope.name + ':' + row.field, name: row.label,
                enabled: pending[row.scopeIndex]![row.field], hint, group: String(row.scopeIndex) };
            if (row.field === 'checkAutomatically') { option.section = scope.name; }
            if (row.field === 'installAutomatically') { option.requires = scope.name + ':checkAutomatically'; }
            if (!scope.readable) { option.unavailable = 'Cannot read preferences. Check the settings file.'; }
            switches.push(option);
        }
        var draft = await switchList({ rows: switches, saveLabel, initialValue, feedback, feedbackTone });
        if (!draft) {
            return false;
        }
        initialValue = 'save';
        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            var row = rows[rowIndex]!;
            pending[row.scopeIndex]![row.field] = draft[rowIndex]!.enabled;
        }
        feedback = 'No changes.';
        feedbackTone = 'muted';
        for (var index = 0; index < scopes.length; index++) {
            var scope = scopes[index]!;
            var next = pending[index]!;
            if (!scope.readable || next.checkAutomatically === scope.saved.checkAutomatically && next.installAutomatically === scope.saved.installAutomatically) {
                continue;
            }
            try {
                if (scope.engine) {
                    await engineUpdatePreferences({ checkAutomatically: next.checkAutomatically === true, installAutomatically: next.installAutomatically === true });
                } else {
                    await cliUpdatePreferences(next);
                }
                scope.saved = { ...next };
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
