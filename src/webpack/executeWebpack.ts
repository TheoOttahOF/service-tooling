import * as path from 'path';

import {RequestHandler} from 'express-serve-static-core';
import * as webpack from 'webpack';
import {Configuration, Stats} from 'webpack'; // eslint-disable-line no-duplicate-imports
import * as webpackDevMiddleware from 'webpack-dev-middleware';

import {WebpackMode} from '../types';
import {getRootDirectory} from '../utils/getRootDirectory';

/**
 * Executes Webpack.  Doubles as express-compatible middleware function to serve webpack modules.
 *
 * Wrapper will immediately terminate the server if the initial build fails.
 *
 * This is a wrapper around the webpack-dev-middleware utility.
 */
export async function executeWebpack(mode: WebpackMode, writeToDisk: boolean): Promise<RequestHandler> {
    return new Promise<RequestHandler>((resolve) => {
        // Load config and set development mode
        const config: Configuration|Configuration[] = require(`${getRootDirectory()}/webpack.config.js`);

        // Ensure 'mode' is set on all entry points
        if (Array.isArray(config)) {
            config.forEach((entry: Configuration) => {
                entry.mode = (entry.mode || mode);
            });
        } else {
            config.mode = (config.mode || mode);
        }

        // Webpack can be invoked with one or multiple config objects, but TypeScript gets confused by the use of a
        // union type for `config`, requiring a cast.
        const compiler: webpack.ICompiler = webpack(config as Configuration);

        // Create express middleware
        const middleware = webpackDevMiddleware(compiler, {publicPath: '/', writeToDisk});

        // Wait until initial build has finished before starting application
        const startTime = Date.now();
        middleware.waitUntilValid((result: Stats | {stats: Stats[]}) => {
            // Output build times
            let buildTimes: string;
            let hasError: boolean = false;
            if (isSingleResult(result)) {
                const component = path.relative(getRootDirectory(), result.compilation.outputOptions.path);
                buildTimes = `${component}: ${(result.endTime!.valueOf() - result.startTime!.valueOf()) / 1000}s`;
                hasError = result.compilation.errors.length > 0;
            } else {
                buildTimes = result.stats.map((stat) => {
                    hasError = hasError || stat.compilation.errors.length > 0;

                    const component = path.relative(getRootDirectory(), stat.compilation.outputOptions.path);
                    return `${component}: ${(stat.endTime!.valueOf() - stat.startTime!.valueOf()) / 1000}s`;
                }).join('\n    ');
            }
            console.log(`\nInitial build complete after ${(Date.now() - startTime) / 1000} seconds\n    ${buildTimes}\n`);

            // Check build status
            if (hasError) {
                console.error('Build failed. See output above.');
                process.exit(1);
            } else {
                resolve(middleware);
            }
        });
    });
}

function isSingleResult(results: Stats | {stats: Stats[]}): results is Stats {
    return !results.hasOwnProperty('stats');
}
