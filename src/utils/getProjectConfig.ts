import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {getRootDirectory} from './getRootDirectory';

/**
 * Shape of the configuration file which is implemented in an extending project.
 */
interface ConfigFile {
    /**
     * The "clean" name of this project, all lower-case and with no special characters.
     *
     * This is used as the name of the exported NPM module, JS script, CDN upload directory, and so on.
     */
    NAME: string;

    /**
     * Human-readable equivilant of `NAME`, allows the use of mixed-case and filesystem-reserved characters.
     */
    TITLE: string;

    /**
     * The port that the local development server will run on, when running `npm start`
     */
    PORT: number;

    /**
     * The location on the CDN where this project is uploaded to when deployed. Within manifests and any other files
     * that require absolute URLs, these should always reference the deployed location of the target. When debugging
     * locally, there will be a middleware on the local server that maps these URLs to their locally-hosted
     * equivalents. The value of this property controls which URLs get re-mapped.
     *
     * This should be the externally-facing URL, rather than the internal AWS bucket URL.
     */
    CDN_LOCATION: string;

    /**
     * Indicates if this service supports runtime injection - meaning that this is a service that can be started via
     * ASAR by the runtime. This replaces the RVM-managed service model (though that method is still supported).
     *
     * This option is required in order to use the --asar option on the 'npm start' and 'npm run test' commands. Do not
     * use this parameter to control the startup method on a case-by-case basis, use the --asar argument for that
     * (which is supported by both 'start' and 'test int').
     *
     * When enabled, three additional parameters are supported within the 'startup_app' section of a manifest. Each is prefixed
     */
    RUNTIME_INJECTABLE?: boolean;

    /**
     * The manifest to use when starting the application. Allows overriding of the demo app manifest location.
     *
     * This is the manifest that is launched when running `npm start`.
     */
    MANIFEST?: string;
}

export interface Config extends ConfigFile {
    /**
     * Indicates if the current project is a Desktop Service (true), or a standalone Application (false). Services have
     * a more complex folder structure, due to their multiple components.
     *
     * This is not specified explicitly in a config file, rather it is inferred from the name of the config file used
     * by the project. See the README for more information.
     */
    IS_SERVICE: boolean;

    /**
     * The current version number of the project/service.
     *
     * This will be populated with the version number in `package.json`, or can be overridden using the `VERSION`
     * environment variable.
     */
    VERSION: string;
}

/**
 * Given name for the project's local configuration file needed for our operations.
 *
 * The use of this filename indicates that the project is a Desktop Service.
 */
const CONFIG_FILE_PATH_SERVICE = './services.config.json';

/**
 * Given name for the project's local configuration file needed for our operations.
 *
 * The use of this filename indicates that the project is a stand-alone application.
 */
const CONFIG_FILE_PATH_PROJECT = './project.config.json';

let config: Config;

/**
 * Returns the config json for the extending project.
 */
export function getProjectConfig<T extends Config = Config>(): Readonly<T> {
    if (config) {
        return config as T;
    }

    // Check that the file exists locally
    let configPath: string;
    let isService: boolean;
    if (existsSync(CONFIG_FILE_PATH_SERVICE)) {
        configPath = CONFIG_FILE_PATH_SERVICE;
        isService = true;
    } else if (existsSync(CONFIG_FILE_PATH_PROJECT)) {
        configPath = CONFIG_FILE_PATH_PROJECT;
        isService = false;
    } else {
        throw new Error(`Config file not found in project root.  Please check either ${CONFIG_FILE_PATH_SERVICE} or ${CONFIG_FILE_PATH_PROJECT} exists.`);
    }

    // Parse config
    try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
        throw new Error(`Error parsing ${configPath}, check JSON is valid`);
    }

    // Check for required properties
    const missingProperties = ['NAME', 'TITLE', 'PORT', 'CDN_LOCATION'].filter((prop) => {
        return !config.hasOwnProperty(prop);
    });
    if (missingProperties.length > 0) {
        throw new Error(`Couldn't find one or more required properties in config file: ${missingProperties.join(', ')} (${configPath})`);
    }

    // Apply any user-specific overrides
    const userConfigPath: string = configPath.replace('.config.', '.user.');
    if (existsSync(userConfigPath)) {
        let userConfig;
        try {
            userConfig = JSON.parse(readFileSync(userConfigPath, 'utf8'));
        } catch (e) {
            throw new Error(`Error parsing ${userConfigPath}, check JSON is valid`);
        }

        config = {...config, ...userConfig};
    }

    // Read project version
    config.VERSION = require(join(getRootDirectory(), 'package.json')).version;

    // Apply CLI/env overrides
    const {env} = process;
    const argList = Object.keys(config) as (keyof Config)[];
    argList.forEach(<K extends keyof Config>(key: K) => {
        if (env.hasOwnProperty(key)) {
            console.log(`Using ${key}:'${env[key]}' from environment vars`);

            // All parameters coming from 'env' will be strings, need to parse as correct type.
            // Will use the type of the default value to decide how to parse.
            config[key] = parseCLIArg(env[key]!, config[key]);
        }
    });

    config.IS_SERVICE = isService;
    return config as T;
}

function parseCLIArg<T>(input: string, defaultValue: T): T {
    // Handle specific special-case values
    if (input === 'null') {
        return null!;
    } else if (input === 'undefined') {
        return undefined!;
    }

    // Parse input according to the type of the default arg
    switch (typeof defaultValue) {
        case 'string':
            return input as unknown as T;
        case 'number':
        {
            const value = parseFloat(input);
            if (!isNaN(value)) {
                return value as unknown as T;
            }
            break;
        }
        case 'boolean':
        {
            const toLower = (input).toLowerCase();
            if (toLower === 'true' || toLower === 'false') {
                return (toLower === 'true') as unknown as T;
            }
            break;
        }
        case 'object':
            try {
                return JSON.parse(input);
            } catch (e) {
                // Handled below
            }
            break;
        default:
            // Can't pass options of this type via CLI
    }

    // Parsing failed
    console.warn(`  - Couldn't parse '${input}' as a ${typeof defaultValue}. Keeping existing value of ${defaultValue}.`);
    return defaultValue;
}
