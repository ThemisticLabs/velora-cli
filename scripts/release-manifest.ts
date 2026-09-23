import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import { RELEASE_TARGETS } from './release-targets.js';

var directory = resolve(process.argv[2] || 'dist/release');
var expected = new Set<string>();
for (var target of RELEASE_TARGETS) {
    expected.add(target.asset);
}
for (var name of await readdir(directory)) {
    if (!expected.has(name) && name !== 'release.json' && name !== 'SHA256SUMS') {
        throw new Error('Unexpected release file: ' + name);
    }
}
var assets = [];
var checksums = '';
for (var target of RELEASE_TARGETS) {
    var path = join(directory, target.asset);
    var file = await lstat(path);
    if (!file.isFile() || file.size === 0) {
        throw new Error('Release asset must be a non-empty regular file: ' + target.asset);
    }
    var hash = createHash('sha256');
    for await (var chunk of createReadStream(path)) {
        hash.update(chunk);
    }
    var sha256 = hash.digest('hex');
    assets.push({ name: target.asset, platform: target.platform, arch: target.arch, size: file.size, sha256 });
    checksums += sha256 + '  ' + target.asset + '\n';
}
var temporary = await mkdtemp(join(directory, '.metadata-'));
try {
    await writeFile(join(temporary, 'release.json'), JSON.stringify({ schemaVersion: 1, version: packageInfo.version, assets }, null, 2) + '\n');
    await writeFile(join(temporary, 'SHA256SUMS'), checksums);
    await rename(join(temporary, 'release.json'), join(directory, 'release.json'));
    await rename(join(temporary, 'SHA256SUMS'), join(directory, 'SHA256SUMS'));
} finally {
    await rm(temporary, { recursive: true, force: true });
}
process.stdout.write('Verified ' + assets.length + ' release assets and wrote checksums.\n');
