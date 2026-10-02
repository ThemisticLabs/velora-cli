import { test, expect } from 'bun:test';
import setSetupLayout, { setupLayout } from '../src/terminal/set-setup-layout.js';

test('each screen sets its documentation target and resets a previous custom footer', function () {
    setSetupLayout('Input', '', '/velora/license-api/', 'Enter Save · Esc Back', 'Error');
    expect(setupLayout.tone).toBe('Error');
    expect(setupLayout.footer).toBe('Enter Save · Esc Back');
    expect(setupLayout.documentationPath).toBe('/velora/license-api/');
    setSetupLayout('Models', '', '/velora/models');
    expect(setupLayout.footer).toBe('↑/↓ Move · Enter Select · Esc Back · Ctrl+C Quit');
    expect(setupLayout.documentationPath).toBe('/velora/models');
    expect(setupLayout.tone).toBe('muted');
    setSetupLayout('Setup');
    expect(setupLayout.detail).toBe('');
    expect(setupLayout.documentationPath).toBe('/velora/setup');
});
