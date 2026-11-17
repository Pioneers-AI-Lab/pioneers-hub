// Verification des regles de calcul pures (shared/, compile dans functions/lib) :
// chaque fichier de scripts/check-scoring/ est une suite de cas ecrits a la main,
// avec le resultat attendu. Sortie en erreur au premier ecart, comme check:rules.
// Lancement : npm run check:scoring (compile functions puis lance ce script).
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "check-scoring");
const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
for (const file of files) {
  console.log(`\n== ${file}`);
  await import(pathToFileURL(join(dir, file)).href);
}
console.log(`\nOK: ${files.length} suites.`);
