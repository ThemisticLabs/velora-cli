#!/usr/bin/env bun

import packageInfo from '../package.json' with { type: 'json' };
import { Command } from 'commander';
import setup from './setup/setup.js';
import doctor from './commands/doctor.js';
import style from './terminal/style.js';
import header from './terminal/header.js';

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
program.addHelpText('after', '\n' + style('Try it', 'strong') + '\n  ' + style('velora --version', 'accent') + '  Show the current version\n\n' + style('In development', 'strong') + '\n  License checks and model browsing are available. Downloads and the local API are not available yet.\n');

program.command('help')
    .description('Show available commands')
    .action(function () {
        program.outputHelp();
    });

program.command('setup')
    .description('Choose license access or a public model (preview)')
    .action(setup);

program.command('doctor')
    .description('Check your system, global command, storage and server connection')
    .action(function () {
        return doctor();
    });

if (process.argv.length === 2) {
    program.outputHelp();
    process.exit(0);
}

await program.parseAsync();
