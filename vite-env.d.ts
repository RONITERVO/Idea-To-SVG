/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional dev fallback API key for local development only.
   * This is NOT included in production builds.
   * Set via GEMINI_API_KEY in .env.local
   */
  readonly VITE_GEMINI_API_KEY?: string;
  /** Public privacy policy URL shown in-app (required for release). */
  readonly VITE_PRIVACY_POLICY_URL?: string;
  /** Optional support contact email shown in account settings. */
  readonly VITE_SUPPORT_EMAIL?: string;
  /** Optional Firebase App Check reCAPTCHA v3 site key. */
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  /** Whether the app is running in development mode */
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
