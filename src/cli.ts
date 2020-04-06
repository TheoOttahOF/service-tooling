#!/usr/bin/env node
import * as childprocess from 'child_process';
import * as path from 'path';

import * as program from 'commander';
import * as fs from 'fs-extra';

import {createAsar} from './scripts/createAsar';
import {createProviderZip} from './scripts/createProviderZip';
import {createRuntimeChannels} from './scripts/createRuntimeChannels';
import {startServer, createServer, startApplication, createDefaultMiddleware} from './server/server';
import {runIntegrationTests, runUnitTests} from './testing/runner';
import {CLIArguments, BuildCommandArgs, CLITestArguments, JestMode} from './types';
import {allowHook, Hook, loadHooks} from './utils/allowHook';
import {getModuleRoot} from './utils/getModuleRoot';
import {getProjectConfig} from './utils/getProjectConfig';
import {getRootDirectory} from './utils/getRootDirectory';
import {executeAllPlugins} from './webpack/plugins/pluginExecutor';
import {executeWebpack} from './webpack/executeWebpack';
import {prepareRuntime} from './utils/runtime';

// Load hooks (if any)
loadHooks();

const defaultStartArgs: Required<CLIArguments> = {
    providerVersion: 'local',
    asar: false,
    mode: 'development',
    demo: true,
    static: false,
    write: false,
    runtime: '',
    platform: false,

    // Hooks can selectively override the above defaults. CLI args will still take precedence.
    ...allowHook(Hook.DEFAULT_ARGS, {})()
};

const version = require(path.resolve(getRootDirectory(), 'package.json')).version;

program.version(version);

function asBoolean(value: string, previous: boolean) {
    if (value === '0' || value === 'false' || value === 'off' || value === 'no') {
        return false;
    } else if (value === '1' || value === 'true' || value === 'on' || value === 'yes') {
        return true;
    } else {
        throw new Error(`Not a valid value: ${value}, only boolean values are allowed`);
    }
}

/**
 * Start command
 */
program.command('start')
    .description('Builds and runs a demo app, for testing service functionality.')
    .option(
        '-v, --providerVersion <version>',
        'Sets the version of the provider to use.  Options: local | staging | stable | x.y.z',
        defaultStartArgs.providerVersion
    )
    .option('-a, --asar [enabled]', 'Starts the provider from an ASAR, rather than as a desktop service', asBoolean, defaultStartArgs.asar)
    .option(
        '-r, --runtime <version>',
        'If specified, will override the runtime version of every manifest within the project.  Options: stable | alpha | beta | canary | w.x.y.z'
    )
    .option('-m, --mode <mode>', 'Sets the webpack mode.  Options: development | production | none', defaultStartArgs.mode)
    .option('-p, --platform [enabled]', 'Run the application in a platform window.', asBoolean, defaultStartArgs.platform)
    .option('-d, --demo [enabled]', 'Determines if the demo app will be launched once the local server is running', asBoolean, defaultStartArgs.demo)
    .option('-s, --static [enabled]', 'Launches the server and application using pre-built files', asBoolean, defaultStartArgs.static)
    .option('-w, --write [enabled]', 'Writes the built files to disk', asBoolean, defaultStartArgs.write)
    .action(startCommandProcess);

/**
 * Build command
 */
program.command('build')
    .description('Builds the project and writes output to disk, will simultaneously build client, provider and demo app.')
    .action(buildCommandProcess)
    .option('-m, --mode <mode>', 'Sets the webpack build mode.  Defaults to "production". Options: development | production | none', 'production');

/**
 * Create Runtime channels
 */
program.command('channels')
    .description('Creates additional provider manifests that will run the provider on specific runtime channels.')
    .action(createRuntimeChannels);

/**
 * Zip command
 */
program.command('zip')
    .description('Creates a zip file that contains the provider source code and resources. Can be used to re-deploy the provider internally.')
    .action(createProviderZip);

/**
 * Asar command
 */
program.command('asar')
    .description('Creates an asar file that contains the provider source code and resources, and client api js file.')
    .action(createAsar);

/**
 * ESLint Check
 */
program.command('check')
    .description('Checks the project for linting issues.')
    .option('-c, --noCache', 'Disables eslint caching', false)
    .action((args: {noCache: boolean}) => {
        runEsLintCommand(false, args.noCache === undefined ? true : false);
    });

/**
 * ESLint Fix
 */
program.command('fix')
    .description('Checks the project for linting issues, and fixes issues wherever possible.')
    .option('-c, --noCache', 'Disables eslint caching', false)
    .action((args: {noCache: boolean}) => {
        runEsLintCommand(true, args.noCache === undefined ? true : false);
    });

/**
 * Typedoc command
 */
program.command('docs')
    .description('Generates typedoc for the project using the standardized theme.')
    .action(generateTypedoc);

/**
 * Jest commands
 */
program.command('test <type>')
    .description('Runs all jest tests for the provided type.  Type may be "int" or "unit".\
\
Note: The --asar, --static and --runtime arguments apply only to integration tests.')
    .option('-a, --asar [enabled]', 'Starts the provider from an ASAR, rather than as a desktop service', asBoolean, true)
    .option(
        '-r, --runtime <version>',
        'If specified, will override the runtime version of every manifest within the project.  Options: stable | alpha | beta | canary | w.x.y.z'
    )
    .option('-m, --mode <mode>', 'Sets the webpack mode.  Options: development | production | none', 'development')
    .option('-s, --static', 'Launches the server and application using pre-built files.', true)
    .option('-n, --fileNames <fileNames...>', 'Runs all tests in the given file.')
    .option('-f, --filter <filter>', 'Only runs tests whose names match the given pattern.')
    .option('-x, --extraArgs <extraArgs...>', 'Any extra arguments to pass on to jest')
    .option('-c, --noColor', 'Disables the color for the jest terminal output text', true)
    .action(startTestRunner);

/**
 * Executes plugins
 */
program.command('plugins [action]')
    .description('Executes all runnable plugins with the supplied action')
    .action(startPluginExecutor);

/**
 * Process CLI commands
 */
program.parse(process.argv);

// If program was called with no arguments, show help
if (program.args.length === 0) {
    program.help();
}

function startPluginExecutor(action?: string): Promise<void> {
    return executeAllPlugins(action);
}

/**
 * Applies any user-provided arguments on top of the default arguments for each CLI command.
 *
 * It is important that the given `defaultArgs` value includes entries for every argument, even if those arguments are
 * optional.
 *
 * @param defaultArgs Hard-coded default arguments for the current command
 * @param args User-provided CLI args
 */
function applyCLIArgs<T>(defaultArgs: Required<T>, args: Partial<T>): T {
    const parsedArgs = {...defaultArgs};
    const argList = Object.keys(parsedArgs) as (keyof T)[];
    argList.forEach(<K extends keyof T>(key: K) => {
        if (args.hasOwnProperty(key)) {
            parsedArgs[key] = args[key]!;
        }
    });

    return parsedArgs;
}

/**
 * Initiator for the jest int/unit tests
 */
async function startTestRunner(type: JestMode, args: CLITestArguments): Promise<void> {
    const {IS_SERVICE, RUNTIME_INJECTABLE} = getProjectConfig();
    const parsedArgs = applyCLIArgs<CLITestArguments>({
        providerVersion: 'testing',
        asar: IS_SERVICE && !!RUNTIME_INJECTABLE, // Default to using the asar method when available, as this method is more representative of normal usage
        mode: 'development',
        demo: false,
        static: false,
        write: true,
        platform: false,
        filter: '',
        fileNames: '',
        runtime: '',
        noColor: false,
        extraArgs: ''
    }, args);
    const jestArgs: string[] = [];

    // Pushes in the colors argument if requested
    if (!parsedArgs.noColor) {
        jestArgs.push('--colors');
    }

    // Pushes in any file names provided
    if (parsedArgs.fileNames) {
        const fileNames = parsedArgs.fileNames.split(' ').map((testFileName) => `${testFileName}.${type}test.ts`);
        jestArgs.push(...fileNames);
    }

    // Pushes in the requested filter
    if (parsedArgs.filter) {
        jestArgs.push(`--testNamePattern=${parsedArgs.filter}`);
    }

    // Adds any extra arguments to the end
    if (parsedArgs.extraArgs) {
        const extraArgs = parsedArgs.extraArgs.split(' ');
        jestArgs.push(...extraArgs);
    }

    if (type === 'int') {
        runIntegrationTests(jestArgs, parsedArgs);
    } else if (type === 'unit') {
        runUnitTests(jestArgs);
    } else {
        console.log('Invalid test type.  Use "int" or "unit"');
    }
}

/**
 * Starts the build + server process, passing in any provided CLI arguments
 */
async function startCommandProcess(args: CLIArguments): Promise<void> {
    const parsedArgs = applyCLIArgs<CLIArguments>(defaultStartArgs, args);

    if (args.asar && !(args.static || args.write)) {
        console.log('Enabling --write, to speed-up ASAR creation');
        parsedArgs.write = true;
    }

    const server = await createServer();
    await allowHook(Hook.APP_MIDDLEWARE)(server, parsedArgs);
    await createDefaultMiddleware(server, parsedArgs);
    await startServer(server);
    await prepareRuntime(parsedArgs);
    startApplication(parsedArgs);
}

/**
 * Initiates a webpack build for the extending project
 */
async function buildCommandProcess(args: BuildCommandArgs): Promise<void> {
    const parsedArgs = applyCLIArgs<BuildCommandArgs>({
        mode: 'production'
    }, args);

    await executeWebpack(parsedArgs.mode, true);
    process.exit(0);
}

/**
 * Executes ESlint, optionally executing the fix flag.
 */
function runEsLintCommand(fix: boolean, cache: boolean): void {
    const eslintCmd = path.resolve('./node_modules/.bin/eslint');
    const eslintConfig = path.join(getModuleRoot(), '/.eslintrc.json');
    const cmd = `"${eslintCmd}" src test --ext .ts --ext .tsx ${fix ? '--fix' : ''} ${cache ? '--cache' : ''} --config "${eslintConfig}"`;
    childprocess.execSync(cmd, {stdio: 'inherit'});
}

/**
 * Generates typedoc
 */
function generateTypedoc(): void {
    const docsHomePage = path.resolve('./docs/DOCS.md');
    const readme = fs.existsSync(docsHomePage) ? docsHomePage : 'none';
    const config = getProjectConfig();
    const [typedocCmd, themeDir, outDir, tsConfig] = [
        './node_modules/.bin/typedoc',
        `${getModuleRoot()}/typedoc-template`,
        './dist/docs/api',
        './src/client/tsconfig.json'
    ].map((filePath) => path.resolve(filePath));
    const cmd = [
        `"${typedocCmd}"`,
        `--name "OpenFin ${config.TITLE}"`,
        `--theme "${themeDir}"`,
        `--out "${outDir}"`,
        `--tsconfig "${tsConfig}"`,
        `--readme ${readme}`,
        '--excludeNotExported --excludePrivate --excludeProtected --hideGenerator'
    ].join(' ');
    childprocess.execSync(cmd, {stdio: 'inherit'});
}
