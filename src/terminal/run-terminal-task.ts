import { createPrompt, useEffect, useState } from '@inquirer/core';
import type { EngineProgress } from '../engine/bootstrap-engine.js';
import renderProgress from './render-progress.js';
import setupDimensions from './setup-dimensions.js';
import useSetupScreen from './use-setup-screen.js';

export default async function runTerminalTask<T>(operation: (signal: AbortSignal, onProgress: (progress: EngineProgress) => void) => Promise<T>): Promise<T> {
    var controller = new AbortController();
    var task: Promise<T> | undefined;
    var prompt = createPrompt<{ value: T } | { error: unknown }, Record<string, never>>(function (_config, done) {
        var [progress, setProgress] = useState<EngineProgress | undefined>();
        var [frame, setFrame] = useState(0);
        useEffect(function () {
            var active = true;
            var FRAME_INTERVAL_MS = 100;
            var timer = setInterval(function () { setFrame(function (value) { return value + 1; }); }, FRAME_INTERVAL_MS);
            task = operation(controller.signal, function (update) {
                if (active) {
                    setProgress(function (previous) {
                        return { ...update, message: update.message || previous?.message || '' };
                    });
                }
            });
            void task.then(function (value) {
                if (active) {
                    done({ value });
                }
            }).catch(function (error: unknown) {
                if (active) {
                    done({ error });
                }
            });
            return function () {
                clearInterval(timer);
                active = false;
                controller.abort();
            };
        }, []);
        var output = '';
        if (progress) {
            var width = setupDimensions().contentWidth;
            output = renderProgress(progress.downloaded, progress.total, width, frame);
            output += '\n\n  ' + progress.message.slice(0, width);
        }
        return useSetupScreen(output);
    });
    try {
        var result = await prompt({});
        if ('error' in result) {
            throw result.error;
        }
        return result.value;
    } finally {
        controller.abort();
        try {
            await task;
        } catch {
            // Native credential writes must settle before the screen closes.
        }
    }
}
