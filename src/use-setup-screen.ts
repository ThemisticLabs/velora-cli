import { useEffect, useKeypress, useRef, useState } from '@inquirer/core';
import { setupLayout } from './set-setup-layout.js';
import style from './style.js';
import setupDimensions, { MIN_COLUMNS, MIN_ROWS, FOOTER_ROWS, TERMINAL_BOTTOM_MARGIN_ROWS } from './setup-dimensions.js';
import openDocumentation from './open-documentation.js';

export default function useSetupScreen(content: string, error = '', inputCursor = false, documentationPath = setupLayout.documentationPath): [string, string] {
    var [, setSize] = useState('');
    var [documentationStatus, setDocumentationStatus] = useState('');
    var opening = useRef(false);
    var active = useRef(true);
    useKeypress(function (key) {
        if (key.name !== 'f1' || opening.current) {
            return;
        }
        opening.current = true;
        setDocumentationStatus('Opening documentation…');
        void openDocumentation('https://docs.themistic.com' + documentationPath).then(function (opened) {
            opening.current = false;
            if (!active.current) {
                return;
            }
            if (!opened) {
                setDocumentationStatus('Could not open browser. Press F1 to retry.');
                return;
            }
            setDocumentationStatus('Sent to browser. Press F1 to open again.');
        });
    });
    useEffect(function () {
        var onResize = function () {
            setSize(process.stdout.columns + 'x' + process.stdout.rows);
        };
        process.stdout.on('resize', onResize);
        return function () {
            active.current = false;
            process.stdout.off('resize', onResize);
        };
    }, []);

    var CLEAR_SCREEN = '\u001b[H\u001b[2J';
    var HIDE_CURSOR = '\u001b[?25l';
    var SHOW_CURSOR = '\u001b[?25h';
    var dimensions = setupDimensions();
    var columns = dimensions.columns;
    var rows = dimensions.rows;
    if (dimensions.tooSmall) {
        var notice = 'Enlarge terminal to ' + MIN_COLUMNS + ' × ' + MIN_ROWS + '.';
        return [HIDE_CURSOR + CLEAR_SCREEN + notice.slice(0, Math.max(1, columns - 1)), ''];
    }
    var width = dimensions.contentWidth;
    var screen = CLEAR_SCREEN + dimensions.headerText;
    var cursor = HIDE_CURSOR;
    if (inputCursor) {
        cursor = SHOW_CURSOR;
    }
    screen = cursor + screen;
    screen += '  ' + style(setupLayout.title.slice(0, width), 'strong') + '\n';
    screen += '  ' + style(setupLayout.detail.slice(0, width), 'muted') + '\n';
    screen += '  ' + style('─'.repeat(width), 'divider') + '\n\n';
    screen += content;
    var bottom = error;
    var contentRows = screen.split('\n').length;
    var errorRows = 0;
    if (error) {
        errorRows = error.split('\n').length;
    }
    var padding = Math.max(0, rows - contentRows - errorRows - FOOTER_ROWS - TERMINAL_BOTTOM_MARGIN_ROWS);
    bottom += '\n'.repeat(padding);
    bottom += style(setupLayout.footer.slice(0, columns - 1), 'muted');
    var documentationHint = documentationStatus || 'Press F1 to open documentation';
    bottom += '\n' + style(documentationHint.slice(0, columns - 1), 'muted');
    return [screen, bottom];
}
