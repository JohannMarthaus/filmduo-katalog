# Filmduo

Swipe-App für zwei: Beide wischen Filme und Serien, gemeinsame Likes werden zu Matches.

- **App:** https://claude.ai/artifact/Y4aVPVVnaUPNNezojYBi1Z
- **Daten:** TMDB (themoviedb.org), deutsche Texte und Streaminganbieter für Deutschland (über JustWatch)

## Aufbau

| Ordner | Inhalt |
|---|---|
| `app/filmduo.src.html` | Quelltext der Web-App |
| `app/catalog.txt` | Startkatalog (324 Titel), wird beim Bauen in die App eingesetzt |
| `scripts/build-app.mjs` | Baut `app/filmduo.html` (Quelltext + Startkatalog), das ist die veröffentlichte Datei |
| `scripts/fetch-tmdb.mjs` | Holt die Titel von TMDB und schreibt sie nach `data/` |
| `.github/workflows/update-catalog.yml` | Führt das Skript jede Nacht auf GitHub aus |

## Ablauf

1. **Jede Nacht** führt GitHub `fetch-tmdb.mjs` aus und legt den Katalog auf den Branch **`katalog`** (`meta.json` und `chunks/c00.json` …). Der Branch wird jedes Mal komplett ersetzt, damit das Repository nicht wächst.
2. **Einmal pro Woche** holt eine geplante Aufgabe in Claude den Branch `katalog` und schreibt ihn in die Datenbank der App: `catalog/c00` … und zuletzt `catalog/meta`.
3. **Die App** liest beim Start `catalog/meta`. Hat sich der Stand geändert, lädt sie die Teile neu, sonst nimmt sie ihre Kopie im Browser. Ist die Datenbank leer, zeigt sie den Startkatalog.

Alte Swipes und „Gesehen“-Markierungen aus dem Startkatalog werden über Titel und Jahr den TMDB-Einträgen zugeordnet. Titel ohne Treffer bleiben im Katalog.

Nur der Besitzer der App darf den Bereich `catalog` in der Datenbank ändern, Partner nicht.

## Einrichtung (einmalig)

1. **TMDB:** Auf themoviedb.org unter Einstellungen → API einen Schlüssel anlegen. Den *API Read Access Token* (langer Text) kopieren.
2. **GitHub:** Privates Repository `filmduo-katalog` anlegen und diesen Ordner hochladen.
3. **Secret:** Im Repository unter Settings → Secrets and variables → Actions → *New repository secret* den Namen `TMDB_TOKEN` und als Wert den Token eintragen.
4. **Erster Lauf:** Actions → *Katalog aktualisieren* → *Run workflow*. Nach etwa 10–15 Minuten gibt es den Branch `katalog`.

## Lokal testen

```
set TMDB_TOKEN=dein-token        (Windows cmd)
$env:TMDB_TOKEN="dein-token"     (PowerShell)
node scripts/fetch-tmdb.mjs
```

Weniger Seiten für einen schnellen Test: `MOVIE_POPULAR_PAGES=2 MOVIE_TOP_PAGES=2 TV_POPULAR_PAGES=1 TV_TOP_PAGES=1`.

App bauen: `node scripts/build-app.mjs` → `app/filmduo.html`.

## Hinweis

Diese App verwendet die TMDB-API, ist aber weder von TMDB unterstützt noch zertifiziert. Streaminganbieter: JustWatch.
