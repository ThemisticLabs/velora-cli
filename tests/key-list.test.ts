import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each([{ cols: 60, rows: 20 }, { cols: 100, rows: 30 }])('full key tables keep notes, actions and footer in fixed slots: %j', async function (size) {
    var raw = '';
    var decoder = new TextDecoder();
    var lastFrame = -1;
    var actionRow = -1;
    var phase = 0;
    var child = spawn([process.execPath, fileURLToPath(new URL('./fixtures/key-list.ts', import.meta.url))], {
        terminal: { ...size, data: function (terminal, bytes) {
            raw += decoder.decode(bytes, { stream: true });
            var offset = raw.lastIndexOf('\u001b[H\u001b[2J');
            var frame = stripVTControlCharacters(raw.slice(offset));
            var hint = 'Press F1 to open documentation';
            var end = frame.indexOf(hint);
            if (end === -1 || offset === lastFrame) { return; }
            lastFrame = offset;
            var lines = frame.slice(0, end + hint.length).split('\n');
            expect(lines.length, frame).toBe(size.rows - 1);
            expect(lines[size.rows - 3], frame).toContain('Ctrl+C');
            var currentActionRow = -1;
            for (var index = 0; index < lines.length; index++) {
                if (lines[index]!.includes('Add API key')) { currentActionRow = index; }
            }
            if (actionRow === -1) { actionRow = currentActionRow; }
            expect(currentActionRow, frame).toBe(actionRow);
            expect(lines[actionRow - 1]?.trim(), frame).toBe('');
            if (phase === 0 && frame.includes('› Add API key')) { phase++; terminal.write('\u001b[A'); return; }
            if (phase === 1 && frame.includes('› Key 9')) {
                expect(frame).toContain('Select to revoke this key.');
                phase++; terminal.write('\u001b[A'); return;
            }
            if (phase === 2 && frame.includes('› Key 8')) {
                expect(frame).toContain('…');
                phase++; terminal.write('\u001b[A'); return;
            }
            if (phase === 3 && frame.includes('› Key 7')) {
                expect(frame).toContain('Short note for Key 7');
                phase++; terminal.write('\u001b[B\u001b[B\u001b[B'); return;
            }
            if (phase === 4 && frame.includes('› Add API key')) { phase++; terminal.write('\u001b'); }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, stripVTControlCharacters(raw)).toBe(0);
        expect(phase).toBe(5);
        expect(raw).toContain('Full key list verified.');
    } finally { clearTimeout(timeout); child.kill(); child.terminal?.close(); }
});
