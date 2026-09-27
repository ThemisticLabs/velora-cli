import style from './style.js';

export default function renderProgress(downloaded: number, total: number, width: number, frame: number): string {
    if (total <= 0) {
        var FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        return '  ' + style(FRAMES[frame % FRAMES.length]! + ' Working…', 'accent');
    }
    var PERCENT_LABEL_WIDTH = 6;
    var barWidth = Math.max(1, width - PERCENT_LABEL_WIDTH);
    var fraction = Math.max(0, Math.min(1, downloaded / total));
    var filled = Math.floor(fraction * barWidth);
    return '  ' + style('█'.repeat(filled), 'accent') + style('░'.repeat(barWidth - filled), 'divider') +
        '  ' + String(Math.floor(fraction * 100)).padStart(3) + '%';
}
