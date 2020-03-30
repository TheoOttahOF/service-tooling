import {WindowOption} from 'openfin/_v2/api/window/windowOption';

export type Manifest = ClassicManifest | PlatformManifest;

/**
 * Quick implementation on the app.json, for the pieces we use.
 */
export interface ClassicManifest {
    licenseKey: string;
    startup_app: {
        uuid: string;
        name: string;
        url: string;
        defaultHeight?: number;
        defaultWidth?: number;
        icon?: string;
        autoShow?: boolean;
    };
    shortcut?: {
        icon?: string;
    };
    runtime: RuntimeInfo;
    services?: ServiceDeclaration[];
}

export interface ServiceDeclaration {
    name: string;
    manifestUrl?: string;
    config?: {};
}

interface RuntimeInfo {
    arguments: string;
    version: string;
}

/**
 * There is no platform manifest type available.
 */
export interface PlatformManifest {
    licenseKey: string;
    platform: {
        autoShow: boolean;
        uuid: string;
        applicationIcon: string;
        defaultWindowOptions: Omit<WindowOption, 'autoShow' | 'uuid' | 'name'>;
    };
    snapshot: {
        windows: SnapshotWindow[];
    };
    runtime: RuntimeInfo;
    services?: ServiceDeclaration[];
}

interface SnapshotWindow {
    defaultWidth: number;
    defaultHeight: number;
    defaultLeft?: number;
    defaultTop?: number;
    autoShow?: boolean;
    layout: {
        content: PlatformStack[];
    };
}

interface PlatformStack {
    type: 'stack';
    content: (PlatformComponent | PlatformStack)[];
}

interface PlatformComponent {
    type: 'component';
    componentName: string;
    componentState: {
        name: string;
        url: string;
        processAffinity?: 'ps_1';
    };
}
