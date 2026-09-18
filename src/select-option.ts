import { createPrompt, isEnterKey, useKeypress, useState } from '@inquirer/core';
import useSetupScreen from './use-setup-screen.js';
import style from './style.js';

type Selection = {
    message: string;
    choices: { name: string; value: string; description?: string }[];
    loop?: boolean;
};

export default createPrompt<string, Selection>(function (config, done) {
    var [index, setIndex] = useState(0);
    useKeypress(function (key) {
        if (process.stdout.columns < 60 || process.stdout.rows < 20) {
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
    var width = Math.max(1, process.stdout.columns - 4);
    var content = style(config.message.slice(0, width), 'strong') + '\n\n';
    for (var choiceIndex = 0; choiceIndex < config.choices.length; choiceIndex++) {
        var name = config.choices[choiceIndex]!.name.slice(0, width);
        if (choiceIndex === index) {
            content += style('› ' + name, 'accent') + '\n';
        } else {
            content += '  ' + name + '\n';
        }
    }
    content += '\n' + style((config.choices[index]!.description || '').slice(0, width), 'muted');
    return useSetupScreen(content);
});
