import select from '../setup/select-option.js';
import setup from '../setup/setup.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import modelSettings from './model-settings.js';

export default async function manageModels(): Promise<void> {
    var currentChoice = 'switch';
    while (true) {
        setSetupLayout('Settings / Manage models', '', '/velora/models');
        var choice = await select({ back: true, message: '', initialValue: currentChoice, choices: [
            { name: 'Switch model', value: 'switch' },
            { name: 'Install another model', value: 'install' },
            { name: 'Delete model', value: 'delete' }
        ] });
        if (choice === 'back') {
            return;
        }
        currentChoice = choice;
        if (choice === 'install') {
            await setup({ modelsOnly: true });
            continue;
        }
        if (choice === 'switch' || choice === 'delete') {
            await modelSettings(choice);
        }
    }
}
