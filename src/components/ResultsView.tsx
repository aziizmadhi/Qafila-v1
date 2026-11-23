"use client";
import { useEffect, useState } from "react";
import { scene } from "@/game/bridge";
import type { RunResults } from "@/lib/api-types";
import { categoryName } from "@/lib/categories";
import { ApiError, api } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { TIERS, answerTier, journeyTier } from "@/lib/tiers";
import { RouteStrip } from "./RouteStrip";
import { ShareButton } from "./ShareButton";
import { TierIcon } from "./TierIcon";
import { ButtonLink, ErrorNote, Km, Loading, Panel } from "./ui";

export function ResultsView({ runId }: { runId: string }) {
  const [data, setData] = useState<RunResults | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    scene.setPhase("results");
    let cancelled = false;
    api
      .results(runId)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        const best = Math.max(0, ...r.questions.map((q) => q.score));
        scene.setNightTier(answerTier(best)?.id ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "تعذّر تحميل النتيجة."));
    return () => {
      cancelled = true;
      scene.setNightTier(null);
    };
  }, [runId]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label="نحصي آثار القافلة…" />;

  const tier = journeyTier(data.totalKm);
  const scores = data.questions.map((q) => q.score);
  return (
    <div className="flex flex-col gap-3">
      <Panel night className="rise-in text-center">
        <p className="text-sm font-bold text-pale">
          قافلة #<span className="km">{data.journeyNumber}</span> · {formatDate(data.date)}
          {data.mode === "unlimited" ? " · رحلة مفتوحة" : ""}
        </p>
        <p className="mt-1 text-4xl font-bold text-gold">
          <Km value={data.totalKm} />
        </p>
        <p className="mt-1 flex items-center justify-center gap-2 text-lg font-bold">
          <TierIcon score={tier.minScore} scale={2} /> {tier.name}
        </p>
        <div className="my-3">
          <RouteStrip scores={scores} />
        </div>
        <ShareButton journeyNumber={data.journeyNumber} scores={scores} totalKm={data.totalKm} unlimited={data.mode === "unlimited"} />
        {data.provisional ? (
          <p className="mt-2 text-xs text-pale">المسافات مؤقتة: تُحسب نهائيًا عند منتصف الليل بتوقيت الرياض، بعد أن يجيب الجميع.</p>
        ) : null}
      </Panel>

      <h2 className="mt-1 text-center text-lg font-bold text-ivory drop-shadow-[0_2px_0_rgba(26,18,34,0.9)]">محطات الرحلة</h2>
      {data.questions.map((q) => {
        return (
          <Panel key={q.position} as="article" className="rise-in">
            <details>
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="chip mb-1">{categoryName(q.category)}</span>
                    <h3 className="font-bold leading-snug">
                      <span className="km">{q.position}.</span> {q.text}
                    </h3>
                  </div>
                  <div className="shrink-0 text-center">
                    <TierIcon score={q.score} scale={2} />
                    <Km value={q.score} className="text-sm font-bold" />
                  </div>
                </div>
                <p className="mt-1 text-sm">
                  {q.timedOut ? (
                    q.answer ? (
                      <>
                        نفد الوقت. آخر محاولة: <b dir="auto">{q.answer}</b>
                      </>
                    ) : (
                      "نفد الوقت."
                    )
                  ) : q.answer ? (
                    <>
                      إجابتك: <b dir="auto">{q.answer}</b>
                      {q.correct ? (q.matched && q.matched !== q.answer ? ` ← ${q.matched}` : "") : " (لم تُقبل)"}
                    </>
                  ) : (
                    "لم تُجب."
                  )}
                </p>
                <p className="mt-1 text-xs font-bold text-dark-brown">اضغط لعرض الإجابات المقبولة ▾</p>
              </summary>
              <ul className="mt-2 space-y-1">
                {q.answers.map((a) => (
                  <li key={a.canonical} className={`relative overflow-hidden border-2 border-dark-brown/40 px-2 py-1 text-sm ${a.yours ? "bg-gold" : "bg-ivory"}`}>
                    <div className="absolute inset-y-0 right-0 bg-sand/60" style={{ width: `${Math.min(100, a.sharePct)}%` }} aria-hidden />
                    <div className="relative flex justify-between gap-2">
                      <span className="font-bold">
                        {a.canonical}
                        {a.yours ? " ← إجابتك" : ""}
                      </span>
                      <span className="shrink-0 text-xs">
                        <span className="km" dir="ltr">{a.sharePct}%</span> · <Km value={a.score} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-dark-brown">
                {q.responses > 0 ? `أجاب ${q.responses} لاعبًا حتى الآن. ` : ""}النسب تقدير يمزج التوقع الأولي بإجابات اللاعبين.
              </p>
            </details>
          </Panel>
        );
      })}

      <Panel className="text-sm">
        <p className="mb-1 font-bold">مراتب الرحلة</p>
        <ul className="grid grid-cols-2 gap-1">
          {TIERS.map((t) => (
            <li key={t.id} className="flex items-center gap-1">
              <TierIcon score={t.minScore} scale={1} /> {t.name}: <span className="km">{t.minKm}+</span> كم
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex justify-center gap-2">
        <ButtonLink href="/">الرئيسية</ButtonLink>
        <ButtonLink href="/unlimited" variant="secondary">
          رحلات سابقة
        </ButtonLink>
      </div>
    </div>
  );
}
