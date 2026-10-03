import { test, expect } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each([20, 30])('introductory terminal keeps navigation and footer visible: %s rows', async function (rows) {
    var raw = '';
    var decoder = new TextDecoder();
    var lastFrame = -1;
    var stage = 0;
    var child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/onboarding-terminal.ts', import.meta.url))], {
        terminal: { cols: 60, rows, data: function (terminal, bytes) {
            raw += decoder.decode(bytes, { stream: true });
            var offset = raw.lastIndexOf('\u001b[H\u001b[2J');
            var frame = stripVTControlCharacters(raw.slice(offset)).replace(/\r/g, '');
            var footer = 'Press F1 to open documentation';
            var end = frame.indexOf(footer);
            if (end === -1 || offset === lastFrame) { return; }
            lastFrame = offset;
            var lines = frame.slice(0, end + footer.length).split('\n');
            expect(lines.length, frame).toBe(rows - 1);
            for (var line of lines) { expect(line.length, frame).toBeLessThan(60); }
            if (stage === 0 && frame.includes('Create API key')) { stage++; terminal.write('\u001b[B\r'); return; }
            if (stage === 1 && frame.includes('[ Save and continue ]')) { stage++; terminal.write('\u001b[B\u001b[B\u001b[B\u001b[B\r'); return; }
            if (stage === 2 && frame.includes('Start at login')) { stage++; terminal.write('\r'); return; }
            for (var item of [{ stage: 3, title: 'Start and stop' }, { stage: 4, title: 'Your applications' }, { stage: 5, title: 'The macOS menu bar' }, { stage: 6, title: 'Keep it running' }, { stage: 7, title: 'Find your way' }]) {
                if (stage === item.stage && frame.includes(item.title)) { stage++; terminal.write('\r'); return; }
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 5000);
    try {
        expect(await child.exited, stripVTControlCharacters(raw)).toBe(0);
        expect(stage).toBe(8);
        expect(raw).toContain('Introductory terminal verified.');
    } finally { clearTimeout(timeout); child.kill(); child.terminal?.close(); }
});
