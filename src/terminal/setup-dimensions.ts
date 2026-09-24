import { setupLayout } from './set-setup-layout.js';
import header from './header.js';

export var MIN_COLUMNS = 60;
export var MIN_ROWS = 20;
export var SCREEN_MARGIN_COLUMNS = 2;
export var FOOTER_ROWS = 2;
export var TERMINAL_BOTTOM_MARGIN_ROWS = 1;

export default function setupDimensions() {
    var FULL_HEADER_MIN_ROWS = 28;
    var STEP_HEADING_ROWS = 3;
    if (setupLayout.detail) {
        STEP_HEADING_ROWS++;
    }
    var columns = process.stdout.columns;
    var rows = process.stdout.rows;
    var headerText = header(true);
    if (rows >= FULL_HEADER_MIN_ROWS) {
        headerText = header();
    }
    var headerRows = headerText.split('\n').length - 1;
    var contentRows = rows - headerRows - STEP_HEADING_ROWS - FOOTER_ROWS - TERMINAL_BOTTOM_MARGIN_ROWS;
    return {
        columns,
        rows,
        tooSmall: columns < MIN_COLUMNS || rows < MIN_ROWS,
        contentWidth: Math.max(1, columns - SCREEN_MARGIN_COLUMNS * 2),
        contentRows,
        headerText
    };
}
