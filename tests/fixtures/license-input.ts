import licenseInput from '../../src/setup/license-input.js';
import setSetupLayout from '../../src/terminal/set-setup-layout.js';

setSetupLayout('Enter your license.', '', 'Enter Continue · Ctrl+C Cancel');
process.stdout.write('\u001b[?1049h');
try {
    var value = await licenseInput({});
    if (value !== 'ABC') {
        throw new Error('Input was not normalized correctly.');
    }
    process.stdout.write('Input verified.\n');
} finally {
    process.stdout.write('\u001b[?25h\u001b[?1049l');
}
