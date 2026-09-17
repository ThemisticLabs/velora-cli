import style from './style.js';
import header from './header.js';

export default function renderSetup(title: string, detail: string, footer: string): void {
    var HORIZONTAL_MARGIN = 2;
    var CLEAR_SCREEN = '\u001b[H\u001b[2J';
    var SAVE_CURSOR = '\u001b7';
    var RESTORE_CURSOR = '\u001b8';
    var CLEAR_LINE_END = '\u001b[K';
    var width = process.stdout.columns - HORIZONTAL_MARGIN * 2;
    var divider = '  ' + style('─'.repeat(width), 'muted');
    var screen = CLEAR_SCREEN;
    screen += header();
    screen += divider + '\n';
    screen += '  ' + style(title, 'strong') + '\n';
    screen += '  ' + style(detail, 'muted') + '\n\n';
    screen += divider + '\n\n';
    var footerRow = process.stdout.rows - 1;
    screen += SAVE_CURSOR + '\u001b[' + footerRow + ';1H';
    screen += style(footer, 'muted') + CLEAR_LINE_END + RESTORE_CURSOR;
    process.stdout.write(screen);
}
