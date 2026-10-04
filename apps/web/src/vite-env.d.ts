/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_SPACETIME_HOST?: string;
  readonly VITE_SPACETIME_DB?: string;
  readonly VITE_SPACETIME_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
