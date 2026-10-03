import { createPrompt, isEnterKey, useEffect, useKeypress, useRef, useState } from '@inquirer/core';
import { stripVTControlCharacters } from 'node:util';
import setupDimensions from './setup-dimensions.js';
import useSetupScreen from './use-setup-screen.js';
import style from './style.js';

type PopupResult = { message: string; secret?: string };
type PopupOptions = {
    title: string;
    description: string;
    background: () => string;
    fields: { name: string; label: string; required?: boolean; maxLength: number }[];
    submit: string;
    onSubmit: (values: Record<string, string>) => Promise<PopupResult>;
};

export default createPrompt<void, PopupOptions>(function (config, done) {
    var [values, setValues] = useState<Record<string, string>>({});
    var [focus, setFocus] = useState(0);
    var [busy, setBusy] = useState(false);
    var [error, setError] = useState('');
    var [result, setResult] = useState<PopupResult | undefined>(undefined);
    var active = useRef(true);
    var submitting = useRef(false);
    useEffect(function () {
        return function () { active.current = false; };
    }, []);
    useKeypress(function (key, terminal) {
        if (busy || submitting.current) { terminal.line = ''; return; }
        if (key.name === 'escape') { done(); return; }
        if (setupDimensions().tooSmall || key.name === 'f1') {
            terminal.line = values[config.fields[focus]?.name || ''] || '';
            return;
        }
        if (result) {
            if (isEnterKey(key)) { done(); }
            terminal.line = '';
            return;
        }
        if (key.name === 'tab' || key.name === 'down' || key.name === 'up') {
            var direction = 1;
            if (key.shift || key.name === 'up') { direction = -1; }
            var next = (focus + direction + config.fields.length + 1) % (config.fields.length + 1);
            setFocus(next);
            terminal.line = values[config.fields[next]?.name || ''] || '';
            return;
        }
        if (isEnterKey(key)) {
            var field = config.fields[focus];
            if (field) {
                if (field.required && !values[field.name]?.trim()) { setError('Enter ' + field.label.toLowerCase() + '.'); return; }
                setFocus(focus + 1);
                terminal.line = values[config.fields[focus + 1]?.name || ''] || '';
                return;
            }
            for (var index = 0; index < config.fields.length; index++) {
                var requiredField = config.fields[index]!;
                if (requiredField.required && !values[requiredField.name]?.trim()) {
                    setError('Enter ' + requiredField.label.toLowerCase() + '.');
                    setFocus(index);
                    terminal.line = values[requiredField.name] || '';
                    return;
                }
            }
            submitting.current = true;
            setBusy(true);
            setError('');
            void config.onSubmit(values).then(function (value) {
                submitting.current = false;
                if (active.current) { setResult(value); setBusy(false); }
            }).catch(function () {
                submitting.current = false;
                if (active.current) { setError('Could not save. Check storage access and try again.'); setBusy(false); }
            });
            terminal.line = '';
            return;
        }
        var field = config.fields[focus];
        if (!field) { terminal.line = ''; return; }
        if (key.ctrl && key.name === 'u') { terminal.line = ''; }
        if (/[\x00-\x1f\x7f-\x9f]/.test(terminal.line) || terminal.line.length > field.maxLength) {
            terminal.line = values[field.name] || '';
            return;
        }
        setValues({ ...values, [field.name]: terminal.line });
        setError('');
    });
    var dimensions = setupDimensions();
    var POPUP_MAX_WIDTH = 76;
    var POPUP_MAX_HEIGHT = 14;
    var width = Math.max(6, Math.min(POPUP_MAX_WIDTH, dimensions.contentWidth));
    var innerWidth = Math.max(1, width - 4);
    var lines = [style(config.title, 'strong'), ''];
    var description = config.description;
    if (result) { description = result.message; }
    if (error) { description = error; }
    var descriptionTone: 'muted' | 'Error' = 'muted';
    if (error) { descriptionTone = 'Error'; }
    while (description.length > innerWidth) {
        var end = description.lastIndexOf(' ', innerWidth);
        if (end < 1) { end = innerWidth; }
        lines.push(style(description.slice(0, end), descriptionTone));
        description = description.slice(end).trimStart();
    }
    lines.push(style(description, descriptionTone), '');
    if (!result) {
        for (var index = 0; index < config.fields.length; index++) {
            var field = config.fields[index]!;
            var label = '  ' + field.label + ': ';
            if (index === focus) { label = '› ' + field.label + ': '; }
            var value = values[field.name] || '';
            var available = Math.max(1, innerWidth - label.length - 1);
            var text = label + value.slice(-available);
            if (index === focus) { text += '▏'; text = style(text, 'accent'); }
            lines.push(text);
        }
    }
    if (result?.secret) {
        for (var offset = 0; offset < result.secret.length; offset += innerWidth) {
            lines.push(result.secret.slice(offset, offset + innerWidth));
        }
    }
    var button = config.submit;
    if (busy) { button = 'Saving…'; }
    if (result) { button = 'Close'; }
    var buttonText = '  ' + button;
    if (result || focus === config.fields.length) { buttonText = style('› ' + button, 'accent'); }
    var panelHeight = Math.min(POPUP_MAX_HEIGHT, dimensions.contentRows);
    while (lines.length < panelHeight - 3) { lines.push(''); }
    lines.push(buttonText);
    var hint = 'Tab Move · Enter Select · Esc Cancel';
    if (busy) { hint = 'Saving…'; }
    if (result) { hint = 'Enter Close · Esc Close'; }
    var panel = [style('┌' + '─'.repeat(width - 2) + '┐', 'divider')];
    for (var line of lines) {
        var padding = Math.max(0, innerWidth - stripVTControlCharacters(line).length);
        panel.push(style('│ ', 'divider') + line + ' '.repeat(padding) + style(' │', 'divider'));
    }
    panel.push(style('└' + '─'.repeat(width - 2) + '┘', 'divider'));
    var background = stripVTControlCharacters(config.background()).split('\n');
    var height = dimensions.contentRows;
    var top = Math.max(0, Math.floor((height - panel.length) / 2));
    var left = Math.max(0, Math.floor((dimensions.contentWidth - width) / 2));
    var content = '';
    for (var row = 0; row < height; row++) {
        if (row > 0) { content += '\n'; }
        if (row >= top && row < top + panel.length) {
            content += '  ' + ' '.repeat(left) + panel[row - top];
        } else {
            content += style((background[row] || '  ').slice(0, dimensions.contentWidth + 2), 'muted');
        }
    }
    return useSetupScreen(content, '', false, undefined, hint + ' · Ctrl+C Quit');
});
