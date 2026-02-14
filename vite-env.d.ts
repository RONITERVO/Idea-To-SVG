/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional dev fallback API key for local development only.
   * This is NOT included in production builds.
   * Set via GEMINI_API_KEY in .env.local
   */
  readonly VITE_GEMINI_API_KEY?: string;
  /** Whether the app is running in development mode */
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
