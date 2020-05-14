import {existsSync} from 'fs';
import {join, resolve} from 'path';

import fetch from 'node-fetch';

import {getProjectConfig, Config} from './getProjectConfig';
import {getRootDirectory} from './getRootDirectory';
import {replaceUrlParams} from './url';

const urlCache: {[provider: string]: string} = {};

/**
 * Returns an absolute path to the provider's manifest.
 *
 * This is the local file within the project codebase, use {@link getProviderUrl} to get a reference to the provider
 * manifest that is usable within a manifest or from a fetch.
 */
export function getProviderPath(): string {
    const {IS_SERVICE} = getProjectConfig();
    const manifestPath = IS_SERVICE ? './res/provider/app.json' : './res/app.json';

    return resolve(getRootDirectory(), manifestPath);
}

/**
 * Returns the URL of the manifest file for the requested version of the service.
 *
 * @param version Version number of the service, or a channel
 * @param manifestUrl The URL that was set in the application manifest (if any). Any querystring arguments will be persisted, but the rest of the URL will be ignored.
 */
export function getProviderUrl(version: string, manifestUrl?: string): string {
    let url: string = urlCache[version];

    if (!url) {
        const {PORT, CDN_LOCATION} = getProjectConfig();
        const overrideArgs: Partial<Config> = {};

        if (version === 'local') {
            const demoProviderResponse = existsSync(join(getRootDirectory(), 'res/demo/provider.json'));

            if (demoProviderResponse) {
                url = `http://localhost:${PORT}/demo/provider.json`;
            } else {
                url = `http://localhost:${PORT}/provider/app.json`;
            }
        } else if (version === 'stable') {
            // Use the latest stable version
            url = `${CDN_LOCATION}/app.json`;
            overrideArgs.VERSION = '';
        } else if (version === 'staging') {
            // Use the latest staging build
            url = `${CDN_LOCATION}/app.staging.json`;
            overrideArgs.VERSION = '';
        } else if (version === 'testing') {
            // Use the optional testing provider if exists.
            const testingProviderResponse = existsSync(join(getRootDirectory(), 'res/test/provider.json'));

            if (testingProviderResponse) {
                url = `http://localhost:${PORT}/test/provider.json`;
            } else {
                url = `http://localhost:${PORT}/provider/app.json`;
            }
        } else if (version.indexOf('://') > 0) {
            // Looks like an absolute URL to an app.json file
            url = version;
        } else if (/\d+\.\d+\.\d+/.test(version)) {
            // Use a specific public release of the service
            url = `${CDN_LOCATION}/app.json`;
            overrideArgs.VERSION = version;
        } else {
            throw new Error(`Not a valid version number or channel: ${version}`);
        }

        // Apply template params
        url = replaceUrlParams(url, overrideArgs);

        // Cache URL, to avoid duplicate filesystem reads/regexes/etc
        urlCache[version] = replaceUrlParams(url);
    }

    // Preserve any query args from the input manifestUrl (if specified)
    const index = (manifestUrl && manifestUrl.indexOf('?')) || -1;
    const query = index >= 0 ? manifestUrl!.substr(index) : '';
    return `${url}${query}`;
}

export async function getManifest(manifestUrl: string): Promise<any> {
    const fetchRequest = await fetch(manifestUrl).catch((err: string) => {
        throw new Error(err);
    });

    if (fetchRequest.status === 200) {
        return fetchRequest.json();
    } else {
        throw new Error(`Invalid response from server: Status code: ${fetchRequest.status}`);
    }
}
