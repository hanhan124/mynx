import { useLanguage } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  const next = language === "zh" ? "en" : "zh";
  return (
    <button
      type="button"
      className="language-switcher"
      data-tauri-no-drag
      onClick={() => setLanguage(next)}
      title={t(language === "zh" ? "language.switchToEnglish" : "language.switchToChinese")}
      aria-label={t(language === "zh" ? "language.switchToEnglish" : "language.switchToChinese")}
      aria-pressed={language === "en"}
    >
      {language === "zh" ? "EN" : "中"}
    </button>
  );
}
