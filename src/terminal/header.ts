import mark from '../assets/mark.json' with { type: 'json' };
import packageInfo from '../../package.json' with { type: 'json' };
import style from './style.js';

export default function header(): string {
    if ((process.stdout.columns || 80) < 40 || (process.stdout.rows || 24) < 24) {
        return '\n  ' + style('velora', 'accent') + '\n';
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
        output += '\n';
    }
    return output;
}
