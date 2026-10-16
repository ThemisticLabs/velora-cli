import { test, expect } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

test.skipIf(process.platform === 'win32').each(['text', 'mapping', 'copy', 'empty', 'cancel-input', 'long', 'retry', 'start'])('anonymize terminal: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var started = false;
    var child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/anonymize-menu.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            output += Buffer.from(bytes).toString('utf8');
            var screen = stripVTControlCharacters(output);
            if (!started && scenario === 'start' && screen.includes('Start service')) { started = true; terminal.write('\r'); return; }
            if (phase === 0 && screen.includes('Enter one line')) {
                phase++;
                if (scenario === 'cancel-input') { terminal.write('\u001b'); return; }
                var text = 'Hallo Anna Müller.';
                if (scenario === 'empty') { text = ''; }
                terminal.write(text + '\r');
                return;
            }
            if (phase === 1 && scenario === 'retry' && screen.includes('Fixture service busy.')) { phase = 2; terminal.write('\r'); return; }
            if (phase === 2 && scenario === 'retry' && screen.includes('Enter one line') && screen.includes('› Hallo Anna Müller.')) {
                phase = 3; terminal.write('\r'); return;
            }
            if ((phase === 1 || phase === 3) && screen.includes('Anonymized text')) {
                phase = 4;
                if (scenario === 'mapping') { terminal.write('m'); return; }
                if (scenario === 'copy') { terminal.write('c'); return; }
                if (scenario === 'long') { terminal.write('\u001b[F'); return; }
                terminal.write('\u001b');
                return;
            }
            if (phase === 4 && scenario === 'mapping' && screen.includes('Mapping · Contains original values') ||
                phase === 4 && scenario === 'copy' && screen.includes('Copied anonymized text.') ||
                phase === 4 && scenario === 'long' && screen.includes('line-39')) {
                phase = 5; terminal.write('\u001b');
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 6000);
    try {
        expect(await child.exited, output).toBe(0);
        expect(output).toContain('Anonymize menu verified.');
        expect(output).toContain('\u001b[?25h\u001b[?1049l');
        if (scenario === 'long') { expect(output).toContain('More below'); }
    } finally { clearTimeout(timeout); child.kill(); child.terminal?.close(); }
});

test.skipIf(process.platform === 'win32').each(['unicode', 'wide', 'long-input', 'wide-input', 'edit-input'])('anonymize keeps Unicode and the input cursor inside the frame: %s', async function (scenario) {
    var output = '';
    var inputFrame = '';
    var previewFrame = '';
    var phase = 0;
    var idle: ReturnType<typeof setTimeout> | undefined;
    var decoder = new TextDecoder();
    var child = Bun.spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/anonymize-menu.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, bytes) {
            output += decoder.decode(bytes, { stream: true });
            var screen = stripVTControlCharacters(output.slice(output.lastIndexOf('\u001b[H\u001b[2J')));
            clearTimeout(idle);
            if (phase === 0 && screen.includes('Enter one line')) {
                phase = 1;
                var text = 'Hallo Anna Müller.';
                if (scenario === 'long-input') { text = 'a'.repeat(1000); }
                if (scenario === 'wide-input') { text = '界'.repeat(1000); }
                if (scenario === 'edit-input') { text = 'ab🙂cd'; }
                terminal.write(text);
                return;
            }
            if (phase === 1) {
                idle = setTimeout(function () {
                    inputFrame = output.slice(output.lastIndexOf('\u001b[H\u001b[2J'));
                    phase = 2;
                    if (scenario === 'edit-input') { terminal.write('\u001b[D\u001b[D\u007fZ\u001b[F\u007f'); }
                    terminal.write('\r');
                }, 50);
            }
            if (phase === 2 && screen.includes('Anonymized text')) { phase = 3; }
            if (phase === 3) {
                idle = setTimeout(function () {
                    previewFrame = output.slice(output.lastIndexOf('\u001b[H\u001b[2J'));
                    phase = 4;
                    terminal.write('\u001b');
                }, 50);
            }
        } }
    });
    var timeout = setTimeout(function () { child.kill(); }, 6000);
    try {
        expect(await child.exited, output.slice(-2000)).toBe(0);
        expect(output).toContain('Anonymize menu verified.');
        for (var frame of [inputFrame, previewFrame]) {
            var rendered = terminalFrame(frame);
            expect(rendered.lines.length).toBeLessThanOrEqual(19);
            for (var line of rendered.lines) { expect(Bun.stringWidth(line)).toBeLessThanOrEqual(58); }
        }
        if (scenario === 'unicode') {
            expect(previewFrame).not.toContain('�');
            expect(previewFrame).toContain('🙂');
            expect(previewFrame).toContain('👩‍👩‍👧‍👦');
            expect(previewFrame.normalize('NFC')).toContain('é');
        }
        var input = terminalFrame(inputFrame);
        for (var index = 0; index < input.lines.length; index++) {
            if (input.lines[index]!.startsWith('  › ')) { expect(input.row).toBe(index); }
        }
        expect(input.column).toBeGreaterThanOrEqual(4);
        expect(input.column).toBeLessThan(58);
    } finally { clearTimeout(idle); clearTimeout(timeout); child.kill(); child.terminal?.close(); }
});

function terminalFrame(frame: string) {
    var row = 0;
    var column = 0;
    for (var token of frame.matchAll(/\u001b\[([0-?]*)([ -/]*)([@-~])|\r|\n|[^\u001b\r\n]+/g)) {
        if (token[3]) {
            var parameters = token[1]!.split(';');
            var count = Number(parameters[0]) || 1;
            if (token[3] === 'H') { row = count - 1; column = (Number(parameters[1]) || 1) - 1; }
            if (token[3] === 'A') { row -= count; }
            if (token[3] === 'B') { row += count; }
            if (token[3] === 'G') { column = count - 1; }
        } else if (token[0] === '\r') { column = 0; }
        else if (token[0] === '\n') { row++; }
        else { column += Bun.stringWidth(token[0]); }
    }
    return { row, column, lines: stripVTControlCharacters(frame).split(/\r?\n/) };
}
