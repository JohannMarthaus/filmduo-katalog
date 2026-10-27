// Holt Filme und Serien von TMDB (deutsche Texte, Streaminganbieter in Deutschland)
// und schreibt sie nach data/. Läuft nachts über GitHub Actions, geht aber auch lokal:
//   TMDB_TOKEN=... node scripts/fetch-tmdb.mjs
// Node 20+, keine Abhängigkeiten.

import { mkdir, writeFile, rm } from "node:fs/promises";

const TOKEN = (process.env.TMDB_TOKEN || "").trim();
if (!TOKEN) { console.error("TMDB_TOKEN fehlt (API-Schlüssel oder Read Access Token von themoviedb.org)."); process.exit(1); }
const USE_KEY = TOKEN.length < 40; // v3-API-Schlüssel (32 Zeichen) statt v4-Token

const API = "https://api.themoviedb.org/3";
const LANG = "de-DE", REGION = "DE";
// Geholt wird alles, was in Deutschland im Abo, kostenlos oder mit Werbung streambar ist,
// sortiert nach Beliebtheit. Die Seitenzahl (je 20 Titel) begrenzt die Größe des Katalogs.
const PAGES = {
  movies: +process.env.MOVIE_PAGES || 350, // höchstens ~7.000 Filme
  tv: +process.env.TV_PAGES || 175,        // höchstens ~3.500 Serien
};
const MIN_VOTES = {
  movies: +process.env.MOVIE_MIN_VOTES || 50,
  tv: +process.env.TV_MIN_VOTES || 20,
};
const MONETIZATION = "flatrate|free|ads";
const CONCURRENCY = 8;
const CHUNK_BYTES = 200_000; // < 256 KiB pro Datenbank-Dokument
const OUT = new URL("../data/", import.meta.url);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (USE_KEY) url.searchParams.set("api_key", TOKEN);
  const headers = { accept: "application/json" };
  if (!USE_KEY) headers.authorization = `Bearer ${TOKEN}`;
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch(url, { headers }); }
    catch (e) { if (attempt < 4) { await sleep(1500 * (attempt + 1)); continue; } throw e; }
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 401) throw new Error("TMDB lehnt den Schlüssel ab (401). Prüfe das Secret TMDB_TOKEN.");
    if ((r.status === 429 || r.status >= 500) && attempt < 5) {
      await sleep((+r.headers.get("retry-after") || 2) * 1000 * (attempt + 1));
      continue;
    }
    throw new Error(`TMDB ${r.status} bei ${url.pathname}`);
  }
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (e) { console.warn("übersprungen:", items[i], e.message); out[i] = null; }
      if (++done % 250 === 0) console.log(`  ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

async function discover(kind, sort, pages, minVotes) {
  const ids = [];
  for (let page = 1; page <= Math.min(pages, 500); page++) {
    const d = await get(`/discover/${kind}`, {
      language: LANG, sort_by: sort, page, include_adult: "false",
      "vote_count.gte": minVotes, watch_region: REGION, with_watch_monetization_types: MONETIZATION,
    });
    if (page === 1) console.log(`  ${kind}: ${d?.total_results ?? 0} Treffer bei TMDB`);
    if (!d?.results?.length) break;
    ids.push(...d.results.map(x => x.id));
    if (page >= d.total_pages) break;
  }
  return ids;
}

const names = (arr, n = 99) => (arr || []).slice(0, n).map(x => x.name).filter(Boolean);
const provNames = arr => [...new Set((arr || []).sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99)).map(p => p.provider_name))];

function trailerKey(videos) {
  const v = (videos?.results || []).filter(x => x.site === "YouTube" && (x.type === "Trailer" || x.type === "Teaser"));
  v.sort((a, b) => (a.iso_639_1 === "de" ? 0 : 1) - (b.iso_639_1 === "de" ? 0 : 1) || (a.type === "Trailer" ? 0 : 1) - (b.type === "Trailer" ? 0 : 1) || (b.official ? 1 : 0) - (a.official ? 1 : 0));
  return v[0]?.key || "";
}

function fskMovie(d) {
  const de = d.release_dates?.results?.find(r => r.iso_3166_1 === "DE");
  const c = de?.release_dates?.map(r => r.certification).find(Boolean);
  return c || "";
}
function fskTv(d) {
  return d.content_ratings?.results?.find(r => r.iso_3166_1 === "DE")?.rating || "";
}

async function detail(kind, id) {
  const append = kind === "movie" ? "credits,watch/providers,videos,release_dates" : "aggregate_credits,watch/providers,videos,content_ratings";
  const d = await get(`/${kind}/${id}`, { language: LANG, append_to_response: append, include_video_language: "de,en,null" });
  if (!d || d.adult) return null;

  let overview = (d.overview || "").trim();
  if (!overview) {
    const en = await get(`/${kind}/${id}`, { language: "en-US" });
    overview = (en?.overview || "").trim();
  }
  if (!overview) return null;
  if (overview.length > 900) overview = overview.slice(0, 880).replace(/\s+\S*$/, "") + " …";

  const wp = d["watch/providers"]?.results?.[REGION] || {};
  const prov = {
    flat: provNames([...(wp.flatrate || []), ...(wp.free || []), ...(wp.ads || [])]),
    rent: provNames(wp.rent),
    buy: provNames(wp.buy),
  };
  const date = kind === "movie" ? d.release_date : d.first_air_date;
  const year = +(date || "").slice(0, 4) || 0;
  if (!year) return null;

  const base = {
    id: (kind === "movie" ? "m" : "t") + d.id,
    t: kind === "movie" ? "f" : "s",
    title: kind === "movie" ? d.title : d.name,
    orig: kind === "movie" ? d.original_title : d.original_name,
    year,
    genres: names(d.genres, 3),
    rating: Math.round((d.vote_average || 0) * 10) / 10,
    votes: d.vote_count || 0,
    overview,
    tagline: (d.tagline || "").trim().slice(0, 160),
    prov,
    trailer: trailerKey(d.videos),
    pop: Math.round(d.popularity || 0),
  };
  // Die App verlinkt die TMDB-Anbieterseite selbst; pop dient nur der Sortierung und fällt unten weg.

  if (kind === "movie") {
    return {
      ...base,
      runtime: d.runtime || 0,
      cast: names(d.credits?.cast, 6),
      crew: names((d.credits?.crew || []).filter(c => c.job === "Director"), 2),
      fsk: fskMovie(d),
    };
  }
  return {
    ...base,
    runtime: (d.episode_run_time || [])[0] || d.last_episode_to_air?.runtime || 0,
    seasons: d.number_of_seasons || 0,
    episodes: d.number_of_episodes || 0,
    status: d.status || "",
    cast: names(d.aggregate_credits?.cast, 6),
    crew: names(d.created_by, 2),
    network: names(d.networks, 2),
    fsk: fskTv(d),
  };
}

async function main() {
  console.log("Sammle Titel …");
  const movieIds = [...new Set(await discover("movie", "popularity.desc", PAGES.movies, MIN_VOTES.movies))];
  const tvIds = [...new Set(await discover("tv", "popularity.desc", PAGES.tv, MIN_VOTES.tv))];
  console.log(`${movieIds.length} Filme, ${tvIds.length} Serien. Lade Details …`);

  const movies = await pool(movieIds, id => detail("movie", id));
  const shows = await pool(tvIds, id => detail("tv", id));
  // Nur behalten, was laut Detaildaten wirklich im Abo, kostenlos oder mit Werbung läuft
  const items = [...movies, ...shows].filter(it => it && it.prov.flat.length).sort((a, b) => b.pop - a.pop);
  for (const it of items) delete it.pop; // Reihenfolge = Beliebtheit
  console.log(`${items.length} Titel mit deutscher Beschreibung.`);
  if (items.length < 500) throw new Error("Zu wenige Titel – Abbruch, damit der alte Katalog erhalten bleibt.");

  // In Stücke < 256 KiB teilen, damit jedes in ein Datenbank-Dokument passt.
  const chunks = []; let cur = [], size = 0;
  for (const it of items) {
    const s = Buffer.byteLength(JSON.stringify(it));
    if (size + s > CHUNK_BYTES && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(it); size += s + 1;
  }
  if (cur.length) chunks.push(cur);

  const providerCount = {};
  for (const it of items) for (const p of it.prov.flat) providerCount[p] = (providerCount[p] || 0) + 1;
  const providers = Object.entries(providerCount).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, count]) => ({ name, count }));

  const updated = new Date().toISOString();
  await rm(new URL("chunks/", OUT), { recursive: true, force: true });
  await mkdir(new URL("chunks/", OUT), { recursive: true });
  for (let i = 0; i < chunks.length; i++) {
    await writeFile(new URL(`chunks/c${String(i).padStart(2, "0")}.json`, OUT), JSON.stringify({ i, items: chunks[i] }));
  }
  await writeFile(new URL("meta.json", OUT), JSON.stringify({
    updated, count: items.length, movies: items.filter(x => x.t === "f").length, shows: items.filter(x => x.t === "s").length,
    chunks: chunks.length, providers, source: "TMDB",
  }, null, 2));
  console.log(`Fertig: ${items.length} Titel in ${chunks.length} Teilen.`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
