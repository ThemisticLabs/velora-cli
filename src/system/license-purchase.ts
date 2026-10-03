import { execFile } from 'node:child_process';

export var LICENSE_PURCHASE_URL = '';

export default async function licensePurchase(): Promise<string> {
    if (!LICENSE_PURCHASE_URL) { return 'License purchases are not available yet.'; }
    var target = new URL(LICENSE_PURCHASE_URL);
    if (target.protocol !== 'https:' || !['themistic.com', 'console.themistic.com'].includes(target.hostname) || target.username || target.password) {
        return 'License purchase link unavailable.';
    }
    var command = 'xdg-open';
    var args = [target.href];
    if (process.platform === 'darwin') { command = 'open'; args = ['-a', 'Safari', target.href]; }
    if (process.platform === 'win32') { command = 'rundll32.exe'; args = ['url.dll,FileProtocolHandler', target.href]; }
    return new Promise(function (resolve) {
        execFile(command, args, { timeout: 10000, windowsHide: true }, function (error) {
            if (error) { resolve('Could not open browser. Press F2 to retry.'); return; }
            resolve('License purchase opened in your browser.');
        });
    });
}
