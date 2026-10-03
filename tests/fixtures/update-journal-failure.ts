import { mock } from 'bun:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import syncDirectory from '../../src/system/sync-directory.js';

var executable = process.argv[2]!;
var directory = process.argv[3]!;
var binary = process.argv[4]!;
var failed = false;
var originalSync = syncDirectory;
mock.module('../../src/system/sync-directory.js', function () {
    return { default: async function (path: string) {
        await originalSync(path);
        if (failed) { return; }
        try {
            await access(executable + '.update.json');
        } catch {
            return;
        }
        failed = true;
        throw new Error('Injected journal directory sync failure');
    } };
});
var install = (await import('../../src/updates/install-cli-update.js')).default;
var keys = generateKeyPairSync('ed25519');
var bytes = await readFile(binary);
var name = 'velora-' + process.platform + '-' + process.arch;
if (process.platform === 'win32') {
    name = 'velora-windows-' + process.arch + '.exe';
}
var manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, version: '1.0.0', assets: [{ name, platform: process.platform, arch: process.arch, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }));
var signature = sign(null, manifest, keys.privateKey);
try {
    await install('1.0.0', new AbortController().signal, undefined, {
        executable, directory, currentVersion: '0.0.1',
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        transport: async function (input) {
            var url = String(input);
            if (url.endsWith('release.json')) { return new Response(manifest); }
            if (url.endsWith('release.sig')) { return new Response(signature); }
            return new Response(bytes);
        } as typeof fetch,
        launch: async function () { throw new Error('Unexpected helper launch'); }
    });
    throw new Error('Expected injected failure');
} catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Injected journal')) { throw error; }
}
var names = await readdir(directory);
if (names.length !== 2 || !names.includes('installed') || !names.includes('user-data')) {
    throw new Error('Failed preparation left inconsistent update files');
}
console.log('clean');
