export const PHONE_THEME_PREFERENCE_KEY = 'poplur.phone.theme.v1';

export const PHONE_THEME_IDS = [
  'silver',
  'gold',
  'rose',
  'ruby',
  'blue',
  'green',
  'purple',
  'onyx',
  'aqua',
  'holo',
] as const;

export type PhoneThemeId = (typeof PHONE_THEME_IDS)[number];

const PHONE_THEME_ID_SET = new Set<string>(PHONE_THEME_IDS);

export function normalizePhoneThemeId(value: unknown): PhoneThemeId | null {
  return typeof value === 'string' && PHONE_THEME_ID_SET.has(value)
    ? value as PhoneThemeId
    : null;
}

export function phoneThemeBootstrap(value: unknown): string {
  const themeId = normalizePhoneThemeId(value) ?? PHONE_THEME_IDS[0];
  const key = JSON.stringify(PHONE_THEME_PREFERENCE_KEY).replace(/</g, '\\u003c');
  const serializedId = JSON.stringify(themeId).replace(/</g, '\\u003c');
  return `;(function(){try{localStorage.setItem(${key},${serializedId});}catch(_){}})();true;`;
}
