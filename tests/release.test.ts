import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { RELEASE_TARGETS } from '../scripts/release-targets.js';

var PLAN = fileURLToPath(new URL('../scripts/release-plan.ts', import.meta.url));
var MANIFEST = fileURLToPath(new URL('../scripts/release-manifest.ts', import.meta.url));

test.each(['branch', 'matching tag', 'wrong tag'])('release plan: %s', async function (scenario) {
    var root = await mkdtemp(join(tmpdir(), 'velora-release-plan-'));
    var output = join(root, 'outputs');
    var refType = 'tag';
    var refName = 'v' + packageInfo.version;
    if (scenario === 'branch') {
        refType = 'branch';
        refName = 'main';
    }
    if (scenario === 'wrong tag') {
        refName = 'v99.0.0';
    }
    try {
        var run = Bun.spawnSync([process.execPath, PLAN], { env: { ...process.env, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: refName, GITHUB_OUTPUT: output } });
        if (scenario === 'wrong tag') {
            expect(run.exitCode).not.toBe(0);
            expect(run.stderr.toString()).toContain('must match package.json');
            expect(await readdir(root)).toEqual([]);
            return;
        }
        expect(run.exitCode).toBe(0);
        var result = await readFile(output, 'utf8');
        expect(result).toContain('prerelease=' + packageInfo.version.includes('-'));
        expect(JSON.parse(result.split('\n')[0]!.slice('matrix='.length))).toEqual({ include: RELEASE_TARGETS });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test.each(['complete', 'missing', 'empty', 'unexpected'])('release manifest: %s', async function (scenario) {
    var root = await mkdtemp(join(tmpdir(), 'velora-release-manifest-'));
    var bytes = Buffer.from('Synthetic executable bytes, never run.');
    var hash = createHash('sha256').update(bytes).digest('hex');
    try {
        for (var target of RELEASE_TARGETS) {
            await writeFile(join(root, target.asset), bytes);
        }
        if (scenario === 'missing') {
            await rm(join(root, RELEASE_TARGETS[0]!.asset));
        }
        if (scenario === 'empty') {
            await writeFile(join(root, RELEASE_TARGETS[0]!.asset), '');
        }
        if (scenario === 'unexpected') {
            await writeFile(join(root, 'unrelated.txt'), 'Do not publish.');
        }
        var run = Bun.spawnSync([process.execPath, MANIFEST, root]);
        if (scenario !== 'complete') {
            expect(run.exitCode).not.toBe(0);
            expect(await readdir(root)).not.toContain('release.json');
            expect(await readdir(root)).not.toContain('SHA256SUMS');
            return;
        }
        expect(run.exitCode).toBe(0);
        var manifest = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
        expect(manifest.version).toBe(packageInfo.version);
        expect(manifest.assets.length).toBe(RELEASE_TARGETS.length);
        var checksums = '';
        for (var index = 0; index < RELEASE_TARGETS.length; index++) {
            var target = RELEASE_TARGETS[index]!;
            expect(manifest.assets[index]).toEqual({ name: target.asset, platform: target.platform, arch: target.arch, size: bytes.length, sha256: hash });
            checksums += hash + '  ' + target.asset + '\n';
        }
        expect(await readFile(join(root, 'SHA256SUMS'), 'utf8')).toBe(checksums);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test.skipIf(process.platform === 'win32')('release metadata cannot overwrite a linked external file', async function () {
    var { symlink } = await import('node:fs/promises');
    var root = await mkdtemp(join(tmpdir(), 'velora-release-links-'));
    var outside = await mkdtemp(join(tmpdir(), 'velora-release-outside-'));
    var target = join(outside, 'keep.txt');
    try {
        await writeFile(target, 'Keep this file.');
        for (var asset of RELEASE_TARGETS) {
            await writeFile(join(root, asset.asset), 'Synthetic executable');
        }
        await symlink(target, join(root, 'release.json'));
        await symlink(target, join(root, 'SHA256SUMS'));
        Bun.spawnSync([process.execPath, MANIFEST, root]);
        expect(await readFile(target, 'utf8')).toBe('Keep this file.');
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});
