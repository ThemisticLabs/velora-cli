import apiKeys, { MAX_KEY_NAME_LENGTH, MAX_KEY_NOTE_LENGTH } from '../api/api-keys.js';
import copyClipboard from '../system/copy-clipboard.js';
import popup from '../terminal/popup.js';
import renderList, { type ListRow } from '../terminal/render-list.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import select from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function manageApiKeys(directory?: string, copy = copyClipboard): Promise<void> {
    var initialValue = 'add';
    while (true) {
        setSetupLayout('API keys', 'Keys identify apps. They do not encrypt processing.', '/velora');
        try {
            var stored = await apiKeys({ operation: 'list' }, directory);
        } catch {
            await select({ back: true, message: 'Could not read API keys. Check api-keys.json and storage access.', choices: [] });
            return;
        }
        var choices = [];
        var rows: ListRow[] = [];
        for (var key of stored.keys) {
            var cells = [key.name, key.note || 'No note', key.createdAt.slice(0, 10)];
            choices.push({ name: key.name, value: key.id, cells, description: key.note || 'Select to revoke this key.' });
            rows.push({ value: key.id, cells });
        }
        var columns = [{ title: 'Name' }, { title: 'Note' }, { title: 'Created', width: 10 }];
        var actions = [{ name: 'Add API key', value: 'add' }];
        var selected = await select({ back: true, message: '', initialValue, choices, columns, actions, emptyMessage: 'No API keys yet.' });
        if (selected === 'back') { return; }
        initialValue = selected;
        var background = function () {
            var dimensions = setupDimensions();
            return renderList({ rows, columns, actions, selected, width: dimensions.contentWidth, height: dimensions.contentRows });
        };
        if (selected === 'add') {
            await popup({ title: 'Add API key', description: 'Name the application and add an optional note.', background,
                fields: [{ name: 'name', label: 'Name', required: true, maxLength: MAX_KEY_NAME_LENGTH }, { name: 'note', label: 'Note', maxLength: MAX_KEY_NOTE_LENGTH }],
                submit: 'Create key', onSubmit: async function (values) {
                    var created = await apiKeys({ operation: 'create', name: values.name || '', note: values.note || '' }, directory);
                    var copied = false;
                    try { copied = await copy(created.key!); } catch {}
                    if (copied) { return { message: 'Key created and copied to your clipboard.' }; }
                    return { message: 'Clipboard unavailable. Copy this key before closing.', secret: created.key };
                }
            });
            continue;
        }
        for (var key of stored.keys) {
            if (key.id !== selected) { continue; }
            await popup({ title: 'Revoke API key', description: 'Revoke access for ' + key.name + '? The application will need a new key.', background,
                fields: [], submit: 'Revoke key', onSubmit: async function () {
                    await apiKeys({ operation: 'revoke', id: selected }, directory);
                    return { message: 'API key revoked.' };
                }
            });
        }
    }
}
