"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { ErrorNote, Km, Loading, Panel, TopBar } from "@/components/ui";
import { scene } from "@/game/bridge";
import type { ProfileInfo } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client/api";
import { formatShortDate, pluralDays } from "@/lib/client/format";
import { journeyTier } from "@/lib/tiers";

export default function ProfilePage() {
  const [p, setP] = useState<ProfileInfo | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    scene.setPhase("home");
    scene.setHour(3, false);
    const q = new URLSearchParams(window.location.search);
    if (q.get("auth") === "ok") {
      const merged = Number(q.get("merged") ?? 0);
      setNotice(merged > 0 ? `تم تسجيل الدخول ودمج ${merged} رحلة في حسابك.` : "تم تأكيد بريدك وحفظ تقدمك.");
    } else if (q.get("auth") === "failed") {
      setNotice("انتهت صلاحية الرابط أو فُتح على جهاز آخر. اطلب رابطًا جديدًا.");
    }
    api
      .me()
      .then(setP)
      .catch((e) => setError(e instanceof ApiError ? e.message : "تعذّر التحميل."));
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-3">
      <TopBar title="حسابي" />
      {notice ? (
        <Panel>
          <p className="font-bold" role="status">
            {notice}
          </p>
        </Panel>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {!p && !error ? <Loading /> : null}
      {p ? (
        <>
          <Panel>
            <dl className="grid grid-cols-2 gap-3 text-center">
              <Stat label="السلسلة الحالية" value={`🔥 ${pluralDays(p.streak)}`} />
              <Stat label="أطول سلسلة" value={pluralDays(p.bestStreak)} />
              <Stat label="أبعد مسافة" value={<Km value={p.bestKm} />} />
              <Stat label="الرحلات اليومية" value={<span className="km">{p.journeys}</span>} />
              <Stat label="متوسط المسافة" value={<Km value={p.averageKm} />} />
              <Stat label="أفضل مرتبة" value={p.journeys > 0 ? journeyTier(p.bestKm).name : "—"} />
            </dl>
          </Panel>
          <AccountPanel isAnonymous={p.isAnonymous} email={p.email} />
          <Panel>
            <h2 className="mb-2 font-bold">سجل الرحلات</h2>
            {p.history.length === 0 ? (
              <p className="text-sm">لم تبدأ أي رحلة بعد.</p>
            ) : (
              <ul className="divide-y-2 divide-dark-brown/20">
                {p.history.map((h) => (
                  <li key={h.runId} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      قافلة #<span className="km">{h.number}</span> · {formatShortDate(h.date)}
                      {h.mode === "unlimited" ? <span className="chip ms-1">مفتوحة</span> : null}
                    </span>
                    {h.finished ? (
                      <Link href={`/results/${h.runId}`} className="font-bold underline">
                        <Km value={h.totalKm} />
                      </Link>
                    ) : (
                      <span className="text-dark-brown">لم تكتمل</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold text-dark-brown">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
    </div>
  );
}
