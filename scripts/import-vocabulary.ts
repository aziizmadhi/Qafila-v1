/**
 * npm run import-vocabulary -- <file.csv> [--yes]
 *
 * Adds extra words to the answer-suggestion pools. CSV columns: category,name.
 * Suggestions already include every canonical answer in a category; use this
 * for plausible extra names (more countries, cities, players…) so that a
 * suggestion appearing never hints that it is the right answer.
 * Existing spellings (after normalization) are skipped; nothing is removed.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { insertVocabulary, newVocabulary, parseVocabularyCsv } from "@/server/content/vocabulary";
import { closeDb, getDb } from "@/server/db";
import { color, confirm, fail, loadEnv } from "./lib/cli";

const USAGE = "Usage: npm run import-vocabulary -- <file.csv> [--yes]";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length !== 1) fail(USAGE, values.help ? 0 : 1);
  const file = positionals[0]!;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`Cannot read ${file}`);
  }
  loadEnv();
  const db = getDb();
  const categories = new Set((await db<{ slug: string }[]>`select slug from categories`).map((r) => r.slug));
  const parsed = parseVocabularyCsv(text, categories);
  for (const w of parsed.warnings) console.log(color.yellow(w));
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) console.log(color.red(e));
    fail(color.red(`\n${parsed.errors.length} error(s) in ${file}. Nothing was imported.`));
  }
  const fresh = await newVocabulary(db, parsed.entries);
  const perCategory = new Map<string, number>();
  for (const e of fresh) perCategory.set(e.category, (perCategory.get(e.category) ?? 0) + 1);
  console.log(`${parsed.entries.length} word(s) in the file, ${fresh.length} new:`);
  for (const [c, n] of perCategory) console.log(`  ${c}: +${n}`);
  if (fresh.length === 0) {
    console.log(color.green("Nothing to do."));
    return;
  }
  if (!values.yes) {
    if (!process.stdin.isTTY) fail("Not a terminal: re-run with --yes to apply.");
    if (!(await confirm("Add them?"))) fail("Aborted. Nothing was changed.", 0);
  }
  const added = await insertVocabulary(db, fresh);
  console.log(color.green(`✔ Added ${added} word(s).`));
}

main()
  .catch((e) => {
    console.error(color.red(`Import failed: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
