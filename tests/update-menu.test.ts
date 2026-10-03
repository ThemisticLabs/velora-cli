import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };

test.skipIf(process.platform === 'win32').each(['cli', 'engine', 'cancel', 'no-model', 'current-cli', 'current-engine', 'offline-cli', 'broken-engine', 'cached', 'install-engine', 'install-error', 'install-cli', 'cli-install-error'])('update versions terminal: %s', async function (scenario) {
    var output = '';
    var coloredOutput = '';
    var phase = 0;
    var decoder = new TextDecoder();
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/update-menu.ts', import.meta.url)), scenario], {
        env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: undefined, FORCE_COLOR: '1' },
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            var raw = decoder.decode(bytes, { stream: true });
            coloredOutput += raw;
            var frame = stripVTControlCharacters(raw);
            output = stripVTControlCharacters(coloredOutput);
            if (scenario === 'install-cli' || scenario === 'cli-install-error') {
                if (phase === 0 && frame.includes('2.0.0')) { phase++; terminal.write('\r'); }
                else if (phase === 1 && frame.includes('Update velora to')) { phase++; terminal.write('\r'); }
                else if (phase === 2 && frame.includes('velora update unsuccessful.')) { phase++; terminal.write('\u001b'); }
                else if (phase === 3 && frame.includes('Settings / Updates')) { phase++; terminal.write('\u001b'); }
                return;
            }
            if (scenario === 'cached' || scenario === 'install-engine' || scenario === 'install-error') {
                if (phase === 0 && frame.includes('0.4.3')) {
                    phase++;
                    if (scenario === 'cached') { terminal.write('\u001b'); }
                    else { terminal.write('\u001b[B\r'); }
                } else if (phase === 1 && frame.includes('Update engine to')) {
                    phase++;
                    terminal.write('\r');
                } else if (phase === 2 && scenario === 'install-error' && frame.includes('Engine update unsuccessful.')) {
                    phase++;
                    terminal.write('\u001b');
                } else if (phase === 3 && scenario === 'install-error' && frame.includes('Settings / Updates')) {
                    phase++;
                    terminal.write('\u001b');
                } else if (phase === 2 && frame.includes('Up to date')) {
                    phase++;
                    terminal.write('\u001b');
                }
                return;
            }
            if (phase === 0 && frame.includes('Not checked')) {
                phase++;
                if (scenario === 'cancel' || scenario === 'engine' || scenario === 'current-engine' || scenario === 'broken-engine') { terminal.write('\u001b[B'); }
                terminal.write('\r');
                return;
            }
            if (phase === 1 && (frame.includes('Update available') || frame.includes('Up to date') || frame.includes('Unavailable') || scenario === 'cancel' && frame.includes('Checking…'))) {
                phase++;
                terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Updates verified.');
        expect(output).not.toContain('Install model update');
        expect(output).not.toContain('Skira');
        if (scenario === 'install-error') {
            expect(coloredOutput).toContain('\u001b[31mEngine update unsuccessful.');
            expect(output).toContain('Not enough storage space.');
            expect(output).not.toContain('Private storage diagnostic');
        }
        if (scenario === 'current-cli') { expect(coloredOutput).toContain('\u001b[32mvelora is up to date.'); }
        if (scenario === 'offline-cli') { expect(coloredOutput).toContain('\u001b[31mCould not check. Try again.'); }
        if (scenario === 'cached') { expect(output).toContain('0.4.3'); expect(output).toContain('2.0.0'); }
        if (scenario.startsWith('current-')) { expect(output).toContain('Up to date'); }
        if (scenario === 'offline-cli' || scenario === 'broken-engine') {
            expect(output).toContain('Unavailable');
            expect(output).not.toContain('Up to date');
        }
        expect(output).toContain('Installed');
        expect(output).toContain('Available');
        expect(output).toContain(packageInfo.version);
        if (scenario === 'cli' || scenario === 'no-model') {
            expect(output).toContain('2.0.0');
        }
        if (scenario === 'engine') {
            expect(output).toMatch(/Engine\s+│\s+0\.4\.1\s+│\s+0\.4\.2/);
        }
        if (scenario === 'no-model') {
            expect(output).toContain('Engine');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
