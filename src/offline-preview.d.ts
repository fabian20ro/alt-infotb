declare const __OFFLINE_SHELL_VERSION__: string;
declare module 'virtual:offline-preview-config' {
 const config: { publicRoot: string; regionId: string; offers: import('./lib/offline-maps/contracts').PackageOffer[]; versions: string[] };
 export default config;
}
