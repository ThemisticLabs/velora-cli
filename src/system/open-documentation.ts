import { execFile } from 'node:child_process';

export default async function openDocumentation(url: string): Promise<boolean> {
    var target: URL;
    try {
        target = new URL(url);
    } catch {
        return false;
    }
    if (target.origin !== 'https://docs.themistic.com' || target.username || target.password) {
        return false;
    }
    var command = 'xdg-open';
    var args = [target.href];
    if (process.platform === 'darwin') {
        command = 'open';
        args = ['-a', 'Safari', target.href];
    }
    if (process.platform === 'win32') {
        command = 'rundll32.exe';
        args = ['url.dll,FileProtocolHandler', target.href];
    }
    return new Promise(function (resolve) {
        execFile(command, args, { timeout: 10000, windowsHide: true }, function (error) {
            resolve(!error);
        });
    });
}
