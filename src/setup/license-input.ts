import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import style from '../terminal/style.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import navigation from '../terminal/interactive-navigation.js';

export default async function licenseInput(config: Record<string, never>, context?: Parameters<typeof prompt>[1]): Promise<string> {
    var signal = navigation.controller.signal;
    if (context?.signal) {
        signal = AbortSignal.any([signal, context.signal]);
    }
    return prompt(config, { ...context, signal });
}

var prompt = createPrompt<string, Record<string, never>>(function (_config, done) {
    var [value, setValue] = useState('');
    var [error, setError] = useState('');
    var [revealedIndex, setRevealedIndex] = useState(-1);
    var REVEAL_DURATION_MS = 600;
    var KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var GROUP_LENGTH = 5;
    var KEY_CHARACTERS = 20;
    var KEY_LENGTH = KEY_CHARACTERS + 3;

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
        if (key.name === 'f1') { terminal.line = value; return; }
        if (key.name === 'escape') {
            done('');
            return;
        }
        if (setupDimensions().tooSmall) {
            terminal.line = value;
            return;
        }
        setRevealedIndex(-1);
        if (isEnterKey(key)) {
            if (!value) {
                setError('Enter a license key, or press Esc to go back.');
                return;
            }
            if (value.length < KEY_LENGTH) {
                setError('The key is incomplete: ' + value.replaceAll('-', '').length + ' of ' + KEY_CHARACTERS + ' characters.');
                // Readline clears its buffer on Enter, including rejected input.
                terminal.write(value);
                return;
            }
            done(value);
            return;
        }
        var typed = terminal.line.toUpperCase();
        var nextValue = '';
        var characters = 0;
        var rejected = false;
        for (var character of typed) {
            if (character === '-' || character === ' ') {
                continue;
            }
            if (!KEY_ALPHABET.includes(character)) {
                rejected = true;
                continue;
            }
            if (characters === KEY_CHARACTERS) {
                continue;
            }
            if (characters > 0 && characters % GROUP_LENGTH === 0) {
                nextValue += '-';
            }
            nextValue += character;
            characters++;
        }
        if (nextValue.length === value.length + 1 && nextValue.startsWith(value)) {
            setRevealedIndex(nextValue.length - 1);
        }
        if (nextValue.length === value.length + 2 && nextValue.startsWith(value) && nextValue[value.length] === '-') {
            setRevealedIndex(nextValue.length - 1);
        }
        // Keep readline in sync so the dashes appear and backspace removes whole characters.
        terminal.line = nextValue;
        (terminal as unknown as { cursor: number }).cursor = nextValue.length;
        setValue(nextValue);
        if (rejected) {
            setError('License keys only use A-Z and 2-9, without I, O, 0 and 1.');
            return;
        }
        setError('');
    });

    var availableColumns = Math.max(1, process.stdout.columns - '  › License key: '.length - 1);
    var visibleLength = Math.min(value.length, Math.floor((availableColumns + 1) / 2));
    var maskedValue = '';
    for (var index = 0; index < visibleLength; index++) {
        if (index > 0) {
            maskedValue += ' ';
        }
        if (value[index] === '-') {
            maskedValue += '-';
            continue;
        }
        if (index === revealedIndex) {
            maskedValue += value[index];
            continue;
        }
        maskedValue += '*';
    }
    var content = '  ' + style('›', 'accent') + ' ' + style('License key:', 'strong') + ' ' + maskedValue;
    return useSetupScreen(content, error, true);
});
