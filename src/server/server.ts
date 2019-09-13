import {platform} from 'os';

import fetch from 'node-fetch';
import * as express from 'express';
import {connect, launch, Application} from 'hadouken-js-adapter';

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

    // Add route for serving static resources
    app.use(express.static(getRootDirectory() + '/res'));

    // Add route for code
    if (args.static) {
        // Run application using pre-built code (use 'npm run build' or 'npm run build:dev')
        app.use(express.static(getRootDirectory() + '/dist'));
    } else {
        // Run application using webpack-dev-middleware. Will build app before launching, and watch
        // for any source file changes
        app.use(await executeWebpack(args.mode, args.writeToDisk));
    }

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
    const {PORT} = getProjectConfig();
    // Manually start service on Mac OS (no RVM support)
    if (platform() === 'darwin') {
        console.log('Starting Provider for Mac OS');

        // Launch latest stable version of the service
        await launch({manifestUrl: getProviderUrl(args.providerVersion)}).catch(console.log);
    }

    // Launch application, if requested to do so
    if (!args.noDemo) {
        const manifestPath = 'demo/app.json';
        const manifestUrl = `http://localhost:${PORT}/${manifestPath}`;

        const demoFetchRequest = await fetch(manifestUrl);
        const serviceFetchRequest = await fetch(getProviderUrl(args.providerVersion)).catch((err: string) => {
            throw new Error(err);
        });

        if (serviceFetchRequest.status === 200 && demoFetchRequest.status === 200) {
            const demoManifest = await demoFetchRequest.json();
            const providerManifestContent = await serviceFetchRequest.json();
            console.log('Launching application');

            connect({uuid: 'wrapper', manifestUrl}).then(async fin => {
                const demo = fin.Application.wrapSync({uuid: demoManifest.startup_app.uuid, name: demoManifest.startup_app.name});
                const service =
                    fin.Application.wrapSync({uuid: `${providerManifestContent.startup_app.uuid}`, name: `${providerManifestContent.startup_app.name}`});

                // Terminate local server when the provider closes
                service
                    .addListener(
                        'closed',
                        async () => {
                            process.exit();
                        }
                    )
                    .catch(console.error);

                // Fix for Windows 10 not killing the demo apps on SIGINT
                const signals: ('exit' | NodeJS.Signals)[] = ['exit', 'SIGINT', 'SIGTERM'];
                signals.forEach((sig) => {
                    // @ts-ignore type error on exit
                    process.on(sig, () => cleanup([demo]));
                });

                process.stdin.resume();
            }, console.error);
        } else {
            throw new Error(`Invalid response from server:  Status code: ${serviceFetchRequest.status}`);
        }
    } else {
        console.log('Local server running');
    }
}

function cleanup(apps: Application[]) {
    Promise.all(apps.map(app => app.quit()))
        .then(() => {
            process.exit(0);
        })
        .catch();
}
