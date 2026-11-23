"use client";
import { useState } from "react";
import { buildShareText } from "@/lib/share";
import { Button } from "./ui";

export function ShareButton(props: { journeyNumber: number; scores: number[]; totalKm: number; unlimited?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const share = async () => {
    const url = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const text = buildShareText({ ...props, url });
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2500);
  };
  return (
    <Button onClick={() => void share()} className="w-full">
      {state === "copied" ? "نُسخت النتيجة ✓" : state === "failed" ? "تعذّرت المشاركة" : "شارك رحلتك"}
    </Button>
  );
}
