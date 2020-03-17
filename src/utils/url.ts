import {getProjectConfig, Config} from './getProjectConfig';

const trailingSlash: RegExp = /\/$/;
const trimFragment: RegExp = /^\/*(.*?)\/*$/;

const templateCache: {[template: string]: Function} = {};

/**
 * Joins all of the given strings, ensuring there is exactly one forward slash between each string, regardless of the
 * leading/trailing slashes within each fragment.
 *
 * @param fragments Array of URL fragments
 */
export function join(...fragments: string[]): string {
    return fragments.map((fragment) => trimFragment.exec(fragment)![1]).join('/');
}

/**
 * Evaluates a given template, and then normalises the result by removing any trailing slash. String template uses
 * standard JS template syntax, with "${variable}" syntax. Expressions have available the properties within the project
 * config - see {@link Config}.
 *
 * For example: replaceUrlParams('${CDN_LOCATION}/${VERSION}/app.json') would be equivilant to the templated string
 * `${getProjectConfig().CDN_LOCATION}/${getProjectConfig().VERSION}/app.json` - except that in the case of the former, the string could come from an
 * external source (such as a manifest), whereas the latter must be specified within code.
 *
 * @param urlTemplate A valid URL, or string template that resolves to a valid URL
 * @param overrideArgs Optional config overrides, to apply before evaluating template
 */
export function replaceUrlParams(urlTemplate: string, overrideArgs?: Partial<Config>) {
    if (urlTemplate.indexOf('${') === -1) {
        // Not a template, just a "plain" URL
        return urlTemplate;
    } else {
        // If URL looks like a string template, insert params into string
        const params = {...getProjectConfig(), ...overrideArgs};
        let templateFunc: Function = templateCache[urlTemplate];

        if (!templateFunc) {
            try {
                // eslint-disable-next-line no-new-func
                templateFunc = new Function(...Object.keys(params), `return \`${urlTemplate}\`;`);
            } catch (e) {
                console.error('Error creating template function, check for syntax errors and any characters that need escaping within template string');
                throw e;
            }

            templateCache[urlTemplate] = templateFunc;
        }

        return templateFunc(...Object.values(params)).replace(trailingSlash, '');
    }
}
