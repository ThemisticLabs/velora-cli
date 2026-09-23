import { appendFile } from 'node:fs/promises';
import packageInfo from '../package.json' with { type: 'json' };
import { RELEASE_TARGETS } from './release-targets.js';

var version = packageInfo.version;
if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error('package.json must contain a release version such as 1.2.3 or 1.2.3-rc.1.');
}
var separator = version.indexOf('-');
if (separator !== -1) {
    for (var identifier of version.slice(separator + 1).split('.')) {
        if (/^0[0-9]+$/.test(identifier)) {
            throw new Error('Numeric prerelease identifiers must not have leading zeroes.');
        }
    }
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== 'v' + version) {
    throw new Error('The release tag must match package.json: v' + version);
}
var output = 'matrix=' + JSON.stringify({ include: RELEASE_TARGETS }) + '\n';
output += 'prerelease=' + (separator !== -1) + '\n';
if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, output);
} else {
    process.stdout.write(output);
}
