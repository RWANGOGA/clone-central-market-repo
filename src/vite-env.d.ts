/// <reference types="vite/client" />

/**
 * Build-time configuration. VITE_API_BASE is only set when the shop is served
 * from somewhere that cannot proxy /api itself — today that is GitHub Pages.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Figma-exported images are imported as `figma:asset/<file>.png` and rewritten
 * by the custom resolver in vite.config.ts to `src/assets/<file>.png`. Vite
 * knows about the scheme; TypeScript does not, so without this every such
 * import is a "cannot find module" error. The plugin returns a URL string, so
 * the default export is typed as one.
 */
declare module 'figma:asset/*' {
  const src: string;
  export default src;
}
