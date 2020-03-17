import * as path from 'path';

import {NextFunction, Request, RequestHandler, Response} from 'express-serve-static-core';

import {getJsonFile} from '../utils/getJsonFile';
import {getManifest, ManifestFile, ServiceDeclaration, RewriteContext} from '../utils/getManifest';
import {getProjectConfig} from '../utils/getProjectConfig';
import {getProviderUrl} from '../utils/getProviderUrl';

/**
 * Creates express-compatible middleware function that will add/replace any URL's found within app.json files according
 * to the command-line options of this utility.
 */
export function createAppJsonMiddleware(providerVersion: string, runtimeVersion?: string): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
        const configPath = req.params[0];            // app.json path, relative to 'res' dir

        // Parse app.json
        let config: ManifestFile;
        try {
            config = getManifest(configPath, RewriteContext.DEBUG, providerVersion, runtimeVersion);
        } catch (e) {
            next();
            return;
        }

        // If this is the provider manifest, ensure window is always visible
        if (configPath.indexOf('/provider/') && config.startup_app?.autoShow === false) {
            config.startup_app.autoShow = true;
        }

        // Return modified JSON to client
        res.header('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify(config, null, 4));
    };
}

/**
 * Creates express-compatible middleware function to generate custom application manifests.
 *
 * Differs from createAppJsonMiddleware (defined in server.js), as this spawns custom demo windows, rather than
 * re-writing existing demo/provider manifests.
 */
export function createCustomManifestMiddleware(): RequestHandler {
    const {PORT, NAME} = getProjectConfig();

    return async (req, res, next) => {
        const defaultConfig = await getJsonFile<ManifestFile>(path.resolve('./res/demo/app.json')).catch(next);

        if (!defaultConfig) {
            return;
        }

        const randomId = Math.random().toString(36).substr(2, 4);
        const query: {[key: string]: string} = req.query;
        const {
            uuid,
            name,
            url,
            frame,
            defaultCentered,
            defaultLeft,
            defaultTop,
            defaultWidth,
            defaultHeight,
            realmName,
            enableMesh,
            runtime,
            useService,
            provider,
            config,
            licenseKey,
            shortcut
        } = {
            // Set default values
            uuid: `test-app-${randomId}`,
            name: `Openfin Test App ${randomId}`,
            url: `http://localhost:${PORT}/demo/testbed/index.html`,
            runtime: defaultConfig.runtime.version,
            provider: 'local',
            config: null,
            realmName: null,

            // Override with query args
            ...query,

            // Special handling for any non-string args (both parses query string args, and defines default values)
            frame: req.query.frame !== 'false',
            enableMesh: req.query.enableMesh !== 'false',
            useService: req.query.useService !== 'false',
            defaultCentered: req.query.defaultCentered === 'true',
            defaultLeft: Number.parseInt(req.query.defaultLeft, 10) || 860,
            defaultTop: Number.parseInt(req.query.defaultTop, 10) || 605,
            defaultWidth: Number.parseInt(req.query.defaultWidth, 10) || 860,
            defaultHeight: Number.parseInt(req.query.defaultHeight, 10) || 605,
            licenseKey: defaultConfig.licenseKey,
            shortcut: req.query.shortcutName
                ? {
                    'company': 'OpenFin',
                    'icon': 'openfin-test-icon.ico',
                    'name': req.query.shortcutName
                }
                : undefined
        };

        const manifest = {
            licenseKey,
            // eslint-disable-next-line
            startup_app:
                {uuid, name, url, frame, autoShow: true, saveWindowState: false, defaultCentered, defaultLeft, defaultTop, defaultWidth, defaultHeight},
            runtime: {arguments: `--v=1${realmName ? ` --security-realm=${realmName}${enableMesh ? ' --enable-mesh' : ''}` : ''}`, version: runtime},
            services: {},
            shortcut
        };
        if (useService) {
            const service: ServiceDeclaration = {name: `${NAME}`};

            if (provider !== 'default') {
                service.manifestUrl = getProviderUrl(provider);
            }
            if (config) {
                service.config = JSON.parse(config!);
            }
            manifest.services = [service];
        }

        // Return modified JSON to client
        res.header('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify(manifest, null, 4));
    };
}
