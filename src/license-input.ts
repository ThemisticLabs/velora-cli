import { createPrompt, isEnterKey, useKeypress, useState } from '@inquirer/core';
import style from './style.js';

export default createPrompt<string, Record<string, never>>(function (_config, done) {
    var [value, setValue] = useState('');
    var [error, setError] = useState('');

    useKeypress(function (key, terminal) {
        if (isEnterKey(key)) {
            var license = value.trim();
            if (!license) {
                setError('Enter a license key, or press Ctrl+C to cancel.');
                // Readline clears its buffer on Enter, including rejected input.
                terminal.write(value);
                return;
            }
            done(license);
            return;
        }
        setValue(terminal.line);
        setError('');
    });

    var availableColumns = Math.max(1, process.stdout.columns - '› License key: '.length - 1);
    var visibleLength = Math.min(value.length, availableColumns);
    var content = style('›', 'accent') + ' ' + style('License key:', 'strong') + ' ' + '*'.repeat(visibleLength);
    return [content, error];
});
