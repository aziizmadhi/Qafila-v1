import type { Metadata } from "next";
import { GameScreen } from "@/components/GameScreen";
import { TopBar } from "@/components/ui";

export const metadata: Metadata = { title: "رحلة اليوم" };

export default function PlayPage() {
  return (
    <main className="flex flex-1 flex-col">
      <TopBar />
      <GameScreen mode="daily" />
    </main>
  );
}
