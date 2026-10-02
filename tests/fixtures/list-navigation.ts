import select from '../../src/setup/select-option.js';
import setSetupLayout from '../../src/terminal/set-setup-layout.js';

setSetupLayout('Navigation', '', '↑/↓ Move · Enter Select · Esc Back');
var initialValue = 'first';
if (process.argv[2] === 'down') {
    initialValue = 'last';
}
var result = await select({ back: true, message: '', initialValue,
    choices: [{ name: 'First row', value: 'first' }, { name: 'Second row', value: 'second' }],
    actions: [{ name: 'Last action', value: 'last' }]
});
process.stdout.write('Selected: ' + result + '\n');
