"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Countdown } from "@/components/Countdown";
import { Button, ButtonLink, ErrorNote, Km, Loading, Panel } from "@/components/ui";
import { scene } from "@/game/bridge";
import type { TodayInfo } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client/api";
import { formatDate, pluralDays } from "@/lib/client/format";
import { TIERS } from "@/lib/tiers";

export default function HomePage() {
  const [info, setInfo] = useState<TodayInfo | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api
      .today()
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : "تعذّر الاتصال."));
  }, []);

  useEffect(() => {
    scene.setPhase("home");
    load();
  }, [load]);

  return (
    <main className="flex flex-1 flex-col gap-4">
      <header className="pt-6 text-center text-ivory">
        <h1 className="text-6xl font-bold tracking-tight drop-shadow-[0_4px_0_rgba(26,18,34,0.85)]">قافلة</h1>
        <p className="mx-auto mt-2 max-w-xs font-bold drop-shadow-[0_2px_0_rgba(26,18,34,0.9)]">
          سبعة أسئلة كل يوم. كلما كانت إجابتك أندر، قطعت قافلتك مسافة أبعد.
        </p>
      </header>

      <div className="min-h-[24dvh] flex-1" />

      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!info && !error ? <Loading /> : null}

      {info ? (
        <Panel className="rise-in">
          <div className="mb-2 flex items-center justify-between text-sm font-bold">
            <span>{info.journey.exists ? <>قافلة #<span className="km">{info.journey.number}</span></> : "قافلة اليوم"}</span>
            <span className="text-dark-brown">{formatDate(info.today)}</span>
          </div>
          {!info.journey.exists ? (
            <p className="mb-3 font-bold">لا توجد قافلة اليوم. جرّب الرحلات المفتوحة!</p>
          ) : info.run?.finished ? (
            <div className="mb-3 text-center">
              <p className="font-bold">وصلت قافلتك اليوم إلى</p>
              <p className="text-3xl font-bold">
                <Km value={info.run.totalKm} />
              </p>
            </div>
          ) : info.run && info.run.answered > 0 ? (
            <p className="mb-3 font-bold">
              أجبت عن <span className="km">{info.run.answered}</span> من 7 أسئلة. القافلة تنتظرك.
            </p>
          ) : (
            <p className="mb-3">سبعة أسئلة، ثلاثون ثانية لكل سؤال، والإجابة بأي تهجئة تعرفها.</p>
          )}

          {info.journey.exists ? (
            info.run?.finished ? (
              <ButtonLink href={`/results/${info.run.id}`} className="w-full">
                شاهد نتيجتك
              </ButtonLink>
            ) : (
              <ButtonLink href="/play" className="w-full">
                {info.run && info.run.answered > 0 ? "أكمل الرحلة" : "ابدأ رحلة اليوم"}
              </ButtonLink>
            )
          ) : (
            <ButtonLink href="/unlimited" className="w-full">
              الرحلات المفتوحة
            </ButtonLink>
          )}

          <div className="mt-3 flex items-center justify-between text-sm">
            <span>
              القافلة القادمة بعد <Countdown to={info.nextResetAt} onDone={load} />
            </span>
            {info.streak > 0 ? (
              <span className="font-bold" title="أيام متتالية">
                🔥 {pluralDays(info.streak)}
              </span>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <ButtonLink href="/unlimited" variant="secondary">
          رحلات سابقة
        </ButtonLink>
        <ButtonLink href="/profile" variant="secondary">
          حسابي
        </ButtonLink>
      </div>

      <Panel as="div" className="text-sm">
        <details>
          <summary className="cursor-pointer font-bold">كيف تُلعب؟</summary>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>تبدأ القافلة كل يوم عند منتصف الليل بتوقيت الرياض، والأسئلة نفسها للجميع.</li>
            <li>اكتب إجابة صحيحة واحدة لكل سؤال. لا خيارات متعددة.</li>
            <li>الإجابة الشائعة تمشي بالقافلة قليلًا، والنادرة تجعلها تركض. الخطأ لا يحرّكها.</li>
            <li>المسافة = 100 × (1 − نسبة من أعطوا الإجابة نفسها)، وأقلها 10 كم لأي إجابة صحيحة.</li>
          </ul>
          <p className="mt-2 font-bold">المراتب</p>
          <ul className="grid grid-cols-2 gap-1">
            {TIERS.map((t) => (
              <li key={t.id}>
                {t.emoji} {t.name}
              </li>
            ))}
          </ul>
        </details>
      </Panel>

      <footer className="pb-2 text-center text-xs font-bold text-ivory drop-shadow-[0_1px_0_rgba(26,18,34,0.9)]">
        <Link href="/privacy">الخصوصية</Link> · بلا إعلانات ولا متتبّعات
      </footer>
    </main>
  );
}

