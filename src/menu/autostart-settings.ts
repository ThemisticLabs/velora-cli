import autostart from '../system/autostart.js';
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
        var initialValue = 'off';
        if (saved.enabled) { initialValue = 'on'; }
        setSetupLayout(title, 'Start the local service and menu bar after you sign in to your Mac.', '/velora/settings');
        var choice = await select({ back: true, initialValue, message: '', choices: [
            { name: 'Off', value: 'off', description: 'Start velora yourself. Your choice takes effect at the next login.' },
            { name: 'On', value: 'on', description: 'A saved license and installed model are required.' }
        ] });
        if (choice === 'back') { return false; }
        try { await autostart(choice === 'on'); }
        catch {
            setSetupLayout(title, '', '/velora/settings', undefined, 'Error');
            var retry = await select({ back: true, message: 'Could not save. Check Library/LaunchAgents and try again.', choices: [{ name: 'Try again', value: 'retry' }] });
            if (retry === 'back') { return false; }
            continue;
        }
        if (options.setup) { return true; }
        setSetupLayout(title, 'Saved. Takes effect at the next login.', '/velora/settings', undefined, 'OK');
        await select({ back: true, message: '', choices: [] });
        return true;
    }
}
