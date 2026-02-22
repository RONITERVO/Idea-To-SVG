/**
 * Platform-aware API key storage.
 * On Android: uses @aparajita/capacitor-secure-storage (Android Keystore encryption)
 * On Web: falls back to localStorage
 */

import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';

const STORAGE_KEY = 'sketchai.geminiApiKey.v1';
const LEGACY_STORAGE_KEY = 'gemini_api_key'; // old localStorage key

// In-memory cache to avoid repeated async storage calls
let cachedKey: string | null = null;

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

const isValidKeyFormat = (key: string): boolean => {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  return trimmed.startsWith('AIza') && trimmed.length >= 35 && trimmed.length <= 45;
};

/**
 * Load API key. Returns cached value if available, otherwise reads from storage.
 * Synchronous return from cache, but initial load is async (call initApiKey on startup).
 */
export const loadApiKey = (): string | null => {
  if (cachedKey) return cachedKey;

  // Synchronous fallback: check localStorage (web, or legacy)
  try {
    const legacyKey = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyKey && isValidKeyFormat(legacyKey)) {
      cachedKey = legacyKey;
      return legacyKey;
    }
  } catch {
    // localStorage not available (privacy mode, etc.)
  }

  return null;
};

/**
 * Async initialization: loads key from SecureStorage on native.
 * Call once on app startup. After this, loadApiKey() returns from cache.
 */
export const initApiKey = async (): Promise<string | null> => {
  if (cachedKey) return cachedKey;

  if (isNative()) {
    try {
      // Try SecureStorage first (encrypted, preferred)
      const secureKey = await SecureStorage.getItem(STORAGE_KEY);
      if (secureKey && isValidKeyFormat(secureKey)) {
        cachedKey = secureKey;
        return secureKey;
      }

      // Check Preferences for legacy migration
      const { value: prefsKey } = await Preferences.get({ key: STORAGE_KEY });
      if (prefsKey && isValidKeyFormat(prefsKey)) {
        // Migrate to SecureStorage
        await SecureStorage.setItem(STORAGE_KEY, prefsKey);
        await Preferences.remove({ key: STORAGE_KEY });
        cachedKey = prefsKey;
        return prefsKey;
      }

      // Check old localStorage key (legacy from web version)
      const { value: oldPrefsKey } = await Preferences.get({ key: LEGACY_STORAGE_KEY });
      if (oldPrefsKey && isValidKeyFormat(oldPrefsKey)) {
        await SecureStorage.setItem(STORAGE_KEY, oldPrefsKey);
        await Preferences.remove({ key: LEGACY_STORAGE_KEY });
        cachedKey = oldPrefsKey;
        return oldPrefsKey;
      }

      // Migrate old localStorage key on native into encrypted SecureStorage.
      const localKey = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (localKey && isValidKeyFormat(localKey)) {
        await SecureStorage.setItem(STORAGE_KEY, localKey);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        await Preferences.remove({ key: LEGACY_STORAGE_KEY }).catch(() => {});
        cachedKey = localKey;
        return localKey;
      }
    } catch (e) {
      console.error('Failed to load API key from SecureStorage:', e);
    }
  }

  // Web fallback: localStorage
  try {
    const localKey = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (localKey && isValidKeyFormat(localKey)) {
      cachedKey = localKey;
      return localKey;
    }
  } catch {
    // Ignore
  }

  return null;
};

/**
 * Save API key to platform-appropriate secure storage.
 */
export const setApiKey = async (key: string): Promise<void> => {
  const trimmed = key.trim();

  if (!isValidKeyFormat(trimmed)) {
    throw new ApiKeyError('Invalid API key format. Gemini API keys should start with "AIza" and be about 39 characters long.');
  }

  if (isNative()) {
    try {
      await SecureStorage.setItem(STORAGE_KEY, trimmed);
      // Clean up any legacy storage
      await Preferences.remove({ key: STORAGE_KEY }).catch(() => {});
      await Preferences.remove({ key: LEGACY_STORAGE_KEY }).catch(() => {});
    } catch (e) {
      console.error('Failed to save API key to SecureStorage:', e);
      throw new ApiKeyError('Failed to save API key securely.');
    }
  } else {
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, trimmed);
    } catch (e) {
      throw new ApiKeyError('Failed to save API key. Please check your browser storage settings.');
    }
  }

  cachedKey = trimmed;
};

/**
 * Clear API key from all storage locations.
 */
export const clearApiKey = async (): Promise<void> => {
  cachedKey = null;

  if (isNative()) {
    await SecureStorage.removeItem(STORAGE_KEY).catch(() => {});
    await Preferences.remove({ key: STORAGE_KEY }).catch(() => {});
    await Preferences.remove({ key: LEGACY_STORAGE_KEY }).catch(() => {});
  }

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore
  }
};

/**
 * Get API key or throw. Uses cached value.
 */
export const getApiKeyOrThrow = (): string => {
  const key = loadApiKey();

  if (!key) {
    throw new ApiKeyError('No API key found. Please set your Gemini API key to continue.');
  }

  if (!isValidKeyFormat(key)) {
    throw new ApiKeyError('Stored API key is invalid. Please update your API key.');
  }

  return key;
};
