import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import { mkdir, lstat } from 'node:fs/promises';
import DownloadError from '../downloads/download-error.js';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';
import downloadModel, { type DownloadProgress } from '../downloads/download-model.js';
import type { LicenseModel } from '../license/license-access.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import style from '../terminal/style.js';
import renderProgress from '../terminal/render-progress.js';

export default async function downloadScreen(license: string, model: LicenseModel): Promise<'complete' | 'failed' | 'cancelled-after-install'> {
    var controller = new AbortController();
    var task: Promise<void> | undefined;
    var installed = false;
    var prompt = createPrompt<boolean, Record<string, never>>(function (_config, done) {
        var [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0, message: '' });
        var [logs, setLogs] = useState<string[]>([]);
        var [status, setStatus] = useState('running');
        var [frame, setFrame] = useState(0);
        useEffect(function () {
            var FRAME_INTERVAL_MS = 100;
            var timer = setInterval(function () { setFrame(function (value) { return value + 1; }); }, FRAME_INTERVAL_MS);
            return function () { clearInterval(timer); };
        }, []);
        useEffect(function () {
            var active = true;
            task = (async function () {
                try {
                    controller.signal.throwIfAborted();
                    var directory = dataDirectory();
                    for (var parent of [directory, join(directory, 'models')]) {
                        await mkdir(parent, { recursive: true, mode: 0o700 });
                        if ((await lstat(parent)).isSymbolicLink()) {
                            throw new DownloadError('Model storage directories must not be symbolic links.');
                        }
                    }
                    var installation = await downloadModel({ license, modelId: model.id, modelName: model.name,
                        root: join(directory, 'models', model.id), signal: controller.signal,
                        onProgress: function (update) {
                            if (!active) {
                                return;
                            }
                            setProgress(update);
                            if (update.message) {
                                var MAX_LOG_LINES = 100;
                                setLogs(function (previous) {
                                    if (previous[previous.length - 1] === update.message) { return previous; }
                                    return [...previous.slice(-(MAX_LOG_LINES - 1)), update.message];
                                });
                            }
                        }
                    });
                    installed = true;
                    if (active) {
                        if (installation.cleanupRequired) {
                            setLogs(function (previous) {
                                return [...previous, 'Installed, but cleanup failed. Check model storage permissions and .update.lock before retrying.'];
                            });
                        }
                        setStatus('complete');
                    }
                } catch (error) {
                    if (active && !controller.signal.aborted) {
                        var message = 'Download failed. Check your connection and try again.';
                        if (error instanceof DownloadError) {
                            message = error.message;
                        }
                        if (error instanceof Error && 'code' in error) {
                            if (error.code === 'ENOSPC') {
                                message = 'Not enough storage space. Free disk space and try again.';
                            }
                            if (error.code === 'EACCES' || error.code === 'EPERM') {
                                message = 'Cannot write to model storage. Check its permissions and try again.';
                            }
                        }
                        setLogs(function (previous) { return [...previous, message]; });
                        setStatus('failed');
                    }
                }
            })();
            return function () {
                active = false;
                controller.abort();
            };
        }, []);
        useKeypress(function (key) {
            if (isEnterKey(key) && status !== 'running') {
                done(status === 'complete');
                return;
            }
        });
        var dimensions = setupDimensions();
        var MEBIBYTE = 1024 * 1024;
        var output = '\n';
        if (status === 'running' || progress.total > 0) {
            output = renderProgress(progress.downloaded, progress.total, dimensions.contentWidth, frame) + '\n';
        }
        var label = '';
        if (progress.total > 0) {
            label = (progress.downloaded / MEBIBYTE).toFixed(1) + ' / ' + (progress.total / MEBIBYTE).toFixed(1) + ' MiB';
        }
        if (status === 'complete') {
            label = 'Installation complete.';
        }
        output += '  ' + style(label.slice(0, dimensions.contentWidth), 'muted') + '\n';
        var version = '';
        if (progress.engineVersion) {
            version = 'Engine ' + progress.engineVersion;
        }
        output += '  ' + style(version, 'muted') + '\n';
        output += '  ' + style('─'.repeat(dimensions.contentWidth), 'divider') + '\n';
        var logLines: string[] = [];
        for (var message of logs) {
            var safe = message.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
            for (var offset = 0; offset < safe.length; offset += dimensions.contentWidth) {
                logLines.push(safe.slice(offset, offset + dimensions.contentWidth));
            }
        }
        var PROGRESS_ROWS = 4;
        var capacity = Math.max(1, dimensions.contentRows - PROGRESS_ROWS);
        for (var index = Math.max(0, logLines.length - capacity); index < logLines.length; index++) {
            output += '  ' + logLines[index] + '\n';
        }
        var footer = 'Ctrl+C Cancel';
        if (status !== 'running') {
            footer = 'Enter Continue · Ctrl+C Cancel';
        }
        setSetupLayout('Download ' + model.name, '', '/velora/models/' + model.id, footer);
        return useSetupScreen(output);
    });
    try {
        try {
            var complete = await prompt({});
        } finally {
            controller.abort();
            await task;
        }
        if (complete) {
            return 'complete';
        }
        return 'failed';
    } catch (error) {
        if (installed && error instanceof Error && error.name === 'ExitPromptError') {
            return 'cancelled-after-install';
        }
        throw error;
    }
}
