import updatePreferences, { type CliUpdatePreferences } from './cli-update-preferences.js';
import dataDirectory from '../system/data-directory.js';

export default async function engineUpdatePreferences(preferences?: CliUpdatePreferences, directory = dataDirectory()) {
    return updatePreferences(preferences, directory, undefined, 'engine');
}
