import autostart from '../system/autostart.js';
import switchList from '../terminal/switch-list.js';
import select from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function autostartSettings(options: { setup?: boolean } = {}): Promise<boolean> {
    var title = 'Settings / Start at login';
    if (options.setup) { title = 'Setup 3 of 5 / Start at login'; }
    while (true) {
        try {
            var saved = await autostart();
        } catch (error) {
            var message = 'Could not read the login item. Check Library/LaunchAgents.';
            if (error instanceof Error) { message = error.message; }
            setSetupLayout(title, '', '/velora/settings', undefined, 'Error');
            var retry = await select({ back: true, message, choices: [{ name: 'Try again', value: 'retry' }] });
            if (retry === 'back') { return false; }
            continue;
        }
        if (!saved.supported) {
            setSetupLayout(title, 'Start at login is not available on this platform yet.', '/velora/settings');
            var next = await select({ back: true, message: '', choices: [{ name: 'Continue', value: 'continue' }] });
            return next !== 'back';
        }
        break;
    }
    var saveLabel = 'Save changes';
    var initialValue = 'login';
    if (options.setup) { saveLabel = 'Save and continue'; initialValue = 'save'; }
    var rows = [{ value: 'login', name: 'Start at login', enabled: saved.enabled,
        hint: 'Requires a saved license and an installed model.' }];
    var feedback = '';
    var feedbackTone: 'muted' | 'OK' | 'Error' = 'muted';
    while (true) {
        setSetupLayout(title, 'Start the service and menu bar at your next Mac login.', '/velora/settings', '↑/↓ Move · Enter Change · Esc Back · Ctrl+C Quit');
        var draft = await switchList({ rows, saveLabel, initialValue, feedback, feedbackTone });
        if (!draft) { return false; }
        rows[0]!.enabled = draft[0]!.enabled === true;
        initialValue = 'save';
        try { await autostart(rows[0]!.enabled); }
        catch {
            feedback = 'Could not save. Check Library/LaunchAgents and retry.';
            feedbackTone = 'Error';
            continue;
        }
        if (options.setup) { return true; }
        feedback = 'Saved. Takes effect at the next login.';
        feedbackTone = 'OK';
    }
}
