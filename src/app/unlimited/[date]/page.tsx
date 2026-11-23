import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameScreen } from "@/components/GameScreen";
import { TopBar } from "@/components/ui";
import { isIsoDate } from "@/lib/time";

export const metadata: Metadata = { title: "رحلة مفتوحة" };

export default async function UnlimitedPlayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  return (
    <main className="flex flex-1 flex-col">
      <TopBar />
      <GameScreen mode="unlimited" date={date} />
    </main>
  );
}
