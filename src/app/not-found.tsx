import { ButtonLink, Panel } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center">
      <Panel className="w-full text-center">
        <p className="text-4xl" aria-hidden>
          🌫️
        </p>
        <h1 className="text-xl font-bold">ضلّت القافلة الطريق</h1>
        <p className="mb-3 mt-1">هذه الصفحة سراب.</p>
        <ButtonLink href="/">العودة للرئيسية</ButtonLink>
      </Panel>
    </main>
  );
}
