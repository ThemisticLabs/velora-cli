import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import style from '../terminal/style.js';
import useSetupScreen from '../terminal/use-setup-screen.js';

export default createPrompt<string, Record<string, never>>(function (_config, done) {
    var [value, setValue] = useState('');
    var [error, setError] = useState('');
    var [revealedIndex, setRevealedIndex] = useState(-1);
    var REVEAL_DURATION_MS = 600;

    useEffect(function () {
        if (revealedIndex < 0) {
            return;
        }
        var timer = setTimeout(function () {
            setRevealedIndex(-1);
        }, REVEAL_DURATION_MS);
        return function () {
            clearTimeout(timer);
        };
    }, [value, revealedIndex]);

    useKeypress(function (key, terminal) {
        if (setupDimensions().tooSmall) {
            terminal.line = value;
            return;
        }
        setRevealedIndex(-1);
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
        var nextValue = terminal.line.toUpperCase();
        if (nextValue.length === value.length + 1 && nextValue.startsWith(value) && /^[!-~]$/.test(nextValue.slice(-1))) {
            setRevealedIndex(nextValue.length - 1);
        }
        setValue(nextValue);
        setError('');
    });

    var availableColumns = Math.max(1, process.stdout.columns - '› License key: '.length - 1);
    var visibleLength = Math.min(value.length, Math.floor((availableColumns + 1) / 2));
    var maskedValue = '';
    for (var index = 0; index < visibleLength; index++) {
        if (index > 0) {
            maskedValue += ' ';
        }
        if (index === revealedIndex) {
            maskedValue += value[index];
            continue;
        }
        maskedValue += '*';
    }
    var content = style('›', 'accent') + ' ' + style('License key:', 'strong') + ' ' + maskedValue;
    return useSetupScreen(content, error, true);
});
