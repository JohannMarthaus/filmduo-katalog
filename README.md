# Filmduo – Katalog

Holt jede Nacht Filme und Serien von TMDB (deutsche Texte, Streaminganbieter in Deutschland über JustWatch) für die App **Filmduo**.

- **App:** https://johannmarthaus.github.io/filmduo/ (Repo [filmduo](https://github.com/JohannMarthaus/filmduo))
- **Katalog:** Branch [`katalog`](https://github.com/JohannMarthaus/filmduo-katalog/tree/katalog) – `meta.json` und `chunks/c00.json` …

## Ablauf

1. Die GitHub Action **Katalog aktualisieren** läuft jede Nacht um ca. 3:17 Uhr (oder von Hand: Actions → Katalog aktualisieren → Run workflow).
2. Sie führt `scripts/fetch-tmdb.mjs` aus und ersetzt den Branch `katalog` komplett. So wächst das Repository nicht.
3. Zum Schluss schickt sie einen kurzen Ping an Supabase, damit das kostenlose Projekt nicht pausiert.
4. Die App lädt den Katalog direkt vom Branch `katalog`.

## Aufbau

| Ordner / Datei | Inhalt |
|---|---|
| `scripts/fetch-tmdb.mjs` | Holt die Titel von TMDB und schreibt sie nach `data/` (Node 20+, keine Abhängigkeiten) |
| `.github/workflows/update-catalog.yml` | Die nächtliche Action |
| `app/` | Ältere Version der App als Claude-Artifact (`filmduo.src.html`, Startkatalog `catalog.txt`) |
| `scripts/build-app.mjs`, `scripts/plan-upload.mjs` | Nur für die Claude-Artifact-Version |

## Einrichtung

Im Repository unter Settings → Secrets and variables → Actions das Secret `TMDB_TOKEN` anlegen (den *API Read Access Token* von themoviedb.org → Einstellungen → API).

## Lokal testen

```
set TMDB_TOKEN=dein-token        (Windows cmd)
$env:TMDB_TOKEN="dein-token"     (PowerShell)
node scripts/fetch-tmdb.mjs
```

Weniger Seiten für einen schnellen Test: `MOVIE_POPULAR_PAGES=2 MOVIE_TOP_PAGES=2 TV_POPULAR_PAGES=1 TV_TOP_PAGES=1`.

## Hinweis

Diese App verwendet die TMDB-API, ist aber weder von TMDB unterstützt noch zertifiziert. Streaminganbieter: JustWatch.
