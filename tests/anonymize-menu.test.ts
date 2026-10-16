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
