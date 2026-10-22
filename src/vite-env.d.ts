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
