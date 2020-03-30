import * as fs from 'fs';
import * as path from 'path';

import * as execa from 'execa';
import * as express from 'express';

import {CLIArguments} from '../types';

import {getRootDirectory} from './getRootDirectory';

type HookableFunction = (...args: any[]) => any;
const hooks: {[key: string]: HookableFunction} = {};

export enum Hook {
    /**
     * Register middleware with the 'npm start' server.
     *
     * Any middleware added via this hook will take precedence over the "built-in" middleware.
     */
    APP_MIDDLEWARE = 'APP_MIDDLEWARE',
    /**
     * Register middleware with the local server that runs during integration tests.
     *
     * Any middleware added via this hook will take precedence over the "built-in" middleware.
     */
    TEST_MIDDLEWARE = 'TEST_MIDDLEWARE',
    /**
     * Hook to override default values for the `npm start` CLI options.
     *
     * Note that using this hook may make some of the text in `npm start --help` inaccurate.
     */
    DEFAULT_ARGS = 'DEFAULT_ARGS'
}

export interface HooksAPI {
    [Hook.DEFAULT_ARGS]: () => Partial<CLIArguments>;
    [Hook.APP_MIDDLEWARE]: (app: express.Express, args: CLIArguments) => void;
    [Hook.TEST_MIDDLEWARE]: (app: express.Express) => void;
}

export function loadHooks(): void {
    const hooksPathSrc = path.resolve(getRootDirectory(), 'hooks.ts');
    const hooksPathOut = path.resolve(getRootDirectory(), 'hooks.js');
    if (fs.existsSync(hooksPathSrc)) {
        // Build hooks if first-run, or source was modified
        if (!fs.existsSync(hooksPathOut) || fs.statSync(hooksPathSrc).mtime > fs.statSync(hooksPathOut).mtime) {
            console.log('Building hooks...');
            try {
                execa.sync('tsc', [hooksPathSrc, '--outDir', path.dirname(hooksPathOut), '--moduleResolution', 'node'], {stdio: 'pipe'});
            } catch (e) {
                console.error(`Error building hooks:\n${e.stdout}`);

                // Ensure we don't attempt to use the malformed output on the next run
                if (fs.existsSync(hooksPathOut)) {
                    fs.unlinkSync(hooksPathOut);
                }

                process.exit(1);
            }
        }

        // Import hooks
        require(hooksPathOut);
        console.log('Loaded custom hooks');
    }
}

export function allowHook<K extends keyof HooksAPI, T extends HooksAPI[K]>(id: K, fallback?: T | ReturnType<T>): (...args: Parameters<T>) => ReturnType<T> {
    return hook.bind<null, typeof id, typeof fallback, Parameters<T>, ReturnType<T>>(null, id, fallback);
}

export function registerHook<T extends Hook>(id: T, callback: HooksAPI[T]): void {
    hooks[id] = callback;
}

/**
 * Checks for a registered hook of the given type. If found, will invoke and return result.
 *
 * Otherwise, will return the given fallback (either a value, or a function with the same signature as the hook). The
 * fallback argument is optional, as it is not required in cases where the hook has a void return type. The fallback
 * argument should always be used for non-void hooks.
 *
 * @param id Hook identifier
 * @param fallback The value to use (or a function that will return this value) when there is no hook registered
 * @param args Arguments to pass-through to the hook
 */
function hook<K extends keyof HooksAPI, T extends HooksAPI[K]>(id: K, fallback?: T | ReturnType<T>, ...args: Parameters<T>): ReturnType<T> {
    const callback: HookableFunction = hooks[id];

    if (callback) {
        return callback(...args);
    } else if (typeof fallback === 'function') {
        return (fallback as HookableFunction)(...args);
    } else if (fallback !== undefined) {
        return fallback;
    } else {
        // No hook registered, and no fallback value/callback specified.
        // This should only be used with hooks that have a 'void' return type.
        return undefined as ReturnType<T>;
    }
}
