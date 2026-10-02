import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['create', 'required', 'clipboard', 'clipboard-throws', 'cancel', 'resize', 'revoke', 'cancel-revoke'])('API key table and popup: %s', async function (scenario) {
    var output = '';
    var rawOutput = '';
    var decoder = new TextDecoder();
    var phase = 0;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/api-keys.ts', import.meta.url)), scenario], {
        env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1', NO_COLOR: undefined },
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            rawOutput += decoder.decode(bytes, { stream: true });
            output = stripVTControlCharacters(rawOutput);
            var frame = stripVTControlCharacters(rawOutput.slice(rawOutput.lastIndexOf('\u001b[H\u001b[2J')));
            if (phase === 7 && frame.includes('Enla')) {
                phase = 8;
                terminal.resize(85, 30);
                return;
            }
            if (!frame.includes('Press F1 to open documentation')) { return; }
            if (phase === 0 && frame.includes('Add API key')) {
                phase = 1;
                if (scenario === 'revoke' || scenario === 'cancel-revoke') { terminal.write('\u001b[A\r'); }
                else { terminal.write('\r'); }
                return;
            }
            if (phase === 1 && frame.includes('Create key')) {
                phase = 2;
                expect(frame).toContain('┌');
                expect(frame).toContain('Name:');
                if (scenario === 'cancel') { terminal.write('\u001b'); return; }
                if (scenario === 'required') { phase = 9; terminal.write('\u001b[A\r'); return; }
                terminal.write('Editor\r');
                return;
            }
            if (phase === 9 && frame.includes('Enter name.')) {
                phase = 2;
                terminal.write('Editor\r');
                return;
            }
            if (phase === 1 && frame.includes('Revoke key')) {
                phase = 3;
                if (scenario === 'cancel-revoke') { terminal.write('\u001b'); return; }
                terminal.write('\r');
                return;
            }
            if (phase === 2 && frame.includes('› Note:')) {
                if (scenario === 'resize') { phase = 7; terminal.resize(5, 5); return; }
                phase = 3;
                terminal.write('My local app\r');
                return;
            }
            if (phase === 8 && frame.includes('› Note:')) {
                phase = 3;
                expect(frame).toContain('Editor');
                terminal.write('My local app\r');
                return;
            }
            if (phase === 3 && frame.includes('› Create key')) {
                phase = 4;
                terminal.write('\r\r');
                return;
            }
            if ((phase === 3 || phase === 4) && (frame.includes('clipboard.') || frame.includes('Clipboard unavailable.') || frame.includes('API key revoked.'))) {
                phase = 5;
                if (scenario === 'clipboard' || scenario === 'clipboard-throws') { expect(frame).toContain('velora_'); }
                terminal.write('\r');
                return;
            }
            if ((phase === 2 && scenario === 'cancel' || phase === 3 && scenario === 'cancel-revoke' || phase === 5) && frame.includes('Add API key') && !frame.includes('Create key') && !frame.includes('Revoke key')) {
                phase = 6;
                terminal.write('\u001b');
            }
        } }
    });
    var timer = setTimeout(function () { child.kill(); }, 8000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('API keys verified.');
        expect(output).toContain('They do not encrypt processing.');
        expect(output).toContain('Created');
    } finally { clearTimeout(timer); child.kill(); child.terminal?.close(); }
}, 10000);
