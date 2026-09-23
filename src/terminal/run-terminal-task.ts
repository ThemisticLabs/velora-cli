import { createPrompt, useEffect } from '@inquirer/core';
import useSetupScreen from './use-setup-screen.js';

export default async function runTerminalTask<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    var controller = new AbortController();
    var task: Promise<T> | undefined;
    var prompt = createPrompt<{ value: T } | { error: unknown }, Record<string, never>>(function (_config, done) {
        useEffect(function () {
            var active = true;
            task = operation(controller.signal);
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
                active = false;
                controller.abort();
            };
        }, []);
        return useSetupScreen('');
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
