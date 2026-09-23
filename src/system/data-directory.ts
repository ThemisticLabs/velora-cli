import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export default function dataDirectory(): string {
    var home = homedir();
    if (process.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', 'velora');
    }
    if (process.platform === 'win32') {
        var localData = process.env.LOCALAPPDATA;
        if (!localData || !isAbsolute(localData)) {
            localData = join(home, 'AppData', 'Local');
        }
        return join(localData, 'velora');
    }
    var xdgData = process.env.XDG_DATA_HOME;
    if (!xdgData || !isAbsolute(xdgData)) {
        xdgData = join(home, '.local', 'share');
    }
    return join(xdgData, 'velora');
}
