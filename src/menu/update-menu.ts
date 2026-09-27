import renderList from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import { createPrompt, useEffect, useState } from '@inquirer/core';
import packageInfo from '../../package.json' with { type: 'json' };
import type { InstalledModel } from '../models/installed-models.js';
import cliUpdate, { updateCheckStatus, availableVersion } from '../updates/cli-update.js';
import engineUpdate, { lastEngineCheck } from '../updates/engine-update.js';
import installedModels from '../models/installed-models.js';
import modelUpdate from '../updates/model-update.js';
import DownloadError from '../downloads/download-error.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import select from '../setup/select-option.js';
import style from '../terminal/style.js';

export default async function updateMenu(model?: InstalledModel): Promise<void> {
    var modelReport: Awaited<ReturnType<typeof modelUpdate>> | undefined;
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
        var prompt = createPrompt<'install-engine' | 'install-model' | undefined, Record<string, never>>(function (_config, done) {
            var [checking, setChecking] = useState('');
            var [cliVersion, setCliVersion] = useState(initialCli);
            var initialModel = 'Not checked';
            if (modelReport) { initialModel = 'Unavailable'; }
            if (modelReport?.current) { initialModel = 'Up to date'; }
            if (modelReport?.available) { initialModel = modelReport.available.version; }
            var [modelVersion, setModelVersion] = useState(initialModel);
            var [engineVersion, setEngineVersion] = useState(initialEngine);
            var [installedEngine, setInstalledEngine] = useState(lastEngineCheck?.installed || 'Not checked');
            var [engineStatus, setEngineStatus] = useState(lastEngineCheck?.message || 'Not checked');
            var [cliStatus, setCliStatus] = useState(initialCliStatus);
            var [modelStatus, setModelStatus] = useState(modelReport?.message || 'Not checked');
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
                        if (checking === 'model' && model) {
                            var report = await modelUpdate(model, controller.signal);
                            if (!active) {
                                return;
                            }
                            modelReport = report;
                            var available = 'Unavailable';
                            if (report.current) { available = 'Up to date'; }
                            if (report.available) { available = report.available.version; }
                            setModelVersion(available);
                            setModelStatus(report.message);
                        }
                    } catch (error) {
                        if (active) {
                            var message = 'Could not check. Try again.';
                            if (error instanceof DownloadError) {
                                message = error.message;
                            }
                            if (checking === 'cli') {
                                setCliVersion('Unavailable');
                                setCliStatus(message);
                            } else if (checking === 'engine') {
                                setEngineVersion('Unavailable');
                                setEngineStatus(message);
                            } else {
                                modelReport = { message };
                                setModelVersion('Unavailable');
                                setModelStatus(message);
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
            if (model) {
                values.push('model');
                rows.push({ value: 'model', cells: [model.name, model.version, modelVersion] });
            }
            var actions: { name: string; value: string }[] = [];
            if (lastEngineCheck?.available) {
                values.push('install-engine');
                actions.push({ name: 'Install engine update', value: 'install-engine' });
            }
            if (modelReport?.available) {
                values.push('install-model');
                actions.push({ name: 'Install model update', value: 'install-model' });
            }
            var selected = useListNavigation({ values, disabled: Boolean(checking), onSelect: function (value) {
                if (value === 'install-engine' || value === 'install-model') { done(value); return; }
                setChecking(value);
            }, onBack: function () { done(undefined); } });
            var width = setupDimensions().contentWidth;
            var output = '';
            var status = cliStatus;
            var target = 'velora';
            if (selected === 'engine' || selected === 'install-engine') {
                status = engineStatus;
                target = 'Engine';
            }
            if ((selected === 'model' || selected === 'install-model') && model) {
                status = modelStatus;
                target = model.name;
            }
            if (checking) {
                status = 'Checking…';
            }
            output += '  ' + style(target.slice(0, width), 'strong') + '\n';
            while (status.length > width) {
                var end = status.lastIndexOf(' ', width);
                if (end < 1) {
                    end = width;
                }
                output += '  ' + style(status.slice(0, end), 'muted') + '\n';
                status = status.slice(end).trimStart();
            }
            output += '  ' + style(status, 'muted');
            var statusRows = output.split('\n').length;
            output = renderList({ rows, actions, columns: [{ title: '' }, { title: 'Installed' }, { title: 'Available' }],
                selected, width, height: setupDimensions().contentRows - statusRows }) + output;
            setSetupLayout('Settings / Updates', '', '↑/↓ Select · Enter Check · Esc Back · Ctrl+C Quit', '/velora/updates');
            return useSetupScreen(output);
        });
        try {
            var action = await prompt({});
        } finally {
            await task;
        }
        if (!action) { return; }
        if (action === 'install-model' && model && modelReport?.available) {
            var release = modelReport.available;
            setSetupLayout('Update ' + model.name + '?', release.version, 'Enter Install · Esc Back · Ctrl+C Quit', '/velora/models/' + model.id);
            var confirmation = await select({ back: true, message: '', choices: [{ name: 'Install model update', value: 'install' }] });
            if (confirmation === 'back') { continue; }
            setSetupLayout('Updating ' + model.name + '…', '', 'Ctrl+C Cancel', '/velora/models/' + model.id);
            try {
                modelReport = await runTerminalTask(function (signal, onProgress) { return modelUpdate(model!, signal, undefined, { release, onProgress }); });
                for (var installed of await installedModels({ operation: 'list' })) {
                    if (installed.id === model.id) { model = installed; break; }
                }
            } catch (error) {
                if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { throw error; }
                var message = 'Could not update the model. Check your connection and try again.';
                if (error instanceof DownloadError) { message = error.message; }
                modelReport = undefined;
                setSetupLayout('Model update unsuccessful.', message, 'Esc Back · Ctrl+C Quit', '/velora/models/' + model.id);
                await select({ back: true, message: '', choices: [] });
            }
            continue;
        }
        if (!lastEngineCheck?.available) { continue; }
        var version = lastEngineCheck.available;
        setSetupLayout('Update engine to ' + version + '?', 'Models and license settings stay in place.', 'Enter Install · Esc Back · Ctrl+C Quit', '/velora/updates');
        var confirmation = await select({ back: true, message: '', choices: [{ name: 'Install engine update', value: 'install' }] });
        if (confirmation === 'back') { continue; }
        setSetupLayout('Updating engine…', '', 'Ctrl+C Cancel', '/velora/updates');
        try {
            await runTerminalTask(function (signal, onProgress) { return engineUpdate(signal, undefined, { version, onProgress }); });
        } catch (error) {
            if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { throw error; }
            var message = 'Could not update the engine. Check your connection and try again.';
            if (error instanceof DownloadError) { message = error.message; }
            setSetupLayout('Engine update unsuccessful.', message, 'Esc Back · Ctrl+C Quit', '/velora/updates');
            await select({ back: true, message: '', choices: [] });
        }
    }
}
