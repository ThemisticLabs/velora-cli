import { mock } from 'bun:test';

var scenario = process.argv[2];
process.argv.splice(2, 1);
mock.module('../../src/updates/recover-cli-update.js', function () {
    return { default: async function () {
        process.stdout.write('Fixture recovery called.\n');
        return { stop: scenario === 'recovery', message: '' };
    } };
});
mock.module('../../src/updates/startup-update.js', function () {
    return { default: async function () {
        process.stdout.write('Fixture startup called.\n');
        return scenario === 'update';
    } };
});
mock.module('../../src/menu/main-menu.js', function () {
    return { default: async function () { process.stdout.write('Fixture menu called.\n'); } };
});
mock.module('../../src/commands/doctor.js', function () {
    return { default: async function () { process.stdout.write('Fixture doctor called.\n'); } };
});
mock.module('../../src/commands/license-command.js', function () {
    return { default: async function () { process.stdout.write('Fixture license called.\n'); } };
});
await import('../../src/cli.js');
