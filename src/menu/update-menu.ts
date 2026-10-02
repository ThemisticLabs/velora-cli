import renderList from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import { createPrompt, useEffect, useState } from '@inquirer/core';
import packageInfo from '../../package.json' with { type: 'json' };
import cliUpdate, { updateCheckStatus, availableVersion } from '../updates/cli-update.js';
import engineUpdate, { lastEngineCheck } from '../updates/engine-update.js';
import downloadFailure from '../downloads/download-failure.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import select from '../setup/select-option.js';
import style from '../terminal/style.js';

export default async function updateMenu(): Promise<void> {
    while (true) {
        var initialCli = 'Not checked';
        var initialCliStatus = 'Not checked';
        if (updateCheckStatus === 'unavailable') { initialCli = 'Unavailable'; initialCliStatus = 'Could not check. Try again.'; }
        if (updateCheckStatus === 'current') { initialCli = 'Up to date'; initialCliStatus = 'velora is up to date.'; }
        if (availableVersion) { initialCli = availableVersion; initialCliStatus = 'Update available'; }
        var initialEngine = 'Not checked';
        if (lastEngineCheck) { initialEngine = 'Unavailable'; }
        if (lastEngineCheck?.current) { initialEngine = 'Up to date'; }
        if (lastEngineCheck?.available) { initialEngine = lastEngineCheck.available; }
        var task: Promise<void> | undefined;
        var prompt = createPrompt<'install-engine' | undefined, Record<string, never>>(function (_config, done) {
            var [checking, setChecking] = useState('');
            var [cliVersion, setCliVersion] = useState(initialCli);
            var [engineVersion, setEngineVersion] = useState(initialEngine);
            var [installedEngine, setInstalledEngine] = useState(lastEngineCheck?.installed || 'Not checked');
            var [engineStatus, setEngineStatus] = useState(lastEngineCheck?.message || 'Not checked');
            var [cliStatus, setCliStatus] = useState(initialCliStatus);
            useEffect(function () {
                if (!checking) {
                    return;
                }
                var controller = new AbortController();
                var active = true;
                task = (async function () {
                    try {
                        if (checking === 'cli') {
                            var version = await cliUpdate(undefined, undefined, controller.signal);
                            if (!active) {
                                return;
                            }
                            var available = 'Unavailable';
                            if (updateCheckStatus === 'current') { available = 'Up to date'; }
                            if (version) { available = version; }
                            setCliVersion(available);
                            var message = 'Could not check. Try again.';
                            if (updateCheckStatus === 'current') {
                                message = 'velora is up to date.';
                            }
                            if (version) {
                                message = 'Update available';
                            }
                            setCliStatus(message);
                        }
                        if (checking === 'engine') {
                            var engineReport = await engineUpdate(controller.signal);
                            if (!active) {
                                return;
                            }
                            setInstalledEngine(engineReport.installed || 'Unknown');
                            var available = 'Unavailable';
                            if (engineReport.current) { available = 'Up to date'; }
                            if (engineReport.available) { available = engineReport.available; }
                            setEngineVersion(available);
                            setEngineStatus(engineReport.message);
                        }
                    } catch (error) {
                        if (active) {
                            var message = downloadFailure(error, 'Could not check. Try again.');
                            if (checking === 'cli') {
                                setCliVersion('Unavailable');
                                setCliStatus(message);
                            } else if (checking === 'engine') {
                                setEngineVersion('Unavailable');
                                setEngineStatus(message);
                            }
                        }
                    } finally {
                        if (active) {
                            setChecking('');
                        }
                    }
                })();
                return function () {
                    active = false;
                    controller.abort();
                };
            }, [checking]);
            var values = ['cli', 'engine'];
            var rows = [{ value: 'cli', cells: ['velora', packageInfo.version, cliVersion] }];
            rows.push({ value: 'engine', cells: ['Engine', installedEngine, engineVersion] });
            var selected = useListNavigation({ values, disabled: Boolean(checking), onSelect: function (value) {
                if (value === 'engine' && lastEngineCheck?.available) {
                    done('install-engine');
                    return;
                }
                setChecking(value);
            }, onBack: function () { done(undefined); } });
            var width = setupDimensions().contentWidth;
            var output = '';
            var status = cliStatus;
            var target = 'velora';
            if (selected === 'engine') {
                status = engineStatus;
                target = 'Engine';
            }
            var available = cliVersion;
            if (selected === 'engine') { available = engineVersion; }
            var statusTone: 'muted' | 'OK' | 'Error' | 'accent' = 'muted';
            if (available === 'Up to date') { statusTone = 'OK'; }
            if (available === 'Unavailable') { statusTone = 'Error'; }
            if (available !== 'Not checked' && available !== 'Up to date' && available !== 'Unavailable') { statusTone = 'accent'; }
            if (checking) {
                statusTone = 'muted';
                status = 'Checking…';
            }
            output += '  ' + style(target.slice(0, width), 'strong') + '\n';
            while (status.length > width) {
                var end = status.lastIndexOf(' ', width);
                if (end < 1) {
                    end = width;
                }
                output += '  ' + style(status.slice(0, end), statusTone) + '\n';
                status = status.slice(end).trimStart();
            }
            output += '  ' + style(status, statusTone);
            var statusRows = output.split('\n').length;
            output = renderList({ rows, columns: [{ title: '' }, { title: 'Installed' }, { title: 'Available' }],
                selected, width, height: setupDimensions().contentRows - statusRows }) + output;
            setSetupLayout('Settings / Updates', '', '/velora/updates');
            return useSetupScreen(output);
        });
        try {
            var action = await prompt({});
        } finally {
            await task;
        }
        if (!action) { return; }
        if (!lastEngineCheck?.available) { continue; }
        var version = lastEngineCheck.available;
        setSetupLayout('Update engine to ' + version + '?', 'Models and license settings stay in place.', '/velora/updates', 'Enter Install · Esc Back · Ctrl+C Quit');
        var confirmation = await select({ back: true, message: '', choices: [{ name: 'Install engine update', value: 'install' }] });
        if (confirmation === 'back') { continue; }
        setSetupLayout('Updating engine…', '', '/velora/updates', 'Ctrl+C Cancel');
        try {
            await runTerminalTask(function (signal, onProgress) { return engineUpdate(signal, undefined, { version, onProgress }); });
        } catch (error) {
            if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { throw error; }
            var message = downloadFailure(error, 'Could not update the engine. Check your connection and try again.');
            setSetupLayout('Engine update unsuccessful.', message, '/velora/updates', 'Esc Back · Ctrl+C Quit', 'Error');
            await select({ back: true, message: '', choices: [] });
        }
    }
}
