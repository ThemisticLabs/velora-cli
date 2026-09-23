import { mock } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { DownloadOptions } from '../../src/downloads/download-model.js';

var scenario = process.argv[2];
var root = process.env.VELORA_TEST_DIRECTORY!;
var source = fileURLToPath(new URL('../../src/', import.meta.url));
mock.module(source + 'system/data-directory.ts', function () {
    return { default: function () { return root; } };
});
mock.module(source + 'system/device-fingerprint.ts', function () {
    return { default: async function () { return { hw: 'a'.repeat(64) }; } };
});
mock.module(source + 'downloads/download-model.ts', function () {
    return { default: async function (options: DownloadOptions) {
        if (scenario === 'disk full') {
            var error = new Error('Private filesystem diagnostic') as NodeJS.ErrnoException;
            error.code = 'ENOSPC';
            throw error;
        }
        if (scenario === 'error') {
            throw new Error('Unexpected backend error containing TEST-LICENSE-KEY');
        }
        if (scenario === 'cancel-during-finalize') {
            options.onProgress({ downloaded: 10, total: 10, message: 'Finishing fixture installation.' });
            await delay(150);
            return { cleanupRequired: scenario === 'cleanup failure' };
        }
        if (scenario === 'cancel-before-install') {
            options.onProgress({ downloaded: 0, total: 10, message: 'Waiting for fixture transfer.' });
            await delay(10000, undefined, { signal: options.signal });
        }
        return { cleanupRequired: scenario === 'cleanup failure' };
    } };
});
var downloadScreen = (await import('../../src/setup/download-screen.js')).default;
process.stdout.write('\u001b[?1049h');
try {
    var outcome = await downloadScreen('TEST-LICENSE-KEY', {
        id: 'skira7alpha', name: 'Skira 7 Alpha', description: '', strengths: '', limitations: '', canDownload: true, downloadReason: null
    });
    process.stdout.write('\nOutcome: ' + outcome + '\n');
} catch (error) {
    if (!(error instanceof Error) || error.name !== 'ExitPromptError') {
        throw error;
    }
    process.stdout.write('\nOutcome: cancelled\n');
} finally {
    process.stdout.write('\u001b[?25h\u001b[?1049l');
}
