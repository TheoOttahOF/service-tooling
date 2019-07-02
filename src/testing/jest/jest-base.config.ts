import {join} from 'path';
import {existsSync} from 'fs';

import {getRootDirectory} from '../../utils/getRootDirectory';
import {getJsonFileSync} from '../../utils/getJsonFile';
import {JestMode} from '../../types';

export function createConfig(testType: JestMode) {
    return {
        rootDir: getRootDirectory(),
        testURL: 'http://localhost/',
        globals: {
            'ts-jest': {
                'tsConfig': '<rootDir>/test/tsconfig.json'
            }
        },
        transform: {
            '^.+\\.tsx?$': '<rootDir>/node_modules/ts-jest'
        },
        testRunner: 'jest-circus/runner',
        testRegex: `\\.${testType === 'int' ? 'inttest' : 'unittest'}\\.tsx?$`,
        modulePaths: [
            '<rootDir>/node_modules'
        ],
        roots: ['<rootDir>', '<rootDir>/test'],
        moduleFileExtensions: [
            'ts',
            'tsx',
            'js',
            'jsx',
            'json',
            'node'
        ],
        reporters: [
            'default',
            [
                'jest-junit', {
                    'outputDirectory': '<rootDir>/dist/test',
                    'outputName': 'results-' + testType + '.xml',
                    'classNameTemplate': (vars: any) => {
                        const filePathTokens = vars.filepath.split('\\');

                        let fileName = filePathTokens[filePathTokens.length - 1];
                        fileName = fileName.split('.')[0];
                        filePathTokens[filePathTokens.length - 1] = fileName;

                        return testType + '.' + filePathTokens.join('.');
                    },
                    'titleTemplate': (vars: any) => {
                        let title;
                        if (vars.classname) {
                            title = vars.classname + ' > ' + vars.title;
                        } else {
                            title = vars.title;
                        }

                        return title.replace(/\./g, '•');
                    },
                    'ancestorSeparator': ' > '
                }
            ]
        ],
        ...getCustomJestConfig(testType)};
}

/**
 * Imports the custom jest config from the project.  This is required to establish any jest configuration options.
 *
 * It may be possible to remove this once testing has become more standardized configuration wise between projects.
 *
 * See https://jestjs.io/docs/en/configuration
 */
function getCustomJestConfig(type: JestMode) {
    let customConfig = {};
    const jestConfigPath = join(getRootDirectory(), `/test/jest-${type}.config.json`);

    try {
        if (existsSync(jestConfigPath)) {
            customConfig = getJsonFileSync(jestConfigPath);
        }
    } catch (e) {
        console.log(e);
    }

    return customConfig;
}
