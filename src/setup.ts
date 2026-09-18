import select from './select-option.js';
import useSetupScreen from './use-setup-screen.js';
import { createPrompt, useEffect } from '@inquirer/core';
import licenseAccess from './license-access.js';
import modelList from './model-list.js';
import licenseInput from './license-input.js';
import style from './style.js';
import renderSetup from './render-setup.js';

export default async function setup(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error('Setup needs an interactive terminal. Run velora setup in your terminal.');
        process.exitCode = 1;
        return;
    }

    var MIN_COLUMNS = 60;
    var MIN_ROWS = 20;
    if (process.stdout.columns < MIN_COLUMNS || process.stdout.rows < MIN_ROWS) {
        console.error('Setup needs a terminal at least 60 columns wide and 20 rows tall. Enlarge it and run velora setup again.');
        process.exitCode = 1;
        return;
    }

    var ENTER_ALTERNATE_SCREEN = '\u001b[?1049h';
    var LEAVE_ALTERNATE_SCREEN = '\u001b[?1049l';
    var SHOW_CURSOR = '\u001b[?25h';
    var controller = new AbortController();
    var summary = 'Setup did not finish. Run velora setup again.';
    process.stdout.write(ENTER_ALTERNATE_SCREEN);

    try {
        while (true) {
            renderSetup('Choose your model access.', 'Use a license or explore the upcoming public model.', '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel');
            var choice = await select({
                message: 'How would you like to begin?',
                choices: [
                    { name: 'Use a license', value: 'license', description: 'Access licensed models with your Themistic key.' },
                    { name: 'Use a public model', value: 'public', description: 'Start without a license. Public Veyra1 is coming later.' }
                ],
                loop: false
            }, { signal: controller.signal });

            if (choice === 'license') {
                while (true) {
                    renderSetup('Enter your license.', 'Your key is sent to Themistic to check access.', 'Enter Continue  ·  Ctrl+C Cancel', '/licenses');
                    var license = await licenseInput({}, { signal: controller.signal });
                    renderSetup('Checking your license.', 'No device will be activated.', 'Ctrl+C Cancel', '/licenses');
                    var requestController = new AbortController();
                    var check = createPrompt<Awaited<ReturnType<typeof licenseAccess>>, Record<string, never>>(function (_config, done) {
                        useEffect(function () {
                            var active = true;
                            void licenseAccess(license, AbortSignal.any([controller.signal, requestController.signal])).then(function (result) {
                                if (active) {
                                    done(result);
                                }
                            }).catch(function () {
                                if (active) {
                                    done({ ok: false, message: 'The license check was interrupted.' });
                                }
                            });
                            return function () {
                                active = false;
                                requestController.abort();
                            };
                        }, []);
                        return useSetupScreen(style('Checking license access…', 'muted'));
                    });
                    var result = await check({}, { signal: controller.signal });
                    license = '';
                    if (!result.ok) {
                        renderSetup('License check unsuccessful.', result.message, '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel', '/licenses');
                        var action = await select({ message: 'Next step', choices: [
                            { name: 'Try again', value: 'retry' }, { name: 'Go back', value: 'back' }
                        ] }, { signal: controller.signal });
                        if (action === 'retry') {
                            continue;
                        }
                        break;
                    }
                    var expires = new Date(result.expiresAt).toISOString().slice(0, 10);
                    var next = await modelList(result.models, 'Expires ' + expires + ' · Devices ' + result.registeredDevices + '/' + result.maxDevices, controller.signal);
                    if (next === 'finish') {
                        summary = 'License verified. No key saved or device activated.';
                        return;
                    }
                    break;
                }
                continue;
            }

            renderSetup('Public models will be available soon.', 'Veyra1 is coming. You can use a license in the meantime.', 'Enter Go back  ·  Ctrl+C Cancel');
            await select({
                message: 'Next step',
                choices: [{ name: 'Go back', value: 'back' }]
            }, { signal: controller.signal });
        }

    } catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
            summary = 'Setup cancelled.';
            process.exitCode = 130;
            return;
        }
        summary = 'Setup failed unexpectedly.';
        throw error;
    } finally {
        process.stdout.write(SHOW_CURSOR + LEAVE_ALTERNATE_SCREEN);
        process.stdout.write(style('velora', 'accent') + '  ' + summary + '\n');
    }
}
