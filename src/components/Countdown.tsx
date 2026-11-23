"use client";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/client/format";

export function Countdown({ to, onDone }: { to: string; onDone?: () => void }) {
  const target = Date.parse(to);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = target - now;
  useEffect(() => {
    if (left <= 0) onDone?.();
  }, [left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <time dateTime={to} className="km font-bold" dir="ltr">
      {formatCountdown(left)}
    </time>
  );
}
