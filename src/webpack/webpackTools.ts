import * as CopyWebpackPlugin from 'copy-webpack-plugin';
import * as MiniCssExtractPlugin from 'mini-css-extract-plugin';
import * as webpack from 'webpack';
import * as ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

import {getManifest, RewriteContext} from '../utils/getManifest';
import {getRootDirectory} from '../utils/getRootDirectory';
import {getProjectConfig} from '../utils/getProjectConfig';
import {getProjectPackageJson} from '../utils/getProjectPackageJson';
import {getProviderPath} from '../utils/manifest';

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

    /**
     * Allows CSS to be extracted into a seperate file. If this is not specified, CSS will be bundled in the javascript bundle.
     */
    extractStyles?: boolean | string;
}

/**
 * Shared function to create a webpack config for an entry point
 */
export function createConfig(outPath: string, entryPoint: string | webpack.Entry, options?: CustomWebpackOptions, ...plugins: webpack.Plugin[]) {
    const extractCss = (options) ? !!options.extractStyles : false;
    const config: webpack.Configuration = {
        entry: entryPoint,
        optimization: {
            noEmitOnErrors: true,
            minimize: !options || options.minify !== false,
            removeAvailableModules: false,
            removeEmptyChunks: false,
            splitChunks: false
        },
        output: {pathinfo: false, path: outPath, filename: `${(options && options.outputFilename) || '[name]-bundle'}.js`},
        resolve: {extensions: ['.ts', '.tsx', '.js', '.scss']},
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
                {
                    test: /\.module\.(sc|sa|c)ss$/,
                    loader: [
                        finalCssLoader(extractCss),
                        {
                            loader: 'css-loader',
                            options: {
                                modules: true,
                                localIdentName: '[name]__[local]___[hash:base64:5]',
                                camelCase: true,
                                sourceMap: true
                            }
                        },
                        {
                            loader: 'sass-loader'
                        }
                    ]
                },
                {
                    test: /\.(sc|sa|c)ss$/,
                    exclude: /\.module.(s(a|c)ss)$/,
                    loader: [
                        finalCssLoader(extractCss),
                        'css-loader',
                        {
                            loader: 'sass-loader'
                        }
                    ]
                },
                {test: /\.(otf|ttf|woff2?)$/, use: [{loader: 'url-loader', options: {limit: 50000}}]},
                {test: /\.(png|jpg|gif|svg)$/, use: [{loader: 'url-loader', options: {limit: 8192}}]},
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                experimentalWatchApi: true
                            }
                        }
                    ]
                }
            ]
        },
        plugins: [
            new ForkTsCheckerWebpackPlugin({
                eslint: true,
                checkSyntacticErrors: true,
                async: false, // Don't build if error
                useTypescriptIncrementalApi: true,
                formatter: 'codeframe',
                typescript: require.resolve('typescript', {paths: [getRootDirectory()]})
            })
        ]
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

    if (extractCss) {
        const name = options!.extractStyles!;
        config.plugins!.push(new MiniCssExtractPlugin({
            filename: (typeof name === 'string') ? `${name}.css` : '[name].css'
        }));
    }

    return config;
}

/**
 * Provider temporarily requires an extra plugin to override index.html within provider app.json
 * Will be removed once the RVM supports relative paths within app.json files
 */
export const manifestPlugin = (() => {
    const {VERSION} = getProjectConfig();

    return new CopyWebpackPlugin([{
        from: getProviderPath(),
        to: '.',
        transform: (content, path) => {
            // Run the manifest through 'getManifest', to replace any ${} params
            const config = getManifest(path, RewriteContext.DEPLOY, {providerVersion: VERSION || 'default'});
            return JSON.stringify(config, null, 4);
        }
    }]);
})();

/**
 * Selects the way CSS should be bundled with the JS or extracted into a CSS file
 * @param extract if true the styles will be extracted.
 */
const finalCssLoader = (extract: boolean) => {
    const styleLoader = {
        loader: 'style-loader',
        options: {
            attributes: {id: 'stylesheet'},
            injectType: 'singletonStyleTag'
        }
    };

    return extract ? MiniCssExtractPlugin.loader : styleLoader;
};

/**
 * Replaces 'PACKAGE_VERSION' constant in source files with the current version of the service,
 * taken from the 'package.json' file.
 *
 * This embeds the package version into the source file as a string constant.
 */
export const versionPlugin = (() => {
    const PACKAGE_VERSION = process.env.SERVICE_VERSION || getProjectPackageJson().version;

    return new webpack.DefinePlugin({PACKAGE_VERSION: `'${PACKAGE_VERSION}'`});
})();
