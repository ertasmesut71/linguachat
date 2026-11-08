import { LANGUAGES } from "../../lib/constants";

/**
 * Reusable language dropdown.
 *
 * @param {object} props
 * @param {string} props.value - Current language code
 * @param {function} props.onChange - Callback with new language code
 * @param {string} [props.name] - Form field name
 * @param {string} [props.className] - Additional CSS class
 * @param {boolean} [props.showNative=true] - Show native language name
 * @param {boolean} [props.compact=false] - Compact mode (flag + code only)
 */
export default function LanguageSelect({
  value,
  onChange,
  name = "primaryLang",
  className = "",
  showNative = true,
  compact = false,
}) {
  const handleChange = (e) => {
    if (typeof onChange === "function") {
      // Support both form-style and direct-value handlers
      if (onChange.length > 0 && e?.target) {
        onChange(e);
      } else {
        onChange(e.target.value);
      }
    }
  };

  return (
    <select
      name={name}
      value={value}
      onChange={handleChange}
      className={`form-input ${className}`}
      style={compact ? { padding: "6px 10px", fontSize: 12 } : undefined}
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.flag}{" "}
          {compact
            ? lang.code.toUpperCase()
            : showNative
            ? `${lang.name} (${lang.nativeName})`
            : lang.name}
        </option>
      ))}
    </select>
  );
}
