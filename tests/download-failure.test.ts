import { test, expect } from 'bun:test';
import downloadFailure from '../src/downloads/download-failure.js';
import DownloadError from '../src/downloads/download-error.js';

test.each(['ENOSPC', 'EACCES', 'EPERM'])('download and update storage failures hide private diagnostics: %s', function (code) {
    var message = downloadFailure(Object.assign(new Error('PRIVATE-LICENSE diagnostic'), { code }), 'Try again.');
    expect(message).not.toContain('PRIVATE-LICENSE');
    if (code === 'ENOSPC') { expect(message).toContain('Free disk space'); return; }
    expect(message).toContain('Check its permissions');
});

test('download failures preserve safe reasons and reject terminal control sequences', function () {
    expect(downloadFailure(new DownloadError('Invalid signature.\u001b[2J Try again.'), 'Try again.')).not.toContain('\u001b');
    expect(downloadFailure(new Error('PRIVATE-LICENSE diagnostic'), 'Try again.')).toBe('Try again.');
});
