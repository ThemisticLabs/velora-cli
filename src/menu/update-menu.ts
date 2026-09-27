import renderList from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import { createPrompt, useEffect, useState } from '@inquirer/core';
import packageInfo from '../../package.json' with { type: 'json' };
import type { InstalledModel } from '../models/installed-models.js';
import cliUpdate, { updateCheckStatus } from '../updates/cli-update.js';
import engineUpdate from '../updates/engine-update.js';
import modelUpdate from '../updates/model-update.js';
import DownloadError from '../downloads/download-error.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

export default async function updateMenu(model?: InstalledModel): Promise<void> {
    var task: Promise<void> | undefined;
    var prompt = createPrompt<void, Record<string, never>>(function (_config, done) {
        var [checking, setChecking] = useState('');
        var [cliVersion, setCliVersion] = useState('-');
        var [modelVersion, setModelVersion] = useState('-');
        var [engineVersion, setEngineVersion] = useState('-');
        var [installedEngine, setInstalledEngine] = useState('Not checked');
        var [engineStatus, setEngineStatus] = useState('Not checked');
        var [cliStatus, setCliStatus] = useState('Not checked');
        var [modelStatus, setModelStatus] = useState('Not checked');
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
                        setCliVersion(version || '-');
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
                        setInstalledEngine(engineReport.installed || 'Not installed');
                        setEngineVersion(engineReport.available || '-');
                        setEngineStatus(engineReport.message);
                    }
                    if (checking === 'model' && model) {
                        var report = await modelUpdate(model, controller.signal);
                        if (!active) {
                            return;
                        }
                        setModelVersion(report.available?.version || '-');
                        setModelStatus(report.message);
                    }
                } catch (error) {
                    if (active) {
                        var message = 'Could not check. Try again.';
                        if (error instanceof DownloadError) {
                            message = error.message;
                        }
                        if (checking === 'cli') {
                            setCliVersion('-');
                            setCliStatus(message);
                        } else if (checking === 'engine') {
                            setEngineVersion('-');
                            setEngineStatus(message);
                        } else {
                            setModelVersion('-');
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
        var selected = useListNavigation({ values, disabled: Boolean(checking), onSelect: setChecking, onBack: done });
        var width = setupDimensions().contentWidth;
        var output = '';
        var status = cliStatus;
        var target = 'velora';
        if (selected === 'engine') {
            status = engineStatus;
            target = 'Engine';
        }
        if (selected === 'model' && model) {
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
        output = renderList({ rows, columns: [{ title: '' }, { title: 'Installed' }, { title: 'Available' }],
            selected, width, height: setupDimensions().contentRows - statusRows }) + output;
        setSetupLayout('Settings / Updates', '', '↑/↓ Select · Enter Check · Esc Back · Ctrl+C Quit', '/velora/updates');
        return useSetupScreen(output);
    });
    try {
        await prompt({});
    } finally {
        await task;
    }
}
