import setupDimensions, { MIN_COLUMNS, MIN_ROWS } from '../terminal/setup-dimensions.js';
import select from './select-option.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import { createPrompt, useEffect } from '@inquirer/core';
import manageLicense from '../license/manage-license.js';
import licenseStore from '../license/license-store.js';
import modelList from './model-list.js';
import licenseInput from './license-input.js';
import style from '../terminal/style.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function setup(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error('Setup needs an interactive terminal. Run velora setup in your terminal.');
        process.exitCode = 1;
        return;
    }

    if (setupDimensions().tooSmall) {
        console.error('Setup needs a terminal at least ' + MIN_COLUMNS + ' columns wide and ' + MIN_ROWS + ' rows tall. Enlarge it and run velora setup again.');
        process.exitCode = 1;
        return;
    }

    var ENTER_ALTERNATE_SCREEN = '\u001b[?1049h';
    var LEAVE_ALTERNATE_SCREEN = '\u001b[?1049l';
    var SHOW_CURSOR = '\u001b[?25h';
    var summary = 'Setup did not finish. Run velora setup again.';
    var licenseTask: ReturnType<typeof manageLicense> | undefined;
    process.stdout.write(ENTER_ALTERNATE_SCREEN);

    try {
        while (true) {
            setSetupLayout('Choose your model access.', 'Use a license or explore the upcoming public model.', '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel');
            var choice = await select({
                message: 'How would you like to begin?',
                choices: [
                    { name: 'Use a license', value: 'license', description: 'Access licensed models with your Themistic key.' },
                    { name: 'Use a public model', value: 'public', description: 'Start without a license. Public Veyra1 is coming later.' }
                ]
            });

            if (choice === 'public') {
                setSetupLayout('Public models will be available soon.', 'Veyra1 is coming. You can use a license in the meantime.', 'Enter Go back  ·  Ctrl+C Cancel');
                await select({
                    message: 'Next step',
                    choices: [{ name: 'Go back', value: 'back' }]
                });
                continue;
            }

            while (true) {
                try {
                    var savedLicense = await licenseStore({ operation: 'read' });
                } catch (error) {
                    var message = 'Could not read the system credential store.';
                    if (error instanceof Error) {
                        message = error.message;
                    }
                    setSetupLayout('Saved license unavailable.', message, '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/licenses');
                    var storageAction = await select({ message: 'Next step', choices: [
                        { name: 'Enter a license', value: 'enter' }, { name: 'Go back', value: 'back' }
                    ] });
                    if (storageAction === 'back') {
                        break;
                    }
                    savedLicense = null;
                }
                var useSaved = false;
                if (savedLicense) {
                    setSetupLayout('Your saved license.', 'The key is stored in the system credential store.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/licenses');
                    var licenseChoice = await select({ message: 'How would you like to continue?', choices: [
                        { name: 'Use saved license', value: 'saved' },
                        { name: 'Use a different license', value: 'change' },
                        { name: 'Go back', value: 'back' }
                    ] });
                    if (licenseChoice === 'back') {
                        break;
                    }
                    useSaved = licenseChoice === 'saved';
                }
                var license = savedLicense || '';
                if (!useSaved) {
                    setSetupLayout('Enter your license.', 'The key is verified, then saved in the system credential store.', 'Enter Continue · Ctrl+C Cancel', '/licenses');
                    license = await licenseInput({});
                }
                setSetupLayout('Checking your license.', 'Looking up your models.', 'Ctrl+C Cancel', '/licenses');
                var requestController = new AbortController();
                var check = createPrompt<Awaited<ReturnType<typeof manageLicense>>, Record<string, never>>(function (_config, done) {
                    useEffect(function () {
                        var active = true;
                        if (useSaved) {
                            licenseTask = manageLicense({ operation: 'status' }, requestController.signal);
                        } else {
                            licenseTask = manageLicense({ operation: 'set', license }, requestController.signal);
                        }
                        void licenseTask.then(function (result) {
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
                    return useSetupScreen('');
                });
                var result = await check({});
                if (!result.ok) {
                    setSetupLayout('License check unsuccessful.', result.message, '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel', '/licenses');
                    var action = await select({ message: 'Next step', choices: [
                        { name: 'Try again', value: 'retry' }, { name: 'Go back', value: 'back' }
                    ] });
                    if (action === 'retry') {
                        continue;
                    }
                    break;
                }
                var expires = new Date(result.expiresAt).toISOString().slice(0, 10);
                var next = await modelList(result.models, 'Expires ' + expires + ' · Devices ' + result.registeredDevices + '/' + result.maxDevices);
                if (next === 'finish') {
                    summary = 'License ready.';
                    return;
                }
                break;
            }
        }

    } catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
            summary = 'Setup cancelled.';
            process.exitCode = 0;
            return;
        }
        summary = 'Setup failed unexpectedly.';
        throw error;
    } finally {
        if (licenseTask) {
            try {
                var settled = await licenseTask;
                if (settled.ok && settled.saved && summary === 'Setup cancelled.') {
                    summary = 'Setup cancelled. The verified license was saved.';
                }
            } catch {
                // Wait for cancellation before restoring the terminal.
            }
        }
        process.stdout.write(SHOW_CURSOR + LEAVE_ALTERNATE_SCREEN);
        process.stdout.write(style('velora', 'accent') + '  ' + summary + '\n');
    }
}
