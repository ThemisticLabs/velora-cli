import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt, isEnterKey, useKeypress, useState } from '@inquirer/core';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

type Selection = {
    message: string;
    choices: { name: string; value: string; description?: string }[];
};

export default createPrompt<string, Selection>(function (config, done) {
    var [index, setIndex] = useState(0);
    useKeypress(function (key) {
        if (setupDimensions().tooSmall) {
            return;
        }
        if (isEnterKey(key)) {
            done(config.choices[index]!.value);
            return;
        }
        if (key.name === 'down') {
            setIndex(Math.min(config.choices.length - 1, index + 1));
        }
        if (key.name === 'up') {
            setIndex(Math.max(0, index - 1));
        }
    });
    var width = setupDimensions().contentWidth;
    var content = '';
    if (config.message) {
        for (var line of config.message.split('\n')) {
            while (line.length > width) {
                var endOfLine = line.lastIndexOf(' ', width);
                if (endOfLine < 1) {
                    endOfLine = width;
                }
                content += style(line.slice(0, endOfLine), 'strong') + '\n';
                line = line.slice(endOfLine).trimStart();
            }
            content += style(line, 'strong') + '\n';
        }
        content += '\n';
    }
    var MESSAGE_ROWS = content.split('\n').length - 1;
    var DESCRIPTION_ROWS = 2;
    var SCROLL_HINT_ROWS = 1;
    var capacity = Math.max(1, setupDimensions().contentRows - MESSAGE_ROWS - DESCRIPTION_ROWS - SCROLL_HINT_ROWS);
    var start = Math.max(0, index - capacity + 1);
    var end = Math.min(config.choices.length, start + capacity);
    for (var choiceIndex = start; choiceIndex < end; choiceIndex++) {
        var name = config.choices[choiceIndex]!.name.slice(0, width);
        if (choiceIndex === index) {
            content += style('› ' + name, 'accent') + '\n';
        } else {
            content += '  ' + name + '\n';
        }
    }
    var hint = '';
    if (start > 0) {
        hint = '↑ More above';
    }
    if (end < config.choices.length) {
        hint += '  ↓ More below';
    }
    content += style(hint, 'muted') + '\n';
    content += '\n' + style((config.choices[index]!.description || '').slice(0, width), 'muted');
    return useSetupScreen(content);
});
