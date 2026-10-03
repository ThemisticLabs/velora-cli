import { test, expect } from 'bun:test';
import { spawn } from 'bun';
import { fileURLToPath } from 'node:url';

test.skipIf(process.platform === 'win32').each(['first', 'returning', 'delete', 'cancel-delete', 'resize', 'license', 'offline', 'current', 'switch', 'escape-license', 'escape-delete', 'skip-license', 'doctor', 'api-keys'])('main menu terminal: %s', async function (scenario) {
    var output = '';
    var phase = 0;
    var recoverySent = false;
    var modelsOpened = false;
    var child = spawn([process.execPath, 'run', fileURLToPath(new URL('./fixtures/main-menu.ts', import.meta.url)), scenario], {
        terminal: { cols: 60, rows: 20, data: function (terminal, data) {
            var frame = Buffer.from(data).toString('utf8');
            output += frame;
            if (!recoverySent && scenario === 'skip-license' && frame.includes('Change license')) {
                recoverySent = true;
                terminal.write('\u001b[B\u001b[B\r');
                return;
            }
            if (phase === 0 && frame.includes('Selected model: Skira 7 Alpha')) {
                phase++;
                if (scenario === 'first' || scenario === 'returning' || scenario === 'skip-license') {
                    terminal.write('\u0003');
                    return;
                }
                if (scenario === 'api-keys') {
                    terminal.write('\u001b[B\r');
                    return;
                }
                if (scenario === 'resize') {
                    terminal.resize(40, 10);
                    return;
                }
                terminal.write('\r');
                return;
            }
            if (scenario === 'api-keys' && phase === 1 && frame.includes('Selected model:')) {
                phase++;
                terminal.write('\u0003');
                return;
            }
            if (scenario === 'resize') {
                if (phase === 1 && frame.includes('Enlarge terminal')) {
                    phase++;
                    terminal.resize(70, 20);
                    return;
                }
                if (phase === 2 && frame.includes('Selected model:')) {
                    phase++;
                    terminal.write('\u0003');
                }
                return;
            }
            if (phase === 1 && frame.includes('Change license')) {
                phase++;
                if (scenario === 'switch') {
                    terminal.write('\u001b[B\u001b[B\r');
                } else if (scenario === 'license' || scenario === 'escape-license') {
                    terminal.write('\u001b[B\r');
                } else if (scenario === 'offline' || scenario === 'current') {
                    terminal.write('\u001b[B\u001b[B\u001b[B\r');
                } else if (scenario === 'doctor') {
                    terminal.write('\u001b[A\r');
                } else {
                    terminal.write('\u001b[B\u001b[B\r');
                }
                return;
            }
            if (!modelsOpened && phase === 2 && frame.includes('Settings / Manage models')) {
                modelsOpened = true;
                if (scenario === 'switch') {
                    terminal.write('\r');
                } else {
                    terminal.write('\u001b[A\r');
                }
                return;
            }
            if ((phase === 3 && scenario === 'switch' || phase === 4 && scenario === 'delete') && frame.includes('Settings / Manage models')) {
                terminal.write('\u001b');
                return;
            }
            if (scenario === 'doctor' && phase === 2 && frame.includes('Checks complete.')) {
                phase++;
                terminal.write('\u001b');
                return;
            }
            if (scenario === 'doctor' && phase === 3 && frame.includes('Change license')) {
                terminal.write('\u0003');
                return;
            }
            if (phase === 3 && scenario === 'switch' && frame.includes('Change license')) {
                terminal.write('\u001b');
                return;
            }
            if (phase === 4 && scenario === 'delete' && frame.includes('Change license')) {
                terminal.write('\u001b');
                return;
            }
            if (scenario === 'escape-license') {
                if (phase === 2 && frame.includes('License key:')) {
                    phase++;
                    terminal.write('partial-key');
                    setTimeout(function () { terminal.write('\u001b'); }, 20);
                } else if (phase === 3 && frame.includes('Change license')) {
                    phase++;
                    terminal.write('\u001b');
                } else if (phase === 4 && frame.includes('Selected model:')) {
                    phase++;
                    terminal.write('\u0003');
                }
                return;
            }
            if (scenario === 'switch') {
                if (phase === 2 && frame.includes('Installed models')) {
                    phase++;
                    terminal.write('\u001b[B'.repeat(12) + '\r');
                }
                if (phase === 3 && frame.includes('Selected model: Model 12')) {
                    phase++;
                    terminal.write('\u0003');
                }
                return;
            }
            if (scenario === 'license') {
                if (phase === 2 && frame.includes('License key:')) {
                    phase++;
                    terminal.write('fixture-license\r');
                }
                if (phase === 3 && frame.includes('This license has expired.')) {
                    phase++;
                    terminal.write('\u0003');
                }
                return;
            }
            if (scenario === 'offline' || scenario === 'current') {
                if (phase === 2 && frame.includes('Installed') && frame.includes('Available')) {
                    phase++;
                    terminal.write('\r');
                }
                if (phase === 3 && (frame.includes('Could not check.') || frame.includes('velora is up to date.'))) {
                    phase++;
                    terminal.write('\u0003');
                }
                return;
            }
            if (phase === 2 && frame.includes('Installed models')) {
                phase++;
                terminal.write('\r');
                return;
            }
            if (phase === 3 && frame.includes('This model will need')) {
                phase++;
                if (scenario === 'escape-delete') {
                    terminal.write('\u001b');
                } else if (scenario === 'cancel-delete') {
                    terminal.write('\u0003');
                } else {
                    terminal.write('\u001b[B\r');
                }
                return;
            }
            if (phase === 4 && scenario === 'escape-delete' && frame.includes('Installed models')) {
                phase++;
                terminal.write('\u0003');
            }
            if (phase === 4 && frame.includes('Selected model: None')) {
                phase++;
                terminal.write('\u0003');
            }
        } }
    });
    var TEST_TIMEOUT_MS = 5000;
    var timeout = setTimeout(function () { child.kill(); }, TEST_TIMEOUT_MS);
    try {
        var code = await child.exited;
        expect(code, output).toBe(0);
        expect(output).toContain('Menu verified.');
        expect(output).not.toContain('FIXTURE-PRIVATE');
        expect(output).toContain('\u001b[?25h\u001b[?1049l');
        if (scenario === 'switch') {
            expect(output).toContain('More below');
            expect(output).toContain('More above');
        }
        if (scenario === 'offline') {
            expect(output).not.toContain('velora is up to date.');
        }
        if (scenario === 'resize') {
            expect(output).toContain('Enlarge terminal');
        }
        if (scenario === 'delete') {
            expect(output).toContain('Selected model: None');
        }
    } finally {
        clearTimeout(timeout);
        child.kill();
        child.terminal?.close();
    }
});
