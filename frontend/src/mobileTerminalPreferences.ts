export type MobileTerminalPreferences = {
  autocapitalization: boolean;
  autocorrect: boolean;
};

export type MobileTerminalPreferenceKey = keyof MobileTerminalPreferences;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const AUTOCORRECT_KEY = "opencozy.mobileTerminal.autocorrect";
const AUTOCAPITALIZATION_KEY = "opencozy.mobileTerminal.autocapitalization";

export const DEFAULT_MOBILE_TERMINAL_PREFERENCES: MobileTerminalPreferences = {
  autocapitalization: true,
  autocorrect: true
};

const STORAGE_KEYS: Record<MobileTerminalPreferenceKey, string> = {
  autocapitalization: AUTOCAPITALIZATION_KEY,
  autocorrect: AUTOCORRECT_KEY
};

function readBooleanPreference(storage: PreferenceStorage, key: string, fallback: boolean): boolean {
  const value = storage.getItem(key);
  if (value === null) {
    return fallback;
  }

  return value !== "false";
}

export function readMobileTerminalPreferences(
  storage: PreferenceStorage = window.localStorage
): MobileTerminalPreferences {
  return {
    autocapitalization: readBooleanPreference(storage, AUTOCAPITALIZATION_KEY, DEFAULT_MOBILE_TERMINAL_PREFERENCES.autocapitalization),
    autocorrect: readBooleanPreference(storage, AUTOCORRECT_KEY, DEFAULT_MOBILE_TERMINAL_PREFERENCES.autocorrect)
  };
}

export function writeMobileTerminalPreference(
  storage: PreferenceStorage,
  key: MobileTerminalPreferenceKey,
  value: boolean
): MobileTerminalPreferences {
  storage.setItem(STORAGE_KEYS[key], String(value));
  return readMobileTerminalPreferences(storage);
}
