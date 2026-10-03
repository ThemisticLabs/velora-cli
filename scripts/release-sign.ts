import { sign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { RELEASE_PUBLIC_KEY } from '../src/updates/release-public-key.js';

var privateKey = process.env.VELORA_RELEASE_SIGNING_KEY;
if (!privateKey) { throw new Error('VELORA_RELEASE_SIGNING_KEY is required to sign a release.'); }
var key = createPrivateKey(privateKey);
if (createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== RELEASE_PUBLIC_KEY) {
    throw new Error('The signing key does not match the trusted velora release key.');
}
var directory = resolve(process.argv[2] || 'dist/release');
var manifest = await readFile(join(directory, 'release.json'));
await writeFile(join(directory, 'release.sig'), sign(null, manifest, key), { flag: 'wx' });
process.stdout.write('Signed release metadata.\n');
