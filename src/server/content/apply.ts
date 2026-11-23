import { transaction, type Db } from "@/server/db";
import { recomputeQuestion, rematchQuestion } from "@/server/scoring/recompute";
import type { ContentDiff } from "./diff";

export interface ApplyOptions {
  fileName: string;
  sha256: string;
  allowRemovals: boolean;
}

export interface ApplySummary {
  journeysCreated: number;
  journeysChanged: number;
  questionsWritten: number;
  answersAdded: number;
  answersUpdated: number;
  answersRemoved: number;
  responsesRematched: number;
  newlyMatched: number;
  newlyUnmatched: number;
  responsesRescored: number;
}

export class RemovalBlockedError extends Error {}

/** Upsert the diffed content and retroactively rematch/rescore, all in one transaction. */
export async function applyContent(db: Db, diff: ContentDiff, opts: ApplyOptions): Promise<ApplySummary> {
  if (diff.riskyRemovals.length > 0 && !opts.allowRemovals) {
    throw new RemovalBlockedError(
      `${diff.riskyRemovals.length} removed answer(s) were already matched by players. Re-run with --allow-removals to remove them; those responses will be re-matched (and score 0 if nothing else matches).`,
    );
  }
  const summary: ApplySummary = {
    journeysCreated: 0,
    journeysChanged: 0,
    questionsWritten: 0,
    answersAdded: 0,
    answersUpdated: 0,
    answersRemoved: 0,
    responsesRematched: 0,
    newlyMatched: 0,
    newlyUnmatched: 0,
    responsesRescored: 0,
  };

  await transaction(db, async (tx) => {
    for (const jd of diff.journeys) {
      const [journey] = await tx<{ id: string }[]>`
        insert into journeys (play_date, track) values (${jd.input.date}, ${jd.input.track})
        on conflict (play_date, track) do update set updated_at = now()
        returning id`;
      if (jd.isNew) summary.journeysCreated++;
      else summary.journeysChanged++;

      for (const qd of jd.questions) {
        const q = qd.input;
        const [question] = await tx<{ id: string }[]>`
          insert into questions (journey_id, position, category, text)
          values (${journey!.id}, ${q.position}, ${q.category}, ${q.text})
          on conflict (journey_id, position) do update set category = excluded.category, text = excluded.text
          returning id`;
        const qid = question!.id;
        summary.questionsWritten++;

        for (const c of qd.answers) {
          if (c.kind === "add") {
            const a = c.after!;
            await tx`
              insert into answers (question_id, canonical, canonical_key, variants, seed_frequency)
              values (${qid}, ${a.canonical}, ${a.key}, ${a.variants}::text[], ${a.seedFrequency})`;
            summary.answersAdded++;
          } else if (c.kind === "update") {
            const a = c.after!;
            await tx`
              update answers set canonical = ${a.canonical}, variants = ${a.variants}::text[],
                seed_frequency = ${a.seedFrequency}
              where id = ${c.before!.id}`;
            summary.answersUpdated++;
          } else {
            await tx`delete from answers where id = ${c.before!.id}`;
            summary.answersRemoved++;
          }
        }

        if (qd.keysChanged) {
          const ids = await tx<{ id: string; key: string }[]>`
            select id, canonical_key as key from answers where question_id = ${qid}`;
          const idByKey = new Map(ids.map((r) => [r.key, r.id]));
          const keys: string[] = [];
          const answerIds: string[] = [];
          for (const a of q.answers) {
            for (const k of [a.key, ...a.variantKeys]) {
              keys.push(k);
              answerIds.push(idByKey.get(a.key)!);
            }
          }
          await tx`delete from answer_keys where question_id = ${qid}`;
          await tx`
            insert into answer_keys (question_id, key, answer_id)
            select ${qid}, k, a from unnest(${keys}::text[], ${answerIds}::uuid[]) as t(k, a)`;
        }
        await tx`insert into question_stats (question_id) values (${qid}) on conflict do nothing`;

        const hasResponses = (qd.existing?.responses ?? 0) > 0;
        if (hasResponses && qd.keysChanged) {
          const r = await rematchQuestion(tx, qid);
          summary.responsesRematched += r.changed;
          summary.newlyMatched += r.newlyMatched;
          summary.newlyUnmatched += r.newlyUnmatched;
        }
        if (hasResponses && (qd.keysChanged || qd.seedsChanged)) {
          const r = await recomputeQuestion(tx, qid);
          summary.responsesRescored += r.rescored;
        }
      }
    }
    await tx`
      insert into import_runs (file_name, sha256, summary)
      values (${opts.fileName}, ${opts.sha256}, ${tx.json(summary as unknown as Record<string, number>)})`;
  });
  return summary;
}
