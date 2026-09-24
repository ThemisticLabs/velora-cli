import { isEnterKey, useKeypress, useState } from '@inquirer/core';
import setupDimensions from './setup-dimensions.js';

type Navigation = {
    values: string[];
    initialValue?: string;
    disabled?: boolean;
    activateWithSpace?: boolean;
    onSelect: (value: string) => void;
    onBack?: () => void;
};

export default function useListNavigation(config: Navigation): string {
    var initialIndex = config.values.indexOf(config.initialValue || '');
    var [index, setIndex] = useState(Math.max(0, initialIndex));
    var activeIndex = Math.min(index, config.values.length - 1);
    useKeypress(function (key) {
        if (key.name === 'escape') {
            config.onBack?.();
            return;
        }
        if (config.disabled || setupDimensions().tooSmall || activeIndex < 0) {
            return;
        }
        if (isEnterKey(key) || config.activateWithSpace && key.name === 'space') {
            config.onSelect(config.values[activeIndex]!);
            return;
        }
        if (key.name === 'down') {
            setIndex(Math.min(config.values.length - 1, activeIndex + 1));
        }
        if (key.name === 'up') {
            setIndex(Math.max(0, activeIndex - 1));
        }
    });
    return config.values[activeIndex] || '';
}
