import { spawn } from 'node:child_process';

export default async function copyClipboard(value: string): Promise<boolean> {
    var commands = [['wl-copy'], ['xclip', '-selection', 'clipboard']];
    if (process.platform === 'darwin') { commands = [['/usr/bin/pbcopy']]; }
    if (process.platform === 'win32') {
        commands = [['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())']];
    }
    for (var command of commands) {
        var copied = await new Promise<boolean>(function (resolve) {
            var child = spawn(command[0]!, command.slice(1), { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
            var CLIPBOARD_TIMEOUT_MS = 3000;
            var timer = setTimeout(function () { child.kill(); resolve(false); }, CLIPBOARD_TIMEOUT_MS);
            child.on('error', function () { clearTimeout(timer); resolve(false); });
            child.stdin.on('error', function () { child.kill(); clearTimeout(timer); resolve(false); });
            child.on('close', function (code) { clearTimeout(timer); resolve(code === 0); });
            child.stdin.end(value);
        });
        if (copied) { return true; }
    }
    return false;
}
