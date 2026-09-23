import { semver } from 'bun';
import packageInfo from '../../package.json' with { type: 'json' };

export var updateCheckStatus: 'unavailable' | 'current' | 'available' = 'unavailable';

export var availableVersion: string | null = null;

export default async function cliUpdate(transport = fetch, currentVersion = packageInfo.version, signal?: AbortSignal): Promise<string | null> {
    var CHECK_TIMEOUT_MS = 1500;
    var MAX_RESPONSE_BYTES = 128 * 1024;
    availableVersion = null;
    updateCheckStatus = 'unavailable';
    var requestSignal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    if (signal) {
        requestSignal = AbortSignal.any([signal, requestSignal]);
    }
    try {
        var response = await transport('https://api.github.com/repos/ThemisticLabs/velora-cli/releases/latest', {
            redirect: 'error', signal: requestSignal,
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'velora/' + currentVersion }
        });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            return null;
        }
        var reader = response.body.getReader();
        var chunks: Uint8Array[] = [];
        var size = 0;
        try {
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                size += chunk.value.length;
                if (size > MAX_RESPONSE_BYTES) {
                    await reader.cancel();
                    return null;
                }
                chunks.push(chunk.value);
            }
        } finally {
            reader.releaseLock();
        }
        var release: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof release !== 'object' || release === null || !('tag_name' in release) ||
            typeof release.tag_name !== 'string' || !('draft' in release) || release.draft !== false ||
            !('prerelease' in release) || release.prerelease !== false) {
            return null;
        }
        var tag = release.tag_name;
        if (!/^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag) || tag.length > 32) {
            return null;
        }
        var version = tag.replace(/^v/, '');
        updateCheckStatus = 'current';
        if (semver.order(version, currentVersion) !== 1) {
            return null;
        }
        availableVersion = version;
        updateCheckStatus = 'available';
        return version;
    } catch {
        return null;
    }
}
