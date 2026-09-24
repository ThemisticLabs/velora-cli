import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import packageInfo from '../../package.json' with { type: 'json' };
import type { InstalledModel } from '../models/installed-models.js';
import cliUpdate, { updateCheckStatus } from '../updates/cli-update.js';
import modelUpdate from '../updates/model-update.js';
import DownloadError from '../downloads/download-error.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

export default async function updateMenu(model?: InstalledModel): Promise<void> {
    var task: Promise<void> | undefined;
    var prompt = createPrompt<void, Record<string, never>>(function (_config, done) {
        var [selected, setSelected] = useState('cli');
        var [checking, setChecking] = useState('');
        var [cliVersion, setCliVersion] = useState('-');
        var [modelVersion, setModelVersion] = useState('-');
        var [engineVersion, setEngineVersion] = useState('-');
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
                    if (checking === 'model' && model) {
                        var report = await modelUpdate(model, controller.signal);
                        if (!active) {
                            return;
                        }
                        setModelVersion(report.available?.version || '-');
                        setEngineVersion(report.available?.engineVersion || '-');
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
                        } else {
                            setModelVersion('-');
                            setEngineVersion('-');
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
        useKeypress(function (key) {
            if (key.name === 'escape') {
                done();
                return;
            }
            if (checking || setupDimensions().tooSmall) {
                return;
            }
            if (key.name === 'up') {
                setSelected('cli');
            }
            if (key.name === 'down' && model) {
                setSelected('model');
            }
            if (isEnterKey(key)) {
                setChecking(selected);
            }
        });
        var width = setupDimensions().contentWidth;
        var VERSION_COLUMNS = Math.floor(width / 3);
        var nameWidth = Math.max(1, width - VERSION_COLUMNS * 2);
        var output = '  ' + ' '.repeat(nameWidth) + style('Installed'.padEnd(VERSION_COLUMNS) + 'Available', 'muted') + '\n';
        var divider = '  ' + style('─'.repeat(width), 'divider') + '\n';
        output += divider;
        var rows = [{ name: 'velora', installed: packageInfo.version, available: cliVersion, group: 'cli' }];
        if (model) {
            rows.push({ name: model.name, installed: model.version, available: modelVersion, group: 'model' });
            rows.push({ name: 'Engine', installed: model.engineVersion || 'Unknown', available: engineVersion, group: 'model' });
        }
        for (var index = 0; index < rows.length; index++) {
            var row = rows[index]!;
            var marker = '  ';
            if (selected === row.group && row.name !== 'Engine') {
                marker = '› ';
            }
            var name = marker + row.name.slice(0, Math.max(0, nameWidth - marker.length));
            var installed = row.installed;
            var available = row.available;
            if (installed.length >= VERSION_COLUMNS) {
                installed = installed.slice(0, VERSION_COLUMNS - 2) + '…';
            }
            if (available.length >= VERSION_COLUMNS) {
                available = available.slice(0, VERSION_COLUMNS - 2) + '…';
            }
            var line = name.padEnd(nameWidth) + installed.padEnd(VERSION_COLUMNS) + available;
            if (selected === row.group) {
                line = style(line, 'accent');
            }
            output += '  ' + line + '\n';
            if (index === 0 || index === rows.length - 1) {
                output += divider;
            }
        }
        var status = cliStatus;
        var target = 'velora';
        if (selected === 'model' && model) {
            status = modelStatus;
            target = model.name + ' and its engine';
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
        setSetupLayout('Settings / Updates', '', '↑/↓ Select · Enter Check · Esc Back · Ctrl+C Quit', '/velora/updates');
        return useSetupScreen(output);
    });
    try {
        await prompt({});
    } finally {
        await task;
    }
}
