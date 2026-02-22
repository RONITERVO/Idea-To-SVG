/**
 * Local storage module for managing Gemini API keys
 * Stores the API key securely in browser localStorage
 */

const STORAGE_KEY = 'gemini_api_key';

/**
 * Custom error class for API key related errors
 */
export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

/**
 * Lightweight validation for Gemini API key format
 * Gemini API keys typically start with "AIza" and are around 39 characters
 */
const isValidKeyFormat = (key: string): boolean => {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  // Basic format check: starts with AIza and has reasonable length
  return trimmed.startsWith('AIza') && trimmed.length >= 35 && trimmed.length <= 45;
};

/**
 * Load API key from localStorage
 * @returns The API key if found, null otherwise
 */
export const loadApiKey = (): string | null => {
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    return key;
  } catch (e) {
    console.error('Failed to load API key from storage:', e);
    return null;
  }
};

/**
 * Save API key to localStorage with validation
 * @param key The API key to save
 * @throws {ApiKeyError} If the key format is invalid
 */
export const setApiKey = (key: string): void => {
  const trimmed = key.trim();
  
  if (!isValidKeyFormat(trimmed)) {
    throw new ApiKeyError('Invalid API key format. Gemini API keys should start with "AIza" and be about 39 characters long.');
  }
  
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch (e) {
    console.error('Failed to save API key to storage:', e);
    throw new ApiKeyError('Failed to save API key. Please check your browser storage settings.');
  }
};

/**
 * Clear API key from localStorage
 */
export const clearApiKey = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear API key from storage:', e);
  }
};

/**
 * Get API key from storage or throw an error
 * @returns The API key from storage
 * @throws {ApiKeyError} If no key is found or key is invalid
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
