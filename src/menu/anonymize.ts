import { createPrompt, isEnterKey, useEffect, useKeypress, useRef, useState } from '@inquirer/core';
import { stripVTControlCharacters } from 'node:util';
import anonymizeText from '../api/anonymize-text.js';
import type { AnonymizeResponse } from '../api/anonymize-response.js';
import serviceControl from '../service/service-control.js';
import copyClipboard from '../system/copy-clipboard.js';
import select from '../setup/select-option.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import navigation from '../terminal/interactive-navigation.js';

export default async function anonymize(): Promise<void> {
    var status = await runTerminalTask(function (signal) { return serviceControl('status', undefined, undefined, signal); });
    if (status.state !== 'running') {
        setSetupLayout('Anonymize text', 'The selected model needs a running service.', '/velora');
        var choices = [];
        if (status.state === 'stopped') { choices.push({ name: 'Start service', value: 'start' }); }
        if (await select({ message: 'Start the service first. Stop and restart it if a previous load failed.', back: true, choices }) !== 'start') { return; }
        setSetupLayout('Loading the selected model…', '', '/velora', 'Ctrl+C Close');
        await runTerminalTask(function (signal) { return serviceControl('start', undefined, undefined, signal); });
    }
    var input = createPrompt<string | null, { initial: string }>(function (config, done) {
        var [value, setValue] = useState(config.initial);
        useEffect(function (terminal) { terminal.write(config.initial); }, []);
        useKeypress(function (key, terminal) {
            if (key.name === 'escape') { done(null); return; }
            if (key.name === 'f1' || setupDimensions().tooSmall) { terminal.line = value; return; }
            if (isEnterKey(key)) { done(value); return; }
            var characters = 0;
            for (var character of terminal.line) { characters++; }
            if (characters > 4096) { terminal.line = value; return; }
            setValue(terminal.line);
        });
        var width = setupDimensions().contentWidth;
        var visible = stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
        return useSetupScreen('  › ' + visible.slice(-Math.max(1, width - 2)), '', true);
    });
    var preview = createPrompt<boolean, AnonymizeResponse>(function (result, done) {
        var [scroll, setScroll] = useState(0);
        var [mapping, setMapping] = useState(false);
        var [feedback, setFeedback] = useState('');
        var active = useRef(true);
        useEffect(function () { return function () { active.current = false; }; }, []);
        useKeypress(function (key) {
            if (key.name === 'escape') { done(false); return; }
            if (setupDimensions().tooSmall) { return; }
            if (isEnterKey(key)) { done(true); return; }
            if (key.name === 'up') { setScroll(Math.max(0, start - 1)); }
            if (key.name === 'down') { setScroll(Math.min(maxStart, start + 1)); }
            if (key.name === 'home') { setScroll(0); }
            if (key.name === 'end') { setScroll(maxStart); }
            if (key.name === 'm') { setMapping(!mapping); setScroll(0); }
            if (key.name === 'c') {
                void copyClipboard(result.text).then(function (copied) {
                    if (!active.current) { return; }
                    var message = 'Could not copy text.';
                    if (copied) { message = 'Copied anonymized text.'; }
                    setFeedback(message);
                });
            }
        });
        var text = result.text;
        if (mapping) { text = JSON.stringify(result.mapping, null, 2); }
        text = stripVTControlCharacters(text).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ' ');
        var width = setupDimensions().contentWidth;
        var lines: string[] = [];
        for (var line of text.split('\n')) {
            if (!line) { lines.push(''); }
            for (var offset = 0; offset < line.length; offset += width) { lines.push(line.slice(offset, offset + width)); }
        }
        var capacity = Math.max(1, setupDimensions().contentRows - 1);
        var maxStart = Math.max(0, lines.length - capacity);
        var start = Math.min(scroll, maxStart);
        var output = '';
        for (var index = start; index < Math.min(lines.length, start + capacity); index++) { output += '  ' + lines[index] + '\n'; }
        var hint = feedback;
        if (start > 0) { hint += '  ↑ More above'; }
        if (start + capacity < lines.length) { hint += '  ↓ More below'; }
        output += '  ' + hint;
        var title = 'Anonymized text';
        if (mapping) { title = 'Mapping · Contains original values'; }
        setSetupLayout(title, '', '/velora', '↑/↓ Scroll · M Mapping · C Copy · Enter New · Esc Back');
        return useSetupScreen(output);
    });
    var initial = '';
    while (true) {
        setSetupLayout('Anonymize text', 'Enter one line, up to 4096 characters. Use velora anonymize for files or multiline input.', '/velora', 'Enter Anonymize · Esc Back · Ctrl+C Close');
        var text = await input({ initial }, { signal: navigation.controller.signal });
        if (text === null) { return; }
        var submittedText = text;
        initial = text;
        try {
            setSetupLayout('Anonymizing…', '', '/velora', 'Ctrl+C Close');
            var result = await runTerminalTask(function (signal) { return anonymizeText(submittedText, true, signal); });
            if (!await preview(result, { signal: navigation.controller.signal })) { return; }
            initial = '';
        } catch (error) {
            if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { throw error; }
            var message = 'Could not anonymize this text. Check the service and try again.';
            if (error instanceof Error && error.name === 'AnonymizeError') { message = error.message; }
            setSetupLayout('Anonymize text', '', '/velora', 'Esc Back · Ctrl+C Close', 'Error');
            if (await select({ message, back: true, choices: [{ name: 'Try again', value: 'retry' }] }) === 'back') { return; }
        }
    }
}
