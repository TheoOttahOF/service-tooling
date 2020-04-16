import * as path from 'path';
import * as os from 'os';

import {shell} from 'execa';
import * as fs from 'fs-extra';
import {connect} from 'hadouken-js-adapter';

import {CLIArguments} from '../types';

import {getProjectConfig} from './getProjectConfig';
import {getRootDirectory} from './getRootDirectory';
import {getProviderPath} from './manifest';
import {withTimeout} from './timeout';

const RELEASE_CHANNELS = ['stable', 'alpha', 'beta', 'canary', 'canary-next'];
const releaseChannelMappings: {[key: string]: string} = {};

/**
 * If using a runtime-injected service prepare an ASAR that contains the service, and create a custom version of the
 * runtime that contains that version of the service.
 *
 * @param args CLI arguments for start/test command
 */
export async function prepareRuntime(args: CLIArguments): Promise<void> {
    if (args.asar) {
        const {NAME} = getProjectConfig();

        if (args.static || args.write) {
            // Will still build ASAR even when using --static, as it's a quick operation.
            console.log('Building ASAR (from existing build)...');
            await shell('npm run asar', {cwd: getRootDirectory()});
        } else {
            console.log(`Building ASAR (${args.mode} mode)...`);
            await shell(`npm run build -m ${args.mode}`, {cwd: getRootDirectory()});
            await shell('npm run asar', {cwd: getRootDirectory()});
        }

        const runtime: string = args.runtime || require(getProviderPath()).runtime.version;
        const isChannel = isReleaseChannel(runtime);
        let runtimeVersion = runtime;

        if (isChannel || !isRuntimeInstalled(runtime)) {
            // Both of these branches perform the same action, but for different reasons. Handled separately to better explain what is happening.
            if (isChannel) {
                console.log(`Converting channel ${runtime} to build number`);
                const expectedLookupTimeMillis = 2500;
                runtimeVersion = await withTimeout(installRuntime(runtime), expectedLookupTimeMillis, (action) => {
                    // Log message to explain delay
                    console.log('Resolution is taking a while, runtime probably isn\'t installed...');

                    // Continue waiting for runtime
                    return action;
                });
                console.log(`Resolved ${runtime} to ${runtimeVersion}`);

                // Write the mapped runtime version back into CLI args, so it is available downstream
                args.runtime = runtimeVersion;
            } else {
                console.log(`Runtime ${runtime} not installed, starting download...`);
                runtimeVersion = await installRuntime(runtime);
                console.log(`Runtime ${runtime} installed.`);
            }
        }

        const customRuntime = mapRuntimeVersion(runtimeVersion);
        if (!isRuntimeInstalled(customRuntime)) {
            console.log(`Runtime ${customRuntime} not found, starting copy...`);

            // Create a copy of this runtime. We do not want to modify the original installation, to avoid breaking other apps.
            await fs.copy(getInstallDirectory(runtimeVersion), getInstallDirectory(customRuntime));
        }

        console.log(`Copying ASAR to ${customRuntime}`);
        const srcPath = path.join(getRootDirectory(), `dist/asar/${NAME}.asar`);
        const destPath = path.join(getInstallDirectory(customRuntime), `OpenFin/resources/${NAME}.asar`);
        fs.copyFileSync(srcPath, destPath);
    }
}

/**
 * Checks the given runtime version, to see if it is a named release channel.
 *
 * @param version Any valid runtime version or release channel
 */
export function isReleaseChannel(version: string): boolean {
    return RELEASE_CHANNELS.indexOf(version.toLowerCase()) >= 0 || /stable-v\d+/.test(version);
}

/**
 * Given a runtime version number (#.#.#.#) or channel name (stable, alpha, etc), will convert to a runtime version
 * number.
 *
 * Note: If the input is a release channel and that runtime is not currently installed, this function also has the
 * side-effect of installing that runtime on the machine. This means this function may take some time to complete.
 *
 * @param version Any valid runtime version or release channel
 */
export async function resolveRuntimeVersion(version: string): Promise<string> {
    if (!isReleaseChannel(version)) {
        return version;
    } else if (releaseChannelMappings.hasOwnProperty(version)) {
        return releaseChannelMappings[version];
    } else {
        const mappedVersion = await withTimeout(installRuntime(version), 1500, (action) => {
            // Log message to explain delay
            console.log('Resolution is taking a while, runtime probably isn\'t installed...');

            // Continue waiting for runtime
            return action;
        });
        releaseChannelMappings[version] = mappedVersion;

        return mappedVersion;
    }
}

/**
 * Given a valid runtime version number (NOT a release channel name), will return the version number that should be
 * used for the "custom" runtime version that has the service ASAR swapped-out.
 *
 * The convention used is to replace the first number of the runtime version with the port number used by the local
 * debug server. This results in a valid runtime number (#.#.#.# format), that is not going to clash with "vanilla"
 * runtimes, other custom runtimes associated with another service.
 *
 * @param version Any valid runtime version number
 */
export function mapRuntimeVersion(version: string): string {
    const {PORT} = getProjectConfig();
    return version.replace(version.split('.')[0], PORT.toString());
}

/**
 * Opens an adapter connection to the given runtime version. This will cause the RVM to download and install the
 * runtime, if it is not already installed.
 *
 * Will return the version number of the given runtime, as reported by the connection. This will typically be the same
 * string as the input argument, but will differ if `version` was the name of a release channel.
 *
 * @param version Any valid runtime version number or release channel
 */
export async function installRuntime(version: string): Promise<string> {
    // Do NOT use this util with "mapped" runtime versions - this results in a hang.
    // Should never happen, but adding explicit check as it is hard to track down if/when it does happen.
    const versionParts = version.split('.');
    if (versionParts.length === 4 && versionParts[0] === getProjectConfig().PORT.toString()) {
        throw new Error(`Must not use installRuntime with mapped runtime versions (attempted to install ${version})`);
    }

    // Use the JS adapter to start an application on this runtime, then immediately exit
    const connection = await connect({
        uuid: 'temp-app',
        runtime: {version}
    });
    const runtimeVersion = await connection.System.getVersion();
    await connection['wire'].wire.shutdown();

    return runtimeVersion;
}

/**
 * Checks if the given runtime version is installed, by looking for a corresponding folder within the runtime
 * installation directory.
 *
 * @param version Any valid runtime version number
 */
export function isRuntimeInstalled(version: string): boolean {
    let runtimeDirectory;

    try {
        runtimeDirectory = getInstallDirectory(version);
    } catch (e) {
        // Avoid a hard failure in these cases by just assuming runtime isn't installed, no harm in
        // calling `installRuntime` for an installed runtime.
        console.warn(`Error when determining if runtime ${version} is installed (${e?.message}) - will continue as if it is not installed`);
        return false;
    }

    return fs.existsSync(runtimeDirectory);
}

/**
 * Gets the DEFAULT install directory for the given OpenFin runtime version. This is the location where that runtime
 * version would be expected to exist - the specific runtime version may or may not be installed.
 *
 * Whilst the OpenFin install location can be overidden via DOS/registry, it is assumed that these tools will only be
 * ran on desktops that use the default install location.
 *
 * @param version Any valid runtime version number
 */
function getInstallDirectory(version: string): string {
    let dir;

    // TODO: Check mac/linux paths
    switch (os.platform()) {
        case 'cygwin':
        case 'win32':
            dir = process.env.LOCALAPPDATA;
            break;
        case 'darwin':
            dir = '~/Library/Application Support';
            break;
        default: // Linux
            dir = process.env.XDG_CONFIG_HOME || '~/.config';
            break;
    }

    if (!dir) {
        throw new Error('Install directory not known');
    }

    return path.join(dir, 'OpenFin/runtime', version);
}
