import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import { RELEASE_TARGETS } from './release-targets.js';

var selected: typeof RELEASE_TARGETS[number] | undefined;
for (var target of RELEASE_TARGETS) {
    if (target.platform === process.platform && target.arch === process.arch) {
        selected = target;
        break;
    }
}
if (!selected) {
    throw new Error('No release target is configured for ' + process.platform + ' ' + process.arch + '.');
}
var directory = resolve('dist', 'release');
await mkdir(directory, { recursive: true });
var executable = resolve(directory, selected.asset);
var build = Bun.spawn([process.execPath, 'build', 'src/cli.ts', '--compile', '--target=' + selected.target,
    '--outfile', executable, '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig'], {
    stdout: 'inherit', stderr: 'inherit'
});
if (await build.exited !== 0) {
    throw new Error('The release build failed.');
}
var SMOKE_TIMEOUT_MS = 10000;
var version = Bun.spawnSync([executable, '--version'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: SMOKE_TIMEOUT_MS });
if (version.exitCode !== 0 || version.stdout.toString().trim() !== packageInfo.version || version.stderr.length !== 0) {
    throw new Error('The release executable did not report the expected version.');
}
var help = Bun.spawnSync([executable, '--help'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: SMOKE_TIMEOUT_MS });
if (help.exitCode !== 0 || !help.stdout.toString().includes('Usage: velora') || help.stderr.length !== 0) {
    throw new Error('The release executable failed its help check.');
}
process.stdout.write('Built and checked ' + selected.asset + '\n');
