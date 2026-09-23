import { availableVersion } from '../updates/cli-update.js';
import mark from '../assets/mark.json' with { type: 'json' };
import packageInfo from '../../package.json' with { type: 'json' };
import style from './style.js';

export default function header(compact = false): string {
    if (compact || (process.stdout.columns || 80) < 40 || (process.stdout.rows || 24) < 24) {
        var line = 'velora';
        if (availableVersion) {
            line += ' · Update available: ' + availableVersion;
        }
        return '  ' + style(line.slice(0, Math.max(1, (process.stdout.columns || 80) - 4)), 'accent') + '\n';
    }

    var output = '\n';
    for (var index = 0; index < mark.length; index++) {
        output += '  ' + style(mark[index]!, 'accent');
        if (index === 1) {
            output += '   ' + style('velora', 'strong');
        }
        if (index === 2) {
            output += '   ' + style(packageInfo.version, 'muted');
        }
        if (index === 3 && availableVersion) {
            var label = 'Update available: ' + availableVersion;
            var labelWidth = Math.max(0, (process.stdout.columns || 80) - mark[index]!.length - 6);
            output += '   ' + style(label.slice(0, labelWidth), 'accent');
        }
        output += '\n';
    }
    return output;
}
