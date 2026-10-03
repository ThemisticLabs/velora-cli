import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import apiSettings, { DEFAULT_API_PORT, MAX_API_PORT } from '../api/api-settings.js';
import select from '../setup/select-option.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

export default async function editApiSettings(): Promise<void> {
    try {
        var saved = await apiSettings();
    } catch {
        setSetupLayout('Settings / Local API', '', '/velora/settings', 'Esc Back · Ctrl+C Quit');
        await select({ back: true, message: 'Could not read API settings. Check api.json and storage access.', choices: [] });
        return;
    }
    var input = createPrompt<number | null, Record<string, never>>(function (_config, done) {
        var [value, setValue] = useState(String(saved.port));
        var [error, setError] = useState('');
        useEffect(function (terminal) {
            terminal.write(String(saved.port));
        }, []);
        useKeypress(function (key, terminal) {
            if (key.name === 'escape') {
                done(null);
                return;
            }
            if (setupDimensions().tooSmall || key.name === 'f1') {
                terminal.line = value;
                return;
            }
            if (key.ctrl && key.name === 'u') {
                terminal.line = '';
                setValue('');
                setError('');
                return;
            }
            if (isEnterKey(key)) {
                var port = Number(value);
                if (!/^\d+$/.test(value) || port < 1 || port > MAX_API_PORT) {
                    setError('Choose a port from 1 to ' + MAX_API_PORT + '.');
                    terminal.write(value);
                    return;
                }
                done(port);
                return;
            }
            if (!/^\d*$/.test(terminal.line)) {
                terminal.line = value;
                return;
            }
            setValue(terminal.line);
            setError('');
        });
        var width = setupDimensions().contentWidth;
        var content = '  ' + style('Port:', 'strong') + ' ' + value.slice(0, Math.max(1, width - 'Port: '.length));
        return useSetupScreen(content, error, true);
    });
    var feedback = '';
    var currentChoice = 'port';
    while (true) {
        setSetupLayout('Settings / Local API', 'http://127.0.0.1:' + saved.port, '/velora/settings');
        var choice = await select({ back: true, message: '', initialValue: currentChoice, choices: [
            { name: 'Port: ' + saved.port, value: 'port', description: feedback || 'Choose a port for the local API.' },
            { name: 'Reset to default', value: 'reset', description: feedback || 'Use port ' + DEFAULT_API_PORT + '.' }
        ] });
        if (choice === 'back') {
            return;
        }
        currentChoice = choice;
        var port: number | null = DEFAULT_API_PORT;
        if (choice === 'port') {
            setSetupLayout('Settings / Local API', 'http://127.0.0.1:' + saved.port, '/velora/settings', 'Enter Save · Esc Back · Ctrl+C Quit');
            port = await input({});
        }
        if (port === null) {
            continue;
        }
        try {
            saved = await apiSettings(port);
            feedback = 'Saved.';
        } catch {
            feedback = 'Could not save the port. Check storage access and try again.';
        }
    }
}
