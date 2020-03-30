import * as path from 'path';

import {getProjectConfig} from './getProjectConfig';
import {getJsonFileSync} from './getJsonFile';
import {getProviderUrl} from './getProviderUrl';
import {replaceUrlParams} from './url';
import {ClassicManifest, PlatformManifest} from './manifests';

export enum RewriteContext {
    /**
     * Manifest is being re-written by the locally-running debug server.
     *
     * Any references to the CDN location should be replaced with localhost URLs.
     */
    DEBUG,

    /**
     * Manifest is being prepared for upload as part of a build.
     *
     * Any string templates should be evaluated, to ensure all URLs within the manifest are correct.
     */
    DEPLOY
}

/**
 * Reads the given application manifest, and transforms it given the current project config and CLI args.
 *
 * @param configPath Path to an app.json file, must be a local file not a URL
 * @param context Determines how CDN urls are handled, see {@link RewriteContext}
 * @param providerVersion The requested provider version or service inclusion method
 * @param runtimeVersion An optional runtime version override
 */
export function getManifest(configPath: string, context: RewriteContext, providerVersion: string, runtimeVersion?: string): ClassicManifest {
    const {PORT, NAME, CDN_LOCATION, IS_SERVICE} = getProjectConfig();

    const component = IS_SERVICE ? `/${configPath.split('/')[0]}` : '';  // client, provider or demo
    const baseUrl = context === RewriteContext.DEBUG ? `http://localhost:${PORT}${component}` : CDN_LOCATION;
    const config: ClassicManifest | void = getJsonFileSync<ClassicManifest>(path.resolve('res', configPath));

    if (!config || !config.startup_app) {
        throw new Error(`${configPath} is not an app manifest`);
    }

    const serviceDefinition = (config.services || []).find((service) => service.name === NAME);
    const {startup_app: startupApp, shortcut} = config;

    // Edit manifest
    if (startupApp.url) {
        // Replace startup app with HTML served locally
        startupApp.url = replaceUrlParams(startupApp.url.replace(CDN_LOCATION, baseUrl));
    }
    if (startupApp.icon) {
        startupApp.icon = replaceUrlParams(startupApp.icon.replace(CDN_LOCATION, baseUrl));
    }
    if (shortcut && shortcut.icon) {
        shortcut.icon = replaceUrlParams(shortcut.icon.replace(CDN_LOCATION, baseUrl));
    }
    if (serviceDefinition && providerVersion !== 'default') {
        // Replace provider manifest URL with the requested version
        serviceDefinition.manifestUrl = getProviderUrl(providerVersion, serviceDefinition.manifestUrl);
    }
    if (runtimeVersion) {
        // Replace runtime version with one provided.
        config.runtime.version = runtimeVersion;
    }

    return config;
}

/**
 * Convert a Classic manifest into a Platform manifest.
 */
export function getPlatformManifest(manifest: ClassicManifest): PlatformManifest {
    const {uuid, name, url, icon = ''} = manifest.startup_app;

    const platformConfig: PlatformManifest = {
        licenseKey: manifest.licenseKey,
        platform: {
            uuid,
            applicationIcon: icon,
            // This should be false to hide the Platform provider
            autoShow: false,
            defaultWindowOptions: {
                contextMenu: true
            }
        },
        snapshot: {
            windows: [
                {
                    defaultWidth: manifest.startup_app.defaultWidth ?? 600,
                    defaultHeight: manifest.startup_app.defaultHeight ?? 600,
                    autoShow: manifest.startup_app.autoShow ?? true,
                    layout: {
                        content: [
                            {
                                type: 'stack',
                                content: [
                                    {
                                        type: 'component',
                                        componentName: 'view',
                                        componentState: {
                                            name,
                                            url
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                }
            ]
        },
        runtime: manifest.runtime,
        services: manifest.services

    };

    return platformConfig;
}

