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
process.argv = [process.execPath, 'velora', '--help'];
await import('../../src/cli.js');
