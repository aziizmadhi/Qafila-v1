"use client";
import { useEffect, useState } from "react";
import { ButtonLink, ErrorNote, Km, Loading, Panel, TopBar } from "@/components/ui";
import { scene } from "@/game/bridge";
import type { PastJourney } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";

export default function UnlimitedPage() {
  const [list, setList] = useState<PastJourney[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    scene.setPhase("home");
    scene.setHour(5, false);
    api
      .journeys()
      .then(setList)
      .catch((e) => setError(e instanceof ApiError ? e.message : "تعذّر التحميل."));
  }, []);
  return (
    <main className="flex flex-1 flex-col gap-3">
      <TopBar title="الرحلات المفتوحة" />
      <Panel>
        <p className="text-sm">
          أعد أي رحلة سابقة كما تشاء. نتائجها للمتعة فقط: لا تدخل في إحصاءات الندرة ولا في سلسلتك.
        </p>
      </Panel>
      {error ? <ErrorNote message={error} /> : null}
      {!list && !error ? <Loading /> : null}
      {list && list.length === 0 ? (
        <Panel>
          <p className="font-bold">لا توجد رحلات سابقة بعد. عد غدًا!</p>
        </Panel>
      ) : null}
      {list?.map((j) => (
        <Panel key={j.date} as="article" className="flex items-center justify-between gap-2">
          <div>
            <p className="font-bold">
              قافلة #<span className="km">{j.number}</span>
            </p>
            <p className="text-sm text-dark-brown">{formatDate(j.date)}</p>
            <p className="text-xs">
              {j.daily ? (
                <>
                  رحلتك اليومية: <Km value={j.daily.totalKm} />
                </>
              ) : (
                "لم تلعبها يومها"
              )}
              {j.bestUnlimited !== null ? (
                <>
                  {" "}
                  · أفضل إعادة: <Km value={j.bestUnlimited} />
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <ButtonLink href={`/unlimited/${j.date}`} className="!min-h-10 text-sm">
              العب
            </ButtonLink>
            {j.daily?.finished ? (
              <ButtonLink href={`/results/${j.daily.runId}`} variant="secondary" className="!min-h-10 text-sm">
                النتيجة
              </ButtonLink>
            ) : null}
          </div>
        </Panel>
      ))}
    </main>
  );
}
