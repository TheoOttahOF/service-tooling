import {existsSync, readFileSync} from 'fs';

/**
 * Shape of the configuration file which is implemented in an extending project.
 */
interface ConfigFile {
    NAME: string;
    TITLE: string;
    PORT: number;
    CDN_LOCATION: string;

    MANIFEST?: string;
}

export interface Config extends ConfigFile {
    IS_SERVICE: boolean;
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
