import runTerminalTask from '../terminal/run-terminal-task.js';
import select from '../setup/select-option.js';
import setup from '../setup/setup.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import installedModels from '../models/installed-models.js';

export default async function modelSettings(operation: 'switch' | 'delete'): Promise<void> {
    var FOOTER = '↑/↓ Move · Enter Select · Esc Back · Ctrl+C Quit';
    var currentChoice = '';
    while (true) {
        var models = await installedModels({ operation: 'list' });
        var choices = [];
        for (var model of models) {
            var name = model.name;
            if (model.selected) {
                name += ' (selected)';
                if (!currentChoice) {
                    currentChoice = 'model:' + model.id;
                }
            }
            choices.push({ name, value: 'model:' + model.id, cells: [name, model.version, model.engineVersion || 'Unknown'], documentationPath: '/models/' + encodeURIComponent(model.id) });
        }
        var actions = [];
        var title = 'Installed models / Switch model';
        if (operation === 'switch') {
            actions.push({ name: 'Install another model', value: 'install' });
        } else {
            title = 'Installed models / Delete model';
        }
        actions.push({ name: 'Go back', value: 'back' });
        setSetupLayout(title, '', FOOTER, '/velora/models');
        var selected = await select({ message: '', initialValue: currentChoice, choices, actions,
            columns: [{ title: 'Model' }, { title: 'Version', width: 12 }, { title: 'Engine', width: 12 }], emptyMessage: 'No models installed.' });
        currentChoice = selected;
        if (selected === 'back') {
            return;
        }
        if (selected === 'install') {
            await setup({ modelsOnly: true });
            return;
        }
        selected = selected.slice('model:'.length);
        if (operation === 'switch') {
            await runTerminalTask(function () { return installedModels({ operation: 'select', id: selected }); });
            return;
        }
        var name = selected;
        for (var model of models) {
            if (model.id === selected) {
                name = model.name;
            }
        }
        setSetupLayout('Delete ' + name + '?', 'Deletes its local package and engine preferences. Your license stays saved.', FOOTER, '/velora/models');
        var confirmation = await select({ message: 'This model will need to be downloaded again.', choices: [
            { name: 'Go back', value: 'back' }, { name: 'Delete model', value: 'delete' }
        ] });
        if (confirmation !== 'delete') {
            continue;
        }
        setSetupLayout('Deleting model…', name, 'Ctrl+C Close after cleanup', '/velora/models');
        await runTerminalTask(function () { return installedModels({ operation: 'delete', id: selected }); });
        return;
    }
}
