import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';
export const isWeb = (): boolean => Capacitor.getPlatform() === 'web';

// User mode preference stored in localStorage
const MODE_KEY = 'sketch_ai_mode';

export type AppMode = 'apikey' | 'tokens';

export const getAppMode = (): AppMode | null => {
  return localStorage.getItem(MODE_KEY) as AppMode | null;
};

export const setAppMode = (mode: AppMode): void => {
  localStorage.setItem(MODE_KEY, mode);
};

export const isTokenMode = (): boolean => {
  const mode = getAppMode();
  if (mode === 'tokens') return true;
  if (mode === 'apikey') return false;
  // Default: token mode on Android, API key mode on web
  return isAndroid();
};
