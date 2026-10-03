#!/usr/bin/env bun

import selfTest from './updates/self-test.js';
import applyCliUpdate from './updates/apply-cli-update.js';
import recoverCliUpdate from './updates/recover-cli-update.js';
import packageInfo from '../package.json' with { type: 'json' };
import { Command } from 'commander';
import startupUpdate from './updates/startup-update.js';
import mainMenu from './menu/main-menu.js';
import licenseCommand from './commands/license-command.js';
import doctor from './commands/doctor.js';
import style from './terminal/style.js';
import header from './terminal/header.js';
import serviceCommand from './commands/service-command.js';
import serviceWorker from './service/service-worker.js';

if (process.argv[2] === '--service-worker' && process.argv[3]) {
    try {
        await serviceWorker(process.argv[3]);
    } catch {
        process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
}
if (process.argv[2] === '--self-test') {
    try { await selfTest(process.argv[3]); }
    catch { process.stderr.write('velora self-test failed. Saved data was not changed.\n'); process.exit(1); }
    process.exit(0);
}
if (process.argv[2] === '--finish-update' && process.argv[3]) {
    try { await applyCliUpdate(process.argv[3], process.argv[4] === '--restore'); }
    catch { process.exit(1); }
    process.exit(0);
}
var interactiveMenuStart = process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === 'setup';
if (interactiveMenuStart && process.stdin.isTTY && process.stdout.isTTY) {
    try {
        var recovery = await recoverCliUpdate();
        if (recovery.message) { process.stdout.write(recovery.message + '\n'); }
        if (recovery.stop) { process.exit(0); }
    } catch {
        process.stdout.write('Could not read update recovery information. Keep any update backups and check executable directory permissions.\n');
        process.exit(0);
    }
}

if (interactiveMenuStart && process.stdin.isTTY && process.stdout.isTTY) {
    var startupController = new AbortController();
    var cancelStartup = function () { startupController.abort(); };
    process.once('SIGINT', cancelStartup);
    try {
        if (await startupUpdate(startupController.signal)) {
            process.stdout.write('velora update prepared. Start velora again in a moment.\n');
            process.exit(0);
        }
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
    .description('Check your system, global command, storage, local API port, server connection and saved license')
    .action(function () {
        return doctor();
    });

var serve = program.command('serve')
    .description('Control the independent local service; the HTTP API is not connected yet');
serve.command('start')
    .description('Start the independent service')
    .requiredOption('--headless', 'Keep the service running after this terminal closes')
    .action(function () { return serviceCommand('start'); });
serve.command('status')
    .description('Show whether the local service is running')
    .action(function () { return serviceCommand('status'); });
serve.command('stop')
    .description('Stop the independent local service')
    .action(function () { return serviceCommand('stop'); });
serve.action(function () { serve.outputHelp(); });

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
