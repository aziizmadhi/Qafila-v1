import { Panel } from "@/components/ui";

export const metadata = { title: "غير متصل" };

export default function OfflinePage() {
  return (
    <main className="flex flex-1 items-center">
      <Panel className="w-full text-center">
        <p className="text-4xl" aria-hidden>
          🏜️
        </p>
        <h1 className="text-xl font-bold">لا يوجد اتصال</h1>
        <p className="mt-1">القافلة تحتاج إلى الإنترنت لتعرف رأي بقية الرحّالة. عد حين يعود الاتصال.</p>
      </Panel>
    </main>
  );
}
