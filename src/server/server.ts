import {platform} from 'os';

import * as express from 'express';
import {connect, launch} from 'hadouken-js-adapter';
import fetch from 'node-fetch';

import {CLIArguments} from '../types';
import {getProjectConfig} from '../utils/getProjectConfig';
import {getProviderUrl} from '../utils/getProviderUrl';
import {getRootDirectory} from '../utils/getRootDirectory';
import {executeWebpack} from '../webpack/executeWebpack';

import {createAppJsonMiddleware, createCustomManifestMiddleware} from './middleware';

/**
 * Creates an express instance.
 *
 * Wrapped in async to allow chaining of promises.
 */
export async function createServer() {
    return express();
}

/**
 * Adds the necessary middleware to the express instance
 *
 * - Will serve static resources from the 'res' directory
 * - Will serve application code from the 'src' directory
 *   - Uses webpack middleware to first build the application
 *   - Middleware runs webpack in 'watch' mode; any changes to source files will trigger a partial re-build
 * - Any 'app.json' files within 'res' are pre-processed
 *   - Will explicitly set the provider URL for the service
 */
export async function createDefaultMiddleware(app: express.Express, args: CLIArguments) {
    // Add special route for any 'app.json' files - will re-write the contents
    // according to the command-line arguments of this server
    app.use(/\/?(.*\.json)/, createAppJsonMiddleware(args.providerVersion, args.runtime));

    // Add endpoint for creating new application manifests from scratch.
    // Used within demo app for lauching 'custom' applications
    app.use('/manifest', createCustomManifestMiddleware());

    // Add route for code
    if (args.static) {
        // Run application using pre-built code (use 'npm run build' or 'npm run build:dev')
        app.use(express.static(`${getRootDirectory()}/dist`));
    } else {
        // Run application using webpack-dev-middleware. Will build app before launching, and watch
        // for any source file changes
        app.use(await executeWebpack(args.mode, args.writeToDisk));
    }

    // Add route for serving static resources
    app.use(express.static(`${getRootDirectory()}/res`));

    return app;
}

/**
 * Starts the express and returns the express instance.
 */
export async function startServer(app: express.Express) {
    const {PORT} = getProjectConfig();

    console.log('Starting application server...');
    return app.listen(PORT);
}

/**
 * Default for starting a project application.  This will wire up the close detection of applications as well.
 */
export async function startApplication(args: CLIArguments) {
    const {IS_SERVICE} = getProjectConfig();

    // Manually start service on Mac OS (no RVM support)
    if (IS_SERVICE && platform() === 'darwin') {
        console.log('Starting Provider for Mac OS');

        // Launch latest stable version of the service
        await launch({manifestUrl: getProviderUrl(args.providerVersion)}).catch(console.log);
    }

    // Launch application, if requested to do so
    if (!args.noDemo) {
        console.log('Launching application');

        const manifestUrl = getStartupManifest();
        if (IS_SERVICE) {
            // Launch demo app, terminate when the service closes
            startAppAndWait(manifestUrl, getProviderUrl(args.providerVersion));
        } else {
            // Launch app, terminate when it closes
            startAppAndWait(manifestUrl);
        }
    } else {
        console.log('Local server running');
    }
}

function getStartupManifest(): string {
    const {PORT, MANIFEST, IS_SERVICE} = getProjectConfig();

    if (!MANIFEST) {
        // No project-specific manifestUrl
        return IS_SERVICE ? `http://localhost:${PORT}/demo/app.json` : `http://localhost:${PORT}/app.json`;
    } else if (MANIFEST.includes('://')) {
        // Fully-qualified manifestUrl
        return MANIFEST;
    } else {
        // Prepend base URL to custom manifest path
        return `http://localhost:${PORT}${MANIFEST.startsWith('/') ? '' : '/'}${MANIFEST}`;
    }
}

/**
 * Starts up an application from a manifest, and will terminate the current node process
 * when the app with the given UUID exits.
 *
 * Note that the uuid doesn't necesserily need to be the UUID contained within the manifest.
 */
async function startAppAndWait(manifestUrl: string, exitManifestUrl?: string): Promise<void> {
    const {NAME} = getProjectConfig();

    exitManifestUrl = exitManifestUrl || manifestUrl;
    const fetchRequest = await fetch(exitManifestUrl).catch((err: string) => {
        throw new Error(err);
    });

    if (fetchRequest.status === 200) {
        const manifest = await fetchRequest.json();
        const uuid: string = manifest.startup_app.uuid;

        connect({uuid: `wrapper-${NAME}`, manifestUrl}).then(async (fin) => {
            const app = fin.Application.wrapSync({uuid});

            // Terminate local server when the provider closes
            app.addListener('closed', async () => {
                process.exit(0);
            }).catch(console.error);
        }, console.error);
    } else {
        throw new Error(`Invalid response from server: Status code: ${fetchRequest.status}`);
    }
}
