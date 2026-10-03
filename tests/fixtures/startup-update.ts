import { mock } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

var directory = process.env.VELORA_TEST_DIRECTORY!;
mock.module('../../src/system/data-directory.js', function () {
    return { default: function () { return directory; } };
});
globalThis.fetch = Object.assign(async function () {
    appendFileSync(join(directory, 'requests'), 'request\n');
    return new Response(null, { status: 404 });
}, { preconnect: function () {} });
mock.module('../../src/menu/main-menu.js', function () {
    return { default: async function () { process.stdout.write('Fixture menu opened.\n'); } };
});
process.argv = [process.execPath, 'velora'];
await import('../../src/cli.js');
