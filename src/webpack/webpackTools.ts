import * as CopyWebpackPlugin from 'copy-webpack-plugin';
import * as webpack from 'webpack';

import {getProjectConfig} from '../utils/getProjectConfig';
import {getProjectPackageJson} from '../utils/getProjectPackageJson';

/**
 * Custom options which can be passed into webpack.
 */
export interface CustomWebpackOptions extends webpack.Options.Optimization {
    /**
     * If webpack should minify this module. Defaults to true.
     */
    minify?: boolean;
    /**
     * If the resulting module should inject itself into the window object to make itself
     * easily accessible within HTML. Defaults to false.
     *
     * Should be used in combination with the 'libraryName' option.
     */
    isLibrary?: boolean;
    /**
     * Sets the global variable name for the library on the window. Required to have 'isLibrary' enabled.
     */
    libraryName?: string;
    /**
     * Allows a custom output file name to be used instead of the default [name]-bundle.js
     */
    outputFilename?: string;
}

/**
 * Shared function to create a webpack config for an entry point
 */
export function createConfig(outPath: string, entryPoint: string | webpack.Entry, options: CustomWebpackOptions, ...plugins: webpack.Plugin[]) {
    const config: webpack.Configuration = {
        entry: entryPoint,
        optimization: {minimize: !options || options.minify !== false},
        output: {path: outPath, filename: `${options && options.outputFilename || '[name]-bundle'}.js`},
        resolve: {extensions: ['.ts', '.tsx', '.js']},
        /**
            Webpack will try and bundle fs but because it is node it flags an error of not found.
            We are ok to set it as empty as fs will never be used in a window context anyway.
            Roots from the spawn utils where context can change between windows and node.
         */
        node: {
            fs: 'empty'
        },
        module: {
            rules: [
                {test: /\.css$/, loader: 'style-loader'},
                {test: /\.css$/, loader: 'css-loader'},
                {test: /\.module.css$/, loader: 'css-loader', query: {modules: true, localIdentName: '[name]__[local]___[hash:base64:5]'}},
                {test: /\.(png|jpg|gif|otf|svg)$/, use: [{loader: 'url-loader', options: {limit: 8192}}]},
                {test: /\.tsx?$/, loader: 'ts-loader'}
            ]
        },
        plugins: []
    };

    if (options && options.isLibrary === true) {
        if (options.libraryName) {
            config.output!.library = options.libraryName;
        } else {
            config.output!.library = '[name]';
        }
        config.output!.libraryTarget = 'umd';
    }
    if (plugins && plugins.length) {
        config.plugins!.push.apply(config.plugins, plugins);
    }

    return config;
}

/**
 * Provider temporarily requires an extra plugin to override index.html within provider app.json
 * Will be removed once the RVM supports relative paths within app.json files
 */
export const manifestPlugin = (() => {
    const {SERVICE_NAME, PORT} = getProjectConfig();

    return new CopyWebpackPlugin([{
        from: './res/provider/app.json',
        to: '.',
        transform: (content) => {
            const config = JSON.parse(content.toString());

            if (typeof process.env.SERVICE_VERSION !== 'undefined' && process.env.SERVICE_VERSION !== '') {
                config.startup_app.url = `https://cdn.openfin.co/services/openfin/${SERVICE_NAME}/` + process.env.SERVICE_VERSION + '/provider.html';
                config.startup_app.autoShow = false;
            } else {
                config.startup_app.url = `http://localhost:${PORT}/provider/provider.html`;
            }

            return JSON.stringify(config, null, 4);
        }
    }]);
})();

/**
 * Replaces 'PACKAGE_VERSION' constant in source files with the current version of the service,
 * taken from the 'package.json' file.
 *
 * This embeds the package version into the source file as a string constant.
 */
export const versionPlugin = (() => {
    const PACKAGE_VERSION = getProjectPackageJson().version;

    return new webpack.DefinePlugin({PACKAGE_VERSION: `'${PACKAGE_VERSION}'`});
})();
