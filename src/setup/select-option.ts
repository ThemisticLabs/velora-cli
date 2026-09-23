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
