import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each([20, 30])('footer stays fixed through startup and errors: %s rows', async function (rows) {
    var raw = '';
    var decoder = new TextDecoder();
    var lastFrame = -1;
    var stages = new Set<string>();
    var child = spawn([process.execPath, fileURLToPath(new URL('./fixtures/footer.ts', import.meta.url))], {
        terminal: { cols: 90, rows, data: function (terminal, bytes) {
            raw += decoder.decode(bytes, { stream: true });
            var offset = raw.lastIndexOf('\u001b[H\u001b[2J');
            var frame = stripVTControlCharacters(raw.slice(offset));
            var hint = 'Press F1 to open documentation';
            var end = frame.indexOf(hint);
            if (end === -1 || offset === lastFrame) { return; }
            lastFrame = offset;
            var lines = frame.slice(0, end + hint.length).split('\n');
            expect(lines.length, frame).toBe(rows - 1);
            expect(lines[rows - 3], frame).toContain('Ctrl+C');
            expect(lines[rows - 2], frame).toContain(hint);
            if (frame.includes('Opening velora…')) { stages.add('opening'); }
            if (frame.includes('Checking your license…')) { stages.add('checking'); }
            if (frame.includes('Checking license access.')) { stages.add('progress'); }
            if (frame.includes('Enter a license key.')) { stages.add('error'); terminal.write('\r'); }
            if (frame.includes('Full content')) { stages.add('overflow'); terminal.write('\r'); }
            if (frame.includes('Selected model: Test model')) { stages.add('menu'); terminal.write('\u001b'); }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, stripVTControlCharacters(raw)).toBe(0);
        expect(stages).toEqual(new Set(['opening', 'checking', 'progress', 'error', 'overflow', 'menu']));
        expect(raw).toContain('Footer verified.');
        expect(raw).not.toContain('F2');
    } finally { clearTimeout(timeout); child.kill(); child.terminal?.close(); }
});
