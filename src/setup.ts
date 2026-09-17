import select from '@inquirer/select';
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
    var onResize = function () {
        controller.abort();
    };
    var theme = {
        prefix: { idle: style('›', 'accent'), done: style('›', 'accent') },
        style: {
            answer: function (text: string) {
                return style(text, 'accent');
            },
            highlight: function (text: string) {
                return style(text, 'accent');
            },
            message: function (text: string) {
                return style(text, 'strong');
            },
            description: function (text: string) {
                return style(text, 'muted');
            },
            error: function (text: string) {
                return text;
            },
            help: function (text: string) {
                return style(text, 'muted');
            },
            keysHelpTip: function () {
                return undefined;
            }
        }
    };

    var summary = 'Setup did not finish. Run velora setup again.';
    process.stdout.write(ENTER_ALTERNATE_SCREEN);
    process.stdout.on('resize', onResize);

    try {
        while (true) {
            renderSetup('Choose your model access.', 'Use a license or explore the upcoming public model.', '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel');
            var choice = await select({
                message: 'How would you like to begin?',
                choices: [
                    { name: 'Use a license', value: 'license', description: 'Access licensed models with your Themistic key.' },
                    { name: 'Use a public model', value: 'public', description: 'Start without a license. Public Veyra1 is coming later.' }
                ],
                loop: false,
                theme: theme
            }, { signal: controller.signal });

            if (choice === 'license') {
                break;
            }

            renderSetup('Public models will be available soon.', 'Veyra1 is coming. You can use a license in the meantime.', 'Enter Go back  ·  Ctrl+C Cancel');
            await select({
                message: 'Next step',
                choices: [{ name: 'Go back', value: 'back' }],
                theme: theme
            }, { signal: controller.signal });
        }

        renderSetup('Enter your license.', 'Preview only. Your key will not be sent or saved.', 'Enter Continue  ·  Ctrl+C Cancel');
        await licenseInput({}, { signal: controller.signal });
        summary = 'License entry complete. Verification is not connected yet. No key was saved and no device was activated.';
    } catch (error) {
        if (controller.signal.aborted) {
            summary = 'Terminal resized. Run velora setup again to use the new size.';
            process.exitCode = 1;
            return;
        }
        if (error instanceof Error && error.name === 'ExitPromptError') {
            summary = 'Setup cancelled.';
            process.exitCode = 130;
            return;
        }
        summary = 'Setup failed unexpectedly.';
        throw error;
    } finally {
        process.stdout.off('resize', onResize);
        process.stdout.write(SHOW_CURSOR + LEAVE_ALTERNATE_SCREEN);
        process.stdout.write(style('velora', 'accent') + '  ' + summary + '\n');
    }
}
