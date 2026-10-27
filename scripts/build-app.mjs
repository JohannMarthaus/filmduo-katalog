// Baut die veröffentlichbare App: setzt den Startkatalog (app/catalog.txt) in app/filmduo.src.html ein.
//   node scripts/build-app.mjs   ->  app/filmduo.html
import { readFile, writeFile } from "node:fs/promises";
const src = await readFile(new URL("../app/filmduo.src.html", import.meta.url), "utf8");
const cat = (await readFile(new URL("../app/catalog.txt", import.meta.url), "utf8")).trim().replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
if (!src.includes("/*CATALOG*/``")) throw new Error("Platzhalter /*CATALOG*/`` fehlt in filmduo.src.html");
await writeFile(new URL("../app/filmduo.html", import.meta.url), src.replace("/*CATALOG*/``", "`" + cat + "`"));
console.log("app/filmduo.html geschrieben");
