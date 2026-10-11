/**
 * HomeDash AI — polskie stacje radiowe (czysty moduł, bezpośrednie strumienie).
 *
 * UWAGA: adresy strumieni operatorzy zmieniają co jakiś czas — przy problemie
 * z odtwarzaniem sprawdź aktualny URL stacji i podmień go na liście.
 * Odtwarzanie: natywny `HTMLAudioElement` w hooku `useRadioPlayer`.
 */

export type RadioStation = {
  id: string;
  name: string;
  streamUrl: string;
  /** Aliasy do dopasowania głosowego („trzysta pięćdziesiąt siedem”, „nowy świat”…). */
  aliases: string[];
};

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: "radio357",
    name: "Radio 357",
    streamUrl: "https://stream.radio357.pl/",
    aliases: ["357", "trzysta", "trzy piec siedem", "trzy pięć siedem"],
  },
  {
    id: "nowy-swiat",
    name: "Radio Nowy Świat",
    streamUrl: "https://n-15-5.dcs.redcdn.pl/dcs/o2/nsw/live/mp3_128",
    aliases: ["nowy swiat", "nowy świat", "nsw", "świat", "swiat"],
  },
  {
    id: "rmf-fm",
    name: "RMF FM",
    streamUrl: "https://rs101-krk.rmfstream.pl/RMFFM48",
    aliases: ["rmf", "rmf fm", "eremef"],
  },
  {
    id: "rmf-classic",
    name: "RMF Classic",
    streamUrl: "https://rs101-krk.rmfstream.pl/RMFCLASSIC48",
    aliases: ["rmf classic", "classic", "klasyka", "muzyka klasyczna"],
  },
  {
    id: "rmf24",
    name: "RMF24",
    streamUrl: "https://rs101-krk.rmfstream.pl/RMF24",
    aliases: ["rmf 24", "rmf24", "rmf dwadzieścia cztery", "wiadomosci", "wiadomości", "informacje"],
  },
  {
    id: "eska",
    name: "Radio ESKA",
    streamUrl: "https://ic2.smcdn.pl/3990-1.mp3",
    aliases: ["eska", "radio eska", "eska warszawa"],
  },
  {
    id: "antyradio",
    name: "Antyradio",
    streamUrl: "https://r.dcs.redcdn.pl/dcs/o2/antyradio/live/mp3_128",
    aliases: ["antyradio", "anty"],
  },
  {
    id: "czworka",
    name: "Polskie Radio Czwórka",
    streamUrl: "https://stream3.polskieradio.pl:8080/",
    aliases: ["czworka", "czwórka", "4", "czwarta", "polskie radio"],
  },
];

function foldPl(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Dopasowuje stację po nazwie / aliasie / numerze w tekście komendy.
 * Zwraca `null`, gdy tekst nie wskazuje konkretnej stacji.
 */
export function matchRadioStation(text: string): RadioStation | null {
  const folded = ` ${foldPl(text)} `;
  let best: RadioStation | null = null;
  let bestLen = 0;
  for (const station of RADIO_STATIONS) {
    const candidates = [station.name, station.id.replace(/-/g, " "), ...station.aliases];
    for (const candidate of candidates) {
      const needle = foldPl(candidate).trim();
      if (needle.length < 2) continue;
      const hit =
        folded.includes(` ${needle} `) ||
        folded.includes(` ${needle},`) ||
        folded.includes(` ${needle}.`) ||
        new RegExp(`(^|\\D)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`).test(folded);
      if (hit && needle.length > bestLen) {
        best = station;
        bestLen = needle.length;
      }
    }
  }
  return best;
}
