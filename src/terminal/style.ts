export default function style(text: string, name: 'accent' | 'strong' | 'muted' | 'divider'): string {
    var colorEnabled = Boolean(process.stdout.isTTY);
    if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') {
        colorEnabled = true;
    }
    if (process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb' || process.env.FORCE_COLOR === '0') {
        colorEnabled = false;
    }
    if (!colorEnabled) {
        return text;
    }

    var STYLES = { strong: '1', muted: '2', divider: '90', accent: '38;2;104;107;231' };
    var code = STYLES[name];
    var terminalColors = process.env.COLORFGBG?.split(';');
    if (name === 'accent' && terminalColors?.at(-1) === '15') {
        code = '38;2;37;37;204';
    }
    var RESET_STYLE = '\u001b[0m';
    return '\u001b[' + code + 'm' + text + RESET_STYLE;
}
