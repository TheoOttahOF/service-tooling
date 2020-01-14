import {join} from 'path';

/**
 * Cached root directory
 */
let rootDirectory: string|null = null;

/**
 * Returns the root directory of the service-tooling module.
 */
export function getModuleRoot() {
    if (rootDirectory) {
        return rootDirectory;
    }

    // At time of writing this, the utils folder which this resides is one above root.
    rootDirectory = join(`${__dirname}`, '..');

    return rootDirectory;
}
