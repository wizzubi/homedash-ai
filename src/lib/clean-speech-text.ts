/**
 * HomeDash AI — czyszczenie tekstu dla syntezatora mowy (czysty moduł).
 *
 * Odpowiedzi asystenta (zwłaszcza z AI Fallback) mogą zawierać Markdown,
 * skróty i symbole, które syntezator czyta dosłownie („gwiazdka”, „hasz”).
 * Funkcja zamienia je na naturalną polszczyznę przed podaniem do
 * Edge-TTS (`/api/tts`) lub `speechSynthesis`.
 */
export function cleanSpeechText(raw: string): string {
  let text = (raw || "").trim();
  if (!text) return "";

  // Bloki kodu ```...``` → zostaw treść, usuń ogrodzenia.
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```\w*\n?/g, " ").replace(/```/g, " "),
  );
  // Kod inline `...` → sama treść.
  text = text.replace(/`([^`]+)`/g, "$1");
  // Linki [tekst](url) i [tekst][ref] → sam tekst.
  text = text.replace(/\[([^\]]+)\](\([^)]+\)|\[[^\]]*\])/g, "$1");
  // Nagłówki Markdown na początku linii.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Pogrubienia/kursywa: **x**, __x__, *x*, _x_, ~~x~~.
  text = text.replace(/(\*\*|__)(.+?)\1/g, "$2");
  text = text.replace(/(^|[\s(>"'])(\*|_|~{2})(.+?)\2(?=[\s).,!?;:"'<]|$)/gm, "$1$3");
  // Pozostałe znaczniki formatujące.
  text = text.replace(/[*_~#]+/g, " ");
  // Nawiasy klamrowe/kwadratowe techniczne → spacje (treść zostaje).
  text = text.replace(/[{}[\]]/g, " ");
  // Okrągłe: usuń całkiem puste, treść w środku zostaje.
  text = text.replace(/\(\s*\)/g, " ");

  // Jednostki i skróty mówione wprost.
  text = text
    .replace(/(\d+(?:[.,]\d+)?)\s*h\b/gi, "$1 godzin")
    .replace(/(\d+(?:[.,]\d+)?)\s*min\b/gi, "$1 minut")
    .replace(/(\d+(?:[.,]\d+)?)\s*sek\b\.?/gi, "$1 sekund")
    .replace(/\bgodz\./gi, "godzina")
    .replace(/(\d+(?:[.,]\d+)?)\s*°C\b/g, "$1 stopni Celsjusza")
    .replace(/(\d+(?:[.,]\d+)?)\s*°\b/g, "$1 stopni")
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, "$1 procent")
    .replace(/\bkm\/h\b/gi, "kilometrów na godzinę")
    .replace(/\bm\/s\b/gi, "metrów na sekundę");

  // Resztki techniczne.
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/[<>|•·]/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  // Linie listy („- punkt”, „* punkt”, „1. punkt”) → zdania; po dwukropku
  // pauza bez kropki, żeby lektor nie czytał „kropka”.
  const lines = text
    .split("\n")
    .map((line) => line.trim().replace(/^([-*•–—]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  text = lines.reduce((acc, line, i) => {
    if (i === 0) return line;
    return acc + (acc.endsWith(":") ? " " : ". ") + line;
  }, "");

  // Sklejanie interpunkcji po czyszczeniu.
  text = text.replace(/\s+([.,!?;:])/g, "$1");
  text = text.replace(/([.!?]){2,}/g, "$1");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text.slice(0, 1400);
}
