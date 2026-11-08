/**
 * Supported languages across LinguaChat.
 * Shared between client forms and display components.
 */
export const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧", nativeName: "English" },
  { code: "tr", name: "Turkish", flag: "🇹🇷", nativeName: "Türkçe" },
  { code: "es", name: "Spanish", flag: "🇪🇸", nativeName: "Español" },
  { code: "fr", name: "French", flag: "🇫🇷", nativeName: "Français" },
  { code: "de", name: "German", flag: "🇩🇪", nativeName: "Deutsch" },
  { code: "ja", name: "Japanese", flag: "🇯🇵", nativeName: "日本語" },
  { code: "zh", name: "Chinese", flag: "🇨🇳", nativeName: "中文" },
  { code: "ar", name: "Arabic", flag: "🇸🇦", nativeName: "العربية" },
  { code: "ko", name: "Korean", flag: "🇰🇷", nativeName: "한국어" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷", nativeName: "Português" },
  { code: "ru", name: "Russian", flag: "🇷🇺", nativeName: "Русский" },
  { code: "hi", name: "Hindi", flag: "🇮🇳", nativeName: "हिन्दी" },
  { code: "it", name: "Italian", flag: "🇮🇹", nativeName: "Italiano" },
  { code: "nl", name: "Dutch", flag: "🇳🇱", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", flag: "🇵🇱", nativeName: "Polski" },
  { code: "sv", name: "Swedish", flag: "🇸🇪", nativeName: "Svenska" },
  { code: "da", name: "Danish", flag: "🇩🇰", nativeName: "Dansk" },
  { code: "fi", name: "Finnish", flag: "🇫🇮", nativeName: "Suomi" },
  { code: "no", name: "Norwegian", flag: "🇳🇴", nativeName: "Norsk" },
  { code: "el", name: "Greek", flag: "🇬🇷", nativeName: "Ελληνικά" },
  { code: "cs", name: "Czech", flag: "🇨🇿", nativeName: "Čeština" },
  { code: "ro", name: "Romanian", flag: "🇷🇴", nativeName: "Română" },
  { code: "hu", name: "Hungarian", flag: "🇭🇺", nativeName: "Magyar" },
  { code: "th", name: "Thai", flag: "🇹🇭", nativeName: "ไทย" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳", nativeName: "Tiếng Việt" },
  { code: "id", name: "Indonesian", flag: "🇮🇩", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", flag: "🇲🇾", nativeName: "Bahasa Melayu" },
  { code: "uk", name: "Ukrainian", flag: "🇺🇦", nativeName: "Українська" },
];

/**
 * Find a language object by code.
 */
export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/**
 * User status configuration.
 */
export const USER_STATUSES = {
  online: { label: "Online", color: "var(--green)" },
  away: { label: "Away", color: "var(--yellow)" },
  offline: { label: "Offline", color: "var(--text-tertiary)" },
  do_not_disturb: { label: "Do Not Disturb", color: "var(--red)" },
};

/**
 * Get a deterministic avatar gradient class name from a string (e.g. user ID).
 */
export function getAvatarGradient(str) {
  if (!str) return "avatar-gradient-0";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % 6;
  return `avatar-gradient-${index}`;
}

/**
 * Generate initials from a display name.
 */
export function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
