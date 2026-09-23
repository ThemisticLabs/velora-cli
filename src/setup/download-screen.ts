import { createPrompt, isEnterKey, useEffect, useKeypress, useRef, useState } from '@inquirer/core';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, lstat } from 'node:fs/promises';
import DownloadError from '../downloads/download-error.js';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';
import downloadModel, { type DownloadProgress } from '../downloads/download-model.js';
import deviceFingerprint from '../system/device-fingerprint.js';
import type { LicenseModel } from '../license/license-access.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import style from '../terminal/style.js';

export default async function downloadScreen(license: string, model: LicenseModel): Promise<'complete' | 'failed' | 'cancelled-after-install'> {
    var controller = new AbortController();
    var task: Promise<void> | undefined;
    var installed = false;
    var prompt = createPrompt<boolean, Record<string, never>>(function (_config, done) {
        var [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0, message: '' });
        var [logs, setLogs] = useState<string[]>([]);
        var [status, setStatus] = useState('running');
        var [paused, setPaused] = useState(false);
        var pause = useRef(false);
        useEffect(function () {
            var active = true;
            task = (async function () {
                try {
                    var identity = await deviceFingerprint();
                    controller.signal.throwIfAborted();
                    var directory = dataDirectory();
                    for (var parent of [directory, join(directory, 'models')]) {
                        await mkdir(parent, { recursive: true, mode: 0o700 });
                        if ((await lstat(parent)).isSymbolicLink()) {
                            throw new DownloadError('Model storage directories must not be symbolic links.');
                        }
                    }
                    var installation = await downloadModel({ license, hw: identity.hw, modelId: model.id,
                        root: join(directory, 'models', model.id), signal: controller.signal,
                        waitForResume: async function () {
                            var PAUSE_POLL_MS = 100;
                            while (pause.current) {
                                await delay(PAUSE_POLL_MS, undefined, { signal: controller.signal });
                            }
                        },
                        onProgress: function (update) {
                            if (!active) {
                                return;
                            }
                            setProgress(update);
                            if (update.message) {
                                var MAX_LOG_LINES = 100;
                                setLogs(function (previous) {
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
            if (key.name === 'space' && status === 'running') {
                pause.current = !pause.current;
                setPaused(pause.current);
            }
        });
        var dimensions = setupDimensions();
        var PERCENT_LABEL_WIDTH = 6;
        var MEBIBYTE = 1024 * 1024;
        var width = Math.max(1, dimensions.contentWidth - PERCENT_LABEL_WIDTH);
        var output = '\n';
        if (status === 'running') {
            output = '  ' + style('Reading model catalog…', 'muted') + '\n';
        }
        if (progress.total > 0) {
            var fraction = progress.downloaded / progress.total;
            var filled = Math.floor(fraction * width);
            output = '  ' + style('█'.repeat(filled), 'accent') + style('░'.repeat(width - filled), 'divider');
            output += '  ' + String(Math.floor(fraction * 100)).padStart(3) + '%\n';
        }
        var label = '';
        if (progress.total > 0) {
            label = (progress.downloaded / MEBIBYTE).toFixed(1) + ' / ' + (progress.total / MEBIBYTE).toFixed(1) + ' MiB';
        }
        if (paused) {
            label = 'Paused after current request';
        }
        if (status === 'complete') {
            label = 'Download complete.';
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
        var footer = 'Space Pause / resume · Ctrl+C Cancel';
        if (status !== 'running') {
            footer = 'Enter Continue · Ctrl+C Cancel';
        }
        setSetupLayout('Download ' + model.name, '', footer, '/models/' + model.id);
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
