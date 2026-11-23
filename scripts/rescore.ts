/**
 * npm run rescore -- (--date=YYYY-MM-DD | --all) [--renormalize] [--yes]
 *
 * Re-matches responses against the current accepted answers and recomputes
 * rarity stats, scores and run totals. The importer already does this for the
 * questions it changes; use this after changing the normalizer
 * (--renormalize rebuilds every stored key from the original text first).
 */
import { parseArgs } from "node:util";
import { normalizeAnswer } from "@/lib/normalize";
import { isIsoDate } from "@/lib/time";
import { closeDb, getDb, transaction } from "@/server/db";
import { recomputeQuestion, rematchQuestion } from "@/server/scoring/recompute";
import { color, confirm, fail, loadEnv } from "./lib/cli";

const USAGE = "Usage: npm run rescore -- (--date=YYYY-MM-DD | --all) [--renormalize] [--yes]";

async function main() {
  const { values } = parseArgs({
    options: {
      date: { type: "string" },
      all: { type: "boolean", default: false },
      renormalize: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
    },
  });
  if (!values.all && !values.date) fail(USAGE);
  if (values.date && !isIsoDate(values.date)) fail(`--date must look like 2026-11-16.\n${USAGE}`);
  loadEnv();
  const db = getDb();

  const questions = await db<{ id: string; date: string; position: number }[]>`
    select q.id, j.play_date::text as date, q.position from questions q join journeys j on j.id = q.journey_id
    ${values.date ? db`where j.play_date = ${values.date}` : db``}
    order by j.play_date, q.position`;
  if (questions.length === 0) fail("No questions in scope.");
  console.log(`${questions.length} question(s) in scope${values.renormalize ? ", renormalizing stored keys" : ""}.`);
  if (!values.yes && !(await confirm("Continue?"))) fail("Aborted.", 0);

  let rematched = 0;
  let rescored = 0;
  for (const q of questions) {
    await transaction(db, async (tx) => {
      if (values.renormalize) {
        const answers = await tx<{ id: string; canonical: string; variants: string[] }[]>`
          select id, canonical, variants from answers where question_id = ${q.id}`;
        const owner = new Map<string, string>();
        for (const a of answers) {
          for (const k of [a.canonical, ...a.variants].map(normalizeAnswer).filter(Boolean)) {
            const prev = owner.get(k);
            if (prev && prev !== a.id) throw new Error(`${q.date} Q${q.position}: "${k}" now matches two canonicals`);
            owner.set(k, a.id);
          }
          await tx`update answers set canonical_key = ${normalizeAnswer(a.canonical)} where id = ${a.id}`;
        }
        await tx`delete from answer_keys where question_id = ${q.id}`;
        if (owner.size > 0) {
          await tx`
            insert into answer_keys (question_id, key, answer_id)
            select ${q.id}, k, a from unnest(${[...owner.keys()]}::text[], ${[...owner.values()]}::uuid[]) t(k, a)`;
        }
        const resp = await tx<{ id: string; raw_text: string | null }[]>`
          select id, raw_text from responses where question_id = ${q.id} and raw_text is not null`;
        for (const r of resp) await tx`update responses set norm_text = ${normalizeAnswer(r.raw_text)} where id = ${r.id}`;
        // Attempts too. Two spellings that now normalize the same are one attempt: keep the earliest.
        const tries = await tx<{ id: string; response_id: string; raw_text: string }[]>`
          select id::text, response_id, raw_text from attempts where question_id = ${q.id} order by response_id, created_at, id`;
        const seen = new Set<string>();
        const drop: string[] = [];
        const keep: Array<{ id: string; norm: string }> = [];
        for (const a of tries) {
          const norm = normalizeAnswer(a.raw_text);
          const key = `${a.response_id}\u0000${norm}`;
          if (seen.has(key)) drop.push(a.id);
          else {
            seen.add(key);
            keep.push({ id: a.id, norm });
          }
        }
        if (drop.length > 0) await tx`delete from attempts where id = any(${drop}::bigint[])`;
        // Two passes so a swap of spellings never trips the uniqueness constraint mid-update.
        if (keep.length > 0) {
          await tx`update attempts set norm_text = '\u0001' || id::text where id = any(${keep.map((k) => k.id)}::bigint[])`;
          await tx`
            update attempts t set norm_text = u.norm
            from unnest(${keep.map((k) => k.id)}::bigint[], ${keep.map((k) => k.norm)}::text[]) as u(id, norm)
            where t.id = u.id`;
        }
      }
      rematched += (await rematchQuestion(tx, q.id)).changed;
      rescored += (await recomputeQuestion(tx, q.id)).rescored;
    });
  }
  console.log(color.green(`✔ Done: ${rematched} response(s) re-matched, ${rescored} rescored.`));
}

main()
  .catch((e) => {
    console.error(color.red(`Rescore failed: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
