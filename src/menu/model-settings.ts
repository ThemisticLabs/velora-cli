import runTerminalTask from '../terminal/run-terminal-task.js';
import select from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import installedModels from '../models/installed-models.js';

export default async function modelSettings(operation: 'switch' | 'delete'): Promise<void> {
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
            choices.push({ name, value: 'model:' + model.id, cells: [name, model.version], documentationPath: '/velora/models/' + encodeURIComponent(model.id) });
        }
        var title = 'Installed models / Switch model';
        if (operation === 'delete') {
            title = 'Installed models / Delete model';
        }
        setSetupLayout(title, '', '/velora/models');
        var selected = await select({ back: true, message: '', initialValue: currentChoice, choices,
            columns: [{ title: 'Model' }, { title: 'Version' }], emptyMessage: 'No models installed.' });
        currentChoice = selected;
        if (selected === 'back') {
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
        setSetupLayout('Delete ' + name + '?', 'Deletes its local package. Your license and shared engine settings stay saved.', '/velora/models');
        var confirmation = await select({ back: true, message: 'This model will need to be downloaded again.', choices: [
            { name: 'Delete model', value: 'delete' }
        ] });
        if (confirmation !== 'delete') {
            continue;
        }
        setSetupLayout('Deleting model…', name, '/velora/models', 'Ctrl+C Close after cleanup');
        await runTerminalTask(function () { return installedModels({ operation: 'delete', id: selected }); });
        return;
    }
}
