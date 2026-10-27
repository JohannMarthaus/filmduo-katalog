// Plant das Hochladen des Katalogs (Branch "katalog") in die Datenbank der App.
// Wird von der wöchentlichen geplanten Aufgabe in Claude benutzt.
//
//   node scripts/plan-upload.mjs <katalog-ordner> <versionen> [aktueller-stand]
//
//   <katalog-ordner>   ausgecheckter Branch "katalog" (meta.json, chunks/c00.json …)
//   <versionen>        vorhandene Dokumente in "catalog" mit Version, z. B. "meta=4,c00=4,c01=4" (oder "-" wenn leer)
//   [aktueller-stand]  "updated" aus catalog/meta in der Datenbank (oder weglassen)
//
// Gibt JSON aus: {skip, reason, meta, batches:[[{op,collection,doc_id,file_path,if_version?}, …], …]}
// Die Teile kommen zuerst, catalog/meta immer zuletzt in einem eigenen Schritt.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const [dir, versArg = "-", current = ""] = process.argv.slice(2);
if (!dir) { console.error("Aufruf: node scripts/plan-upload.mjs <katalog-ordner> <versionen> [aktueller-stand]"); process.exit(2); }
const root = resolve(dir);
const fail = msg => { console.log(JSON.stringify({ skip: true, reason: msg, batches: [] }, null, 2)); process.exit(1); };

const versions = new Map();
if (versArg !== "-") for (const part of versArg.split(",").filter(Boolean)) {
  const [k, v] = part.split("=");
  if (!/^(meta|c\d{2,3})$/.test(k) || !(+v > 0)) fail(`Ungültige Versionsangabe: ${part}`);
  versions.set(k, +v);
}

let meta;
try { meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8")); } catch (e) { fail("meta.json fehlt oder ist kaputt: " + e.message); }
if (!meta.updated || !(meta.chunks > 0) || !(meta.count >= 500)) fail(`meta.json unplausibel (count=${meta.count}, chunks=${meta.chunks})`);
if (Date.now() - Date.parse(meta.updated) > 10 * 86400e3) fail(`Katalog ist älter als 10 Tage (${meta.updated}) – läuft die GitHub Action noch?`);
if (current && current === meta.updated) { console.log(JSON.stringify({ skip: true, reason: `Datenbank ist schon auf Stand ${meta.updated}`, batches: [] }, null, 2)); process.exit(0); }

const files = (await readdir(join(root, "chunks"))).filter(f => /^c\d{2,3}\.json$/.test(f)).sort();
if (files.length !== meta.chunks) fail(`meta.json nennt ${meta.chunks} Teile, gefunden: ${files.length}`);

let total = 0;
const writes = [];
for (const f of files) {
  const p = join(root, "chunks", f), size = (await stat(p)).size;
  if (size > 250_000) fail(`${f} ist mit ${size} Bytes zu groß für ein Datenbank-Dokument`);
  const doc = JSON.parse(await readFile(p, "utf8"));
  if (!Array.isArray(doc.items) || !doc.items.length) fail(`${f} enthält keine Titel`);
  total += doc.items.length;
  const id = f.replace(".json", "");
  writes.push({ op: "set", collection: "catalog", doc_id: id, file_path: p, size, ...(versions.has(id) ? { if_version: versions.get(id) } : {}) });
}
if (total !== meta.count) fail(`meta.json nennt ${meta.count} Titel, in den Teilen sind ${total}`);

// Batches bis knapp unter 1 MiB
const batches = []; let cur = [], size = 0;
for (const w of writes) {
  if (cur.length && (size + w.size > 900_000 || cur.length >= 45)) { batches.push(cur); cur = []; size = 0; }
  cur.push(w); size += w.size;
}
if (cur.length) batches.push(cur);
for (const b of batches) for (const w of b) delete w.size;

// Alte Teile, die es nicht mehr gibt, entfernen (vor meta, damit die App sie nie mitliest)
const newIds = new Set(writes.map(w => w.doc_id));
const stale = [...versions.entries()].filter(([k]) => k !== "meta" && !newIds.has(k)).map(([k, v]) => ({ op: "delete", collection: "catalog", doc_id: k, if_version: v }));
if (stale.length) batches.push(stale);

batches.push([{ op: "set", collection: "catalog", doc_id: "meta", file_path: join(root, "meta.json"), ...(versions.has("meta") ? { if_version: versions.get("meta") } : {}) }]);

console.log(JSON.stringify({ skip: false, meta: { updated: meta.updated, count: meta.count, chunks: meta.chunks }, batches }, null, 2));
