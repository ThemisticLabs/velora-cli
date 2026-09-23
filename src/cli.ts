#!/usr/bin/env bun

import packageInfo from '../package.json' with { type: 'json' };
import { Command } from 'commander';
import startupUpdate from './updates/startup-update.js';
import mainMenu from './menu/main-menu.js';
import licenseCommand from './commands/license-command.js';
import doctor from './commands/doctor.js';
import style from './terminal/style.js';
import header from './terminal/header.js';

if (process.stdin.isTTY && process.stdout.isTTY) {
    var startupController = new AbortController();
    var cancelStartup = function () { startupController.abort(); };
    process.once('SIGINT', cancelStartup);
    try {
        await startupUpdate(startupController.signal);
    } catch (error) {
        if (!(error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) && !startupController.signal.aborted) {
            throw error;
        }
        startupController.abort();
    } finally {
        process.removeListener('SIGINT', cancelStartup);
    }
    if (startupController.signal.aborted) {
        process.stdout.write('velora  Cancelled.\n');
        process.exit(0);
    }
}

var program = new Command();

program.configureHelp({
    styleTitle: function (text) {
        return style(text, 'strong');
    },
    styleOptionTerm: function (text) {
        return style(text, 'accent');
    },
    styleSubcommandTerm: function (text) {
        return style(text, 'accent');
    }
});
program.addHelpText('before', header());

program.name('velora');
program.description('Local anonymization for the tools you already use.');
program.version(packageInfo.version, '-v, --version', 'Show the development version');
program.helpOption('-h, --help', 'Show available commands');
program.addHelpCommand(false);
program.showSuggestionAfterError();
program.showHelpAfterError('\nRun velora --help to see available commands.');
program.addHelpText('after', '\nThe local API is not available yet.\n');

program.command('help')
    .description('Show available commands')
    .action(function () {
        program.outputHelp();
    });

program.command('setup')
    .description('Set up license access and install a model')
    .action(function () { return mainMenu(true); });

program.command('doctor')
    .description('Check your system, global command, storage and server connection')
    .action(function () {
        return doctor();
    });

var license = program.command('license')
    .description('Manage your saved license and check device capacity');
license.configureOutput({
    outputError: function (_message, write) {
        write('Invalid license command. Use velora license set or velora license status. Enter keys only in the masked prompt.\n');
    }
});
license.command('set')
    .description('Verify and securely save a license key')
    .action(function () { return licenseCommand('set'); });
license.command('status')
    .description('Show license expiry and device usage')
    .action(function () { return licenseCommand('status'); });
license.action(function () { license.outputHelp(); });

if (process.argv.length === 2) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
        await mainMenu();
    } else {
        program.outputHelp();
    }
    process.exit(process.exitCode || 0);
}

await program.parseAsync();
