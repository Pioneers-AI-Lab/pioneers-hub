// Le harnais commun des suites de `npm run check:scoring` : un cas par appel, sortie en erreur au premier ecart.
export function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n${e.message}`);
    process.exit(1);
  }
}
