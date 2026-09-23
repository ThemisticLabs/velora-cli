import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import select from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import cliUpdatePreferences, { type CliUpdatePreferences } from '../updates/cli-update-preferences.js';
import engineUpdatePreferences from '../updates/engine-update-preferences.js';
import dataDirectory from '../system/data-directory.js';
import type { InstalledModel } from '../models/installed-models.js';

export default async function updateSettings(model?: InstalledModel): Promise<void> {
    var title = 'velora update permissions';
    var detail = 'Automatic installation is not available yet.';
    if (model) {
        title = 'Engine update permissions';
        detail = 'Automatic engine updates are not available yet.';
    }
    try {
        var stored: CliUpdatePreferences | null;
        if (model) {
            var value: unknown = JSON.parse(await readFile(join(dataDirectory(), 'models', model.id, 'engine-updates.json'), 'utf8'));
            if (typeof value !== 'object' || value === null || !('checkAutomatically' in value) || typeof value.checkAutomatically !== 'boolean' ||
                !('installAutomatically' in value) || typeof value.installAutomatically !== 'boolean' || value.installAutomatically && !value.checkAutomatically) {
                throw new Error('Invalid engine preferences.');
            }
            stored = { checkAutomatically: value.checkAutomatically, installAutomatically: value.installAutomatically };
        } else {
            stored = await cliUpdatePreferences();
        }
        var checks = 'Not decided';
        var installation = 'Not decided';
        if (stored?.checkAutomatically !== null && stored?.checkAutomatically !== undefined) {
            checks = 'Off';
            if (stored.checkAutomatically) {
                checks = 'On';
            }
        }
        if (stored?.installAutomatically !== null && stored?.installAutomatically !== undefined) {
            installation = 'Off';
            if (stored.installAutomatically) {
                installation = 'On';
            }
        }
        var status = 'Automatic checks: ' + checks + '\nAutomatic installation: ' + installation;
    } catch {
        status = 'No readable preferences. Choose Edit to save new choices.';
    }
    var FOOTER = '↑/↓ Move · Enter Select · Ctrl+C Close';
    setSetupLayout(title, detail, FOOTER, '/velora/updates');
    var action = await select({ message: status, choices: [
        { name: 'Edit permissions', value: 'edit' }, { name: 'Go back', value: 'back' }
    ] });
    if (action === 'back') {
        return;
    }
    var answer = await select({ message: 'Allow automatic update checks?', choices: [
        { name: 'No', value: 'no' }, { name: 'Yes', value: 'yes' }, { name: 'Go back', value: 'back' }
    ] });
    if (answer === 'back') {
        return;
    }
    var installAutomatically = false;
    if (answer === 'yes') {
        var installationChoice = await select({ message: 'Allow automatic installation when available?', choices: [
            { name: 'No, install manually', value: 'no' }, { name: 'Yes', value: 'yes' }, { name: 'Go back', value: 'back' }
        ] });
        if (installationChoice === 'back') {
            return;
        }
        installAutomatically = installationChoice === 'yes';
    }
    var preferences = { checkAutomatically: answer === 'yes', installAutomatically };
    try {
        if (model) {
            await engineUpdatePreferences(model.id, preferences);
        } else {
            await cliUpdatePreferences(preferences);
        }
        var message = 'Permissions saved.';
    } catch {
        message = 'Could not save permissions. Check storage access and try again.';
    }
    setSetupLayout(title, message, FOOTER, '/velora/updates');
    await select({ message: 'Next step', choices: [{ name: 'Go back', value: 'back' }] });
}
