import * as path from 'path';

import {CLIArguments} from '../types';

import {getProjectConfig} from './getProjectConfig';
import {getJsonFileSync} from './getJsonFile';
import {getProviderPath, getProviderUrl} from './manifest';
import {ClassicManifest, PlatformManifest, ServiceDeclaration} from './manifests';
import {isRuntimeInstalled, mapRuntimeVersion, resolveRuntimeVersion} from './runtime';
import {replaceUrlParams} from './url';

let providerRuntime: string;

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
 * Applications using a RUNTIME_INJECTION-enabled service may declare extra paramters in their startup_app definition.
 *
 * The naming of these parameters are service-specific:
 * - <NAME>Api: boolean
 *   This option enables the injection of the service client into the windows of this application.
 * - <NAME>Config: object (service-specific configuration object)
 *   An optional object that contains service-specific configuration data. This is equivilant to the 'config' property
 *   within existing service declarations.
 * - <NAME>Manifest: string (Manifest URL)
 *   An undocumented property for internal use only. Specifies the URL to a manifest file, which the service provider
 *   will use as if it were its own. Applies only to the loading of desktop-level config data.
 */
type StartupAppWithInjection = ClassicManifest['startup_app'] & {[key: string]: any};

/**
 * Reads the given application manifest, and transforms it given the current project config and CLI args.
 *
 * @param configPath Path to an app.json file, must be a local file not a URL
 * @param context Determines how CDN urls are handled, see {@link RewriteContext}
 * @param args The subset of CLI args that require manifest overrides, these will be applied to any manifests processed by this middleware
 */
export async function getManifest(
    configPath: string,
    context: RewriteContext,
    args: Pick<Partial<CLIArguments>, 'providerVersion' | 'asar' | 'runtime'> = {}
): Promise<ClassicManifest> {
    const {providerVersion, asar, runtime} = {providerVersion: 'default', asar: false, runtime: '', ...args};
    const {PORT, NAME, CDN_LOCATION, IS_SERVICE, RUNTIME_INJECTABLE} = getProjectConfig();
    let runtimeVersion = runtime;

    const component = IS_SERVICE ? `/${configPath.split('/')[0]}` : '';  // client, provider or demo
    const baseUrl = context === RewriteContext.DEBUG ? `http://localhost:${PORT}${component}` : CDN_LOCATION;
    const config: ClassicManifest | void = getJsonFileSync<ClassicManifest>(path.resolve('res', configPath));

    if (!config || !config.startup_app) {
        throw new Error(`${configPath} is not an app manifest`);
    }

    const serviceDefinition = (config.services || []).find((service) => service.name === NAME);
    const {startup_app: startupApp, shortcut} = config;

    // Handle mapping of runtime versions, when using runtime injection
    if (asar) {
        // Get required runtime version (from either CLI or manifest), and resolve any release channels
        runtimeVersion = runtimeVersion || config.runtime.version;
        runtimeVersion = await resolveRuntimeVersion(runtimeVersion);

        // Need to tweak the version if there's a "--runtime" override, or this is the same runtime as the provider
        if (runtime || runtimeVersion === getProviderRuntime()) {
            // Will need to run on a custom runtime version for ASAR to contain the latest provider code
            runtimeVersion = mapRuntimeVersion(runtimeVersion);

            // Warn if runtime isn't installed
            if (!isRuntimeInstalled(runtime)) {
                console.warn(`Creating a manifest that uses runtime ${runtime}, but that runtime is not currently installed`);
            }
        }
    }

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
    if (serviceDefinition) {
        if (asar) {
            if (!RUNTIME_INJECTABLE) {
                throw new Error('"--asar" can only be used if the RUNTIME_INJECTABLE config option is set within services.config.json');
            }

            // Replace service declaration with '<NAME>Api' flag
            annotateAppWithService(startupApp, serviceDefinition, providerVersion);

            if (config.services!.length === 1) {
                delete config.services;
            } else {
                config.services = config.services!.filter((service) => service.name !== NAME);
            }
        } else {
            // Replace provider manifest URL with the requested version
            serviceDefinition.manifestUrl = getProviderUrl(providerVersion, serviceDefinition.manifestUrl);
        }
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

export function annotateAppWithService(application: ClassicManifest['startup_app'], service: ServiceDeclaration, providerVersion: string): void {
    const {NAME} = getProjectConfig();
    const injectableApp: StartupAppWithInjection = application;

    injectableApp[`${NAME}Api`] = true;
    if (service.config) {
        injectableApp[`${NAME}Config`] = service.config;
    }
    if (!['default', 'stable'].includes(providerVersion)) {
        injectableApp[`${NAME}Manifest`] = getProviderUrl(providerVersion, service.manifestUrl);
    }
}

function getProviderRuntime(): string {
    if (!providerRuntime) {
        const providerManifest: ClassicManifest = getJsonFileSync(getProviderPath());
        providerRuntime = providerManifest.runtime.version;
    }

    return providerRuntime;
}
