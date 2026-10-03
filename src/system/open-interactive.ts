import { fileURLToPath } from 'node:url';
import dataDirectory from './data-directory.js';
import interactiveSession from './interactive-session.js';
import { IS_COMPILED } from './build-mode.js';

export default async function openInteractive(page: 'open' | 'settings', directory = dataDirectory()): Promise<void> {
    var existing = await interactiveSession(page, directory);
    if (existing && 'application' in existing) {
        var focusScript = `var app=Application(${JSON.stringify(existing.application)}); app.activate();`;
        if (existing.application === 'Ghostty') {
            focusScript += `for(var terminal of app.terminals()){if(terminal.id()===${JSON.stringify(existing.id)}){app.focus(terminal);break;}}`;
        } else {
            focusScript += `for(var window of app.windows()){for(var tab of window.tabs()){if(tab.tty()===${JSON.stringify(existing.id)}){window.selectedTab=tab;window.index=1;}}}`;
        }
        var focus = Bun.spawn(['/usr/bin/osascript', '-l', 'JavaScript', '-e', focusScript], { stdout: 'ignore', stderr: 'ignore' });
        if (await focus.exited !== 0) { throw new Error('Could not focus the existing velora terminal.'); }
        return;
    }
    var command = "'" + process.execPath.replaceAll("'", "'\\''") + "'";
    if (!IS_COMPILED) {
        command += " run '" + fileURLToPath(new URL('../cli.ts', import.meta.url)).replaceAll("'", "'\\''") + "'";
    }
    if (page === 'settings') { command += ' settings'; }
    var script = `
ObjC.import('CoreServices');
var handler = $.LSCopyDefaultRoleHandlerForContentType($('com.apple.terminal.shell-script'), $.kLSRolesAll);
var terminal = ObjC.unwrap(ObjC.castRefToObject(handler));
var command = ${JSON.stringify(command)};
if (terminal === 'com.mitchellh.ghostty') {
    var app = Application('Ghostty');
    app.activate();
    var window = app.newWindow();
    var surface = window.terminals()[0];
    app.inputText(command, {to: surface});
    app.sendKey('enter', {to: surface});
} else if (terminal === 'com.apple.Terminal') {
    var app = Application('Terminal');
    app.activate();
    app.doScript(command);
} else if (terminal === 'com.googlecode.iterm2') {
    var app = Application('iTerm');
    app.activate();
    var window = app.createWindowWithDefaultProfile();
    window.currentSession.write({text: command});
} else {
    throw new Error('Open velora in your terminal. Automatic opening is unavailable for the configured terminal.');
}
`;
    // Desktop terminals must not inherit the helper's noninteractive output settings.
    var environment = { ...process.env };
    delete environment.NO_COLOR;
    delete environment.TERM;
    var result = Bun.spawn(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script], { stdout: 'ignore', stderr: 'pipe', env: environment });
    var error = await new Response(result.stderr).text();
    if (await result.exited !== 0) {
        if (error.includes('(-1743)')) { throw new Error('Allow velora to open your terminal in macOS System Settings, Privacy & Security, Automation.'); }
        throw new Error('Could not open your configured terminal. Open velora manually.');
    }
    var SESSION_START_TIMEOUT_MS = 30000;
    var SESSION_POLL_MS = 250;
    var deadline = Date.now() + SESSION_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await interactiveSession('open', directory)) { return; }
        await Bun.sleep(SESSION_POLL_MS);
    }
    throw new Error('The terminal opened. Finish setup there before opening another velora session.');
}
