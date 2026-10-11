# HomeDash AI

Inteligentny kiosk domowy (PWA) na tablet ścienny — centrum dowodzenia domu i rodziny.
Ciemny interfejs typu *glassmorphism*, układ **12-kolumnowy w orientacji poziomej bez przewijania**,
obsługa głosowa (wake-word) i darmowa synteza mowy Microsoft Edge TTS.

> Baza danych: **libSQL / SQLite** — lokalny plik `data/homedash.db` albo **Turso** w chmurze.
> Aplikacja startuje **pusta**: nie ma żadnych danych demonstracyjnych, wszystko wprowadzasz w kreatorze.

---

## Funkcje

| Moduł | Opis |
|---|---|
| **Kreator pierwszego uruchomienia** `/setup` | 7 kroków: baza → dom i lokalizacja → domownicy → plan lekcji → odpady (ręcznie lub `.ics`) → dokumenty → PIN i start |
| **Wake-word** | Nasłuch `Hej Dash` / `OK Home` przez Web Speech API, bez wysyłania audio w trybie 24/7 |
| **Polecenia głosowe** | „Dodaj zadanie: kupić mleko”, „Pracowałem od 8:00 do 16:30”, „Dziś 8h”, „Czy jutro wystawiam plastik?”, „Stwórz notatkę: …” |
| **Godziny pracy** | Dzienny licznik, suma tygodnia i miesiąca, autorski wykres SVG (7 dni) |
| **Plan lekcji** | Podział na dzieci, automatyczne podświetlenie trwającej lekcji i odliczanie do końca |
| **Notatki / przypinki** | Kolorowe kafelki, przypinanie, tworzenie głosem |
| **Odpady** | 4 frakcje (Bio, Plastik+metal, Zmieszane, Szkło), import `.ics` z obsługą wydarzeń cyklicznych |
| **Zadania i dokumenty** | Lista rodzinna + monitor ważności z alertem 30 dni przed wygaśnięciem |
| **Pogoda** | Open-Meteo (proxy `/api/weather`), animowane ikony |
| **Panel administratora** `/admin` | Chroniony PIN-em; pełna edycja wszystkich modułów i konfiguracji |

---

## Szybki start

```bash
npm install
cp .env.example .env      # uzupełnij zmienne
npm run dev               # http://localhost:3000 → automatycznie otworzy /setup
```

Przy pierwszym żądaniu tabele tworzą się same (`src/db/migrate.ts`), więc nie musisz uruchamiać migracji.

---

## Baza danych

Aplikacja używa jednego schematu **libSQL/SQLite** (`drizzle-orm/sqlite-core`) i wybiera cel na podstawie zmiennych:

1. `TURSO_DATABASE_URL` (albo `DATABASE_URL` zaczynające się od `libsql://`) → **Turso**
2. w przeciwnym razie `DATABASE_URL=file:...` lub domyślnie `file:./data/homedash.db` → **lokalny plik**

### Podłączenie Turso

```bash
npm install -g @tursodatabase/cli
turso auth login
turso db create homedash-ai

turso db show homedash-ai --url     # → libsql://homedash-ai-<org>.turso.io
turso db tokens create homedash-ai  # → token rw
```

`.env`:

```bash
TURSO_DATABASE_URL=libsql://homedash-ai-<org>.turso.io
TURSO_AUTH_TOKEN=<token>
```

Schemat możesz wypchnąć na dwa sposoby:

```bash
npx drizzle-kit push        # jawne porównanie i push (konfig czyta .env)
# albo po prostu uruchom aplikację — ensureSchema() utworzy tabele automatycznie
```

### Migracja z lokalnego pliku do Turso

```bash
turso db shell homedash-ai < data/homedash.db.sql     # jeśli masz dump SQL
# albo ustaw TURSO_DATABASE_URL i przepisz dane panelem /admin (wszystko jest edytowalne)
```

---

## Deployment (Vercel + Turso)

1. Push repozytorium → import w Vercel.
2. Environment Variables: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `OPENROUTER_API_KEY` (opcjonalnie), `ADMIN_PIN` (opcjonalnie).
3. Deploy. Pierwsze wejście na domenę otworzy `/setup`.

Aplikacja jest PWA (`manifest.webmanifest` + `public/sw.js`), więc można ją „dodać do ekranu głównego”.

---

## Tablet ścienny — Android (Fully Kiosk Browser)

1. **Start URL**: adres Twojego wdrożenia.
2. **Ustawienia → Web** → włącz *WebRTC / Microphone Access* (stały dostęp do mikrofonu dla wake-word).
3. **Device Management**: *Kiosk Mode*, *Launch on Boot*.
4. **Motion detection** (przednia kamera) do wybudzania ekranu.
5. Zablokuj orientację **poziomą** (landscape) — układ jest projektowany pod 16:9 / 16:10 bez scrolla.

Ekran główny ma `overflow: hidden` w trybie poziomym ≥ 920 px; w pionie i na telefonie układ przełącza się
na przewijaną kolumnę, żeby nic nie zostało ucięte.

---

## Struktura

```
src/
  app/
    page.tsx              # dashboard (przekierowuje do /setup przed konfiguracją)
    setup/page.tsx        # kreator pierwszego uruchomienia
    admin/page.tsx        # panel administratora (PIN)
    api/
      setup/              # kroki kreatora (bez PIN, dopóki konfiguracja nie jest zakończona)
      admin/              # operacje chronione PIN-em
      dashboard/          # zbiorczy odczyt stanu domu
      tasks/ notes/ work-logs/   # mutacje modułów
      weather/            # proxy Open-Meteo
      assistant/          # proxy OpenRouter (klucz tylko po stronie serwera)
      tts/                # Edge TTS (pl-PL-ZofiaNeural / pl-PL-MarekNeural)
  components/             # home-dashboard, setup-wizard, admin-panel
  db/
    schema.ts             # sqliteTable (libSQL)
    index.ts              # wybór Turso ↔ plik lokalny
    migrate.ts            # idempotentne DDL (ensureSchema)
  lib/
    dashboard-data.ts     # odczyt stanu, konfiguracja, domownicy
    ics.ts                # parser .ics → 4 frakcje odpadów
public/                   # manifest, ikona, service worker
data/homedash.db          # lokalna baza (gitignore)
```

---

## Bezpieczeństwo

- `OPENROUTER_API_KEY` i `TURSO_AUTH_TOKEN` są używane wyłącznie po stronie serwera.
- PIN administratora nigdy nie wraca do klienta (`getPublicConfig` filtruje klucze wrażliwe).
- Pliki `.env` są w `.gitignore`.

---

## Skrypty

```bash
npm run dev        # rozwój
npm run build      # build produkcyjny
npm run start      # serwer produkcyjny
npm run typecheck  # tsc --noEmit
npx drizzle-kit push   # push schematu (Turso albo plik lokalny)
```
