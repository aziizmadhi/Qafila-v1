import type { Metadata } from "next";
import { ResultsView } from "@/components/ResultsView";
import { TopBar } from "@/components/ui";

export const metadata: Metadata = { title: "نتيجة الرحلة" };

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="flex flex-1 flex-col">
      <TopBar />
      <ResultsView runId={runId} />
    </main>
  );
}
