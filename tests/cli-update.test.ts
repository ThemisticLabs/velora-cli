import { test, expect } from 'bun:test';
import cliUpdate from '../src/updates/cli-update.js';
import header from '../src/terminal/header.js';

test.each(['newer', 'same', 'older', 'prerelease', 'draft', 'missing', 'invalid', 'offline', 'rate limit', 'oversized'])('CLI update: %s', async function (scenario) {
    var version = '0.2.0';
    if (scenario === 'same') {
        version = '0.1.0';
    }
    if (scenario === 'older') {
        version = '0.0.9';
    }
    if (scenario === 'invalid') {
        version = '0.2.0\u001b[2J';
    }
    var transport = async function (url: unknown, options?: RequestInit) {
        expect(url).toBe('https://api.github.com/repos/ThemisticLabs/velora-cli/releases/latest');
        expect(options?.redirect).toBe('error');
        expect(options?.headers).not.toHaveProperty('Authorization');
        expect(options?.body).toBeUndefined();
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        if (scenario === 'offline') {
            throw new Error('offline');
        }
        if (scenario === 'missing') {
            return new Response('', { status: 404 });
        }
        if (scenario === 'rate limit') {
            return new Response('', { status: 403 });
        }
        if (scenario === 'oversized') {
            return new Response(' '.repeat(128 * 1024 + 1));
        }
        return Response.json({ tag_name: 'v' + version, draft: scenario === 'draft', prerelease: scenario === 'prerelease' });
    };
    var result = await cliUpdate(transport as typeof fetch, '0.1.0');
    if (scenario === 'newer') {
        expect(result).toBe('0.2.0');
        expect(header(true)).toContain('Update available: 0.2.0');
    } else {
        expect(result).toBeNull();
        expect(header(true)).not.toContain('Update available');
    }
});
