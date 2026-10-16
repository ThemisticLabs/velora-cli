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
    try {
        setSetupLayout('Checking service…', '', '/velora', 'Ctrl+C Close');
        var status = await runTerminalTask(function (signal) { return serviceControl('status', undefined, undefined, signal); });
        if (status.state !== 'running') {
            setSetupLayout('Anonymize text', 'The selected model needs a running service.', '/velora');
            var choices = [];
            if (status.state === 'stopped') { choices.push({ name: 'Start service', value: 'start' }); }
            if (await select({ message: 'Start the service first. Stop and restart it if a previous load failed.', back: true, choices }) !== 'start') { return; }
            setSetupLayout('Loading the selected model…', '', '/velora', 'Ctrl+C Close');
            await runTerminalTask(function (signal) { return serviceControl('start', undefined, undefined, signal); });
        }
    } catch (error) {
        if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { throw error; }
        var message = 'Could not access the service. Run velora serve status and try again.';
        if (error instanceof Error) { message = error.message; }
        setSetupLayout('Service', '', '/velora', 'Esc Back · Ctrl+C Close', 'Error');
        await select({ message, back: true, choices: [] });
        return;
    }
    var graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    var input = createPrompt<string | null, { initial: string }>(function (config, done) {
        var [entry, setEntry] = useState({ value: config.initial, cursor: config.initial.length });
        useKeypress(function (key, terminal) {
            var inserted = terminal.line.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
            // Readline cannot position a full input buffer inside a cropped viewport.
            terminal.clearLine(0);
            if (key.name === 'escape') { done(null); return; }
            if (key.name === 'f1' || setupDimensions().tooSmall) { return; }
            if (isEnterKey(key)) { done(entry.value); return; }
            var value = entry.value;
            var cursor = entry.cursor;
            var previous = 0;
            var next = value.length;
            for (var segment of graphemes.segment(value)) {
                if (segment.index < cursor) { previous = segment.index; }
                if (segment.index > cursor) { next = segment.index; break; }
            }
            if (key.name === 'left') { cursor = previous; }
            else if (key.name === 'right') { cursor = next; }
            else if (key.name === 'home' || key.ctrl && key.name === 'a') { cursor = 0; }
            else if (key.name === 'end' || key.ctrl && key.name === 'e') { cursor = value.length; }
            else if (key.name === 'backspace') {
                value = value.slice(0, previous) + value.slice(cursor);
                cursor = previous;
            }
            else if (key.name === 'delete') { value = value.slice(0, cursor) + value.slice(next); }
            else if (key.ctrl && key.name === 'u') {
                value = value.slice(cursor);
                cursor = 0;
            }
            else if (key.ctrl && key.name === 'k') { value = value.slice(0, cursor); }
            else if (inserted && !key.ctrl) {
                value = value.slice(0, cursor) + inserted + value.slice(cursor);
                cursor += inserted.length;
            } else { return; }
            var characters = 0;
            for (var character of value) { characters++; }
            if (characters > 4096) { return; }
            setEntry({ value, cursor });
        });
        var width = setupDimensions().contentWidth;
        var before = Bun.sliceAnsi(entry.value.slice(0, entry.cursor), -Math.max(1, width - 3));
        var after = Bun.sliceAnsi(entry.value.slice(entry.cursor), 0, Math.max(0, width - 2 - Bun.stringWidth(before)));
        var screen = useSetupScreen('  › ' + before + after, '', true);
        useEffect(function () {
            if (!setupDimensions().tooSmall) {
                process.stdout.write('\u001b[' + screen[0].split('\n').length + ';' + (5 + Bun.stringWidth(before)) + 'H');
            }
        }, [entry, screen[0], screen[1]]);
        return screen;
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
        var lines = Bun.wrapAnsi(text, width, { hard: true, wordWrap: false, trim: false }).split('\n');
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
