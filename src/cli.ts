#!/usr/bin/env node
import * as childprocess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

import * as program from 'commander';

import {startServer, createServer, startApplication, createDefaultMiddleware} from './server/server';
import {CLIArguments, BuildCommandArgs, CLITestArguments, JestMode} from './types';
import {createProviderZip} from './scripts/createProviderZip';
import {createRuntimeChannels} from './scripts/createRuntimeChannels';
import {executeWebpack} from './webpack/executeWebpack';
import {getProjectConfig} from './utils/getProjectConfig';
import {runIntegrationTests, runUnitTests} from './testing/runner';
import getModuleRoot from './utils/getModuleRoot';
import {executeAllPlugins} from './webpack/plugins/pluginExecutor';

/**
 * Start command
 */
program.command('start')
    .description('Builds and runs a demo app, for testing service functionality.')
    .option(
        '-v, --providerVersion <version>',
        'Sets the runtime version for the provider.  Defaults to "local". Options: local | staging | stable | x.y.z',
        'local'
    )
    .option('-r, --runtime <version>', 'Sets the runtime version.  Options: stable | w.x.y.z')
    .option('-m, --mode <mode>', 'Sets the webpack mode.  Defaults to "development".  Options: development | production | none', 'development')
    .option('-n, --noDemo', 'Runs the server but will not launch the demo application.', true)
    .option('-s, --static', 'Launches the server and application using pre-built files.', true)
    .option('-w, --writeToDisk', 'Writes and serves the built files from disk.', true)
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
 * ESLint Check
 */
program.command('check')
    .description('Checks the project for linting issues.')
    .action(() => {
        runEsLintCommand(false);
    });

/**
 * ESLint Fix
 */
program.command('fix')
    .description('Checks the project for linting issues, and fixes issues wherever possible.')
    .action(() => {
        runEsLintCommand(true);
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
    .description('Runs all jest tests for the provided type.  Type may be "int" or "unit"')
    .option('-r, --runtime <version>', 'Sets the runtime version.  Options: stable | w.x.y.z')
    .option('-e, --mode <mode>', 'Sets the webpack mode.  Defaults to "development".  Options: development | production | none', 'development')
    .option('-s, --static', 'Launches the server and application using pre-built files.', true)
    .option('-n, --fileNames <fileNames...>', 'Runs all tests in the given file.')
    .option('-f, --filter <filter>', 'Only runs tests whose names match the given pattern.')
    .option('-m, --customMiddlewarePath <path>', 'Path to a custom middleware js file.  Only applicable for Integration tests.')
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

function startPluginExecutor(action?: string) {
    return executeAllPlugins(action);
}

/**
 * Initiator for the jest int/unit tests
 */
function startTestRunner(type: JestMode, args: CLITestArguments) {
    const sanitizedArgs: CLITestArguments = {
        providerVersion: 'testing',
        noDemo: true,
        writeToDisk: args.static !== undefined && args.static ? false : true,
        mode: args.mode || 'development',
        static: args.static === undefined ? false : true,
        filter: args.filter ? `--testNamePattern=${args.filter}` : '',
        fileNames: args.fileNames && (args.fileNames as unknown as string).split(' ').map(testFileName => `${testFileName}.${type}test.ts`) || [],
        customMiddlewarePath: args.customMiddlewarePath && path.resolve(args.customMiddlewarePath) || undefined,
        runtime: args.runtime,
        noColor: args.noColor === undefined ? false : true,
        extraArgs: args.extraArgs && (args.extraArgs as unknown as string).split(' ') || []
    };

    const jestArgs = [];

    /**
     * Pushes in the colors argument if requested
     */
    if (!sanitizedArgs.noColor) {
        jestArgs.push('--colors');
    }

    /**
     * Pushes in any file names provided
     */
    if (sanitizedArgs.fileNames) {
        jestArgs.push(...sanitizedArgs.fileNames);
    }

    /**
     * Pushes in the requested filter
     */
    if (sanitizedArgs.filter) {
        jestArgs.push(sanitizedArgs.filter);
    }

    /**
     * Adds any extra arguments to the end
     */
    if (sanitizedArgs.extraArgs) {
        jestArgs.push(...sanitizedArgs.extraArgs);
    }

    if (type === 'int') {
        runIntegrationTests(jestArgs, sanitizedArgs);
    } else if (type === 'unit') {
        runUnitTests(jestArgs);
    } else {
        console.log('Invalid test type.  Use "int" or "unit"');
    }
}

/**
 * Starts the build + server process, passing in any provided CLI arguments
 */
async function startCommandProcess(args: CLIArguments) {
    const sanitizedArgs: CLIArguments = {
        providerVersion: args.providerVersion || 'local',
        mode: args.mode || 'development',
        noDemo: args.noDemo === undefined ? false : true,
        static: args.static === undefined ? false : true,
        writeToDisk: args.writeToDisk === undefined ? false : true,
        runtime: args.runtime
    };

    const server = await createServer();
    await createDefaultMiddleware(server, sanitizedArgs);
    await startServer(server);
    startApplication(sanitizedArgs);
}

/**
 * Initiates a webpack build for the extending project
 */
async function buildCommandProcess(args: BuildCommandArgs) {
    const sanitizedArgs = {mode: args.mode || 'production'};

    await executeWebpack(sanitizedArgs.mode, true);
    process.exit(0);
}

/**
 * Executes ESlint, optionally executing the fix flag.
 */
function runEsLintCommand(fix: boolean) {
    const eslintCmd = path.resolve('./node_modules/.bin/eslint');
    const eslintConfig = path.join(getModuleRoot(), '/.eslintrc.json');
    const cmd = `"${eslintCmd}" src test --ext .ts --ext .tsx ${fix ? '--fix' : ''} --config "${eslintConfig}"`;
    childprocess.execSync(cmd, {stdio: 'inherit'});
}

/**
 * Generates typedoc
 */
function generateTypedoc() {
    const docsHomePage = path.resolve('./docs/DOCS.md');
    const readme = fs.existsSync(docsHomePage) ? docsHomePage : 'none';
    const config = getProjectConfig();
    const [typedocCmd, themeDir, outDir, tsConfig] = [
        './node_modules/.bin/typedoc',
        `${getModuleRoot()}/typedoc-template`,
        './dist/docs/api',
        './src/client/tsconfig.json'
    ].map(filePath => path.resolve(filePath));
    const cmd = `"${typedocCmd}" --name "OpenFin ${config.SERVICE_TITLE}" --theme "${themeDir}" --out "${outDir}" --excludeNotExported --excludePrivate --excludeProtected --hideGenerator --tsconfig "${tsConfig}" --readme ${readme}`; // eslint-disable-line
    childprocess.execSync(cmd, {stdio: 'inherit'});
}
