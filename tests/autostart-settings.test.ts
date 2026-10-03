import { test, expect } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['setup-off', 'setup-on', 'settings-disable', 'cancel', 'save-error', 'unsupported'])('login switch list saves only confirmed choices: %s', async function (scenario) {
    var raw = '';
    var decoder = new TextDecoder();
    var phase = 0;
    var lastFrame = -1;
    var child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/autostart-settings.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            raw += decoder.decode(bytes, { stream: true });
            var offset = raw.lastIndexOf('\u001b[H\u001b[2J');
            var frame = stripVTControlCharacters(raw.slice(offset)).replace(/\r/g, '');
            var footer = 'Press F1 to open documentation';
            var end = frame.indexOf(footer);
            if (end === -1 || offset === lastFrame) { return; }
            lastFrame = offset;
            var lines = frame.slice(0, end + footer.length).split('\n');
            expect(lines.length, frame).toBe(19);
            for (var line of lines) { expect(line.length, frame).toBeLessThan(60); }
            expect(frame).not.toContain('[ Save');
            if (scenario === 'unsupported') {
                if (phase === 0 && frame.includes('Continue')) { phase++; terminal.write('\r'); }
                return;
            }
            if (phase === 0 && frame.includes('Save')) {
                expect(frame).toMatch(/Start at login +│ (Off|On)/);
                phase++;
                if (scenario === 'settings-disable') { terminal.write(' \u001b[B\r'); return; }
                expect(frame).toContain('› Save and continue');
                if (scenario === 'setup-off') { terminal.write('\r'); return; }
                if (scenario === 'cancel') { terminal.write('\u001b[B \u001b'); return; }
                terminal.write('\u001b[B \u001b[A\r');
                return;
            }
            if (phase === 1 && scenario === 'settings-disable' && frame.includes('Saved.')) {
                expect(frame).toMatch(/Start at login +│ Off/);
                phase++; terminal.write('\u001b');
            }
            if (phase === 1 && scenario === 'save-error' && frame.includes('Could not save.')) {
                expect(frame).toMatch(/Start at login +│ On/);
                expect(frame).toContain('› Save and continue');
                phase++; terminal.write('\r');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, stripVTControlCharacters(raw)).toBe(0);
        expect(raw).toContain('Login preferences verified.');
        expect(phase).toBeGreaterThan(0);
    } finally { clearTimeout(timeout); child.kill(); child.terminal?.close(); }
});
