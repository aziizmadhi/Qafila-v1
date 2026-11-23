import type { Metadata } from "next";
import { Panel, TopBar } from "@/components/ui";

export const metadata: Metadata = { title: "الخصوصية" };

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col gap-3">
      <TopBar title="الخصوصية" />
      <Panel className="space-y-3 text-[0.95rem] leading-relaxed">
        <h2 className="text-xl font-bold">باختصار</h2>
        <p>قافلة لعبة بلا إعلانات وبلا متتبّعات وبلا أدوات تحليل من أطراف ثالثة. نجمع أقل ما يلزم لتعمل اللعبة.</p>

        <h3 className="font-bold">ما الذي نحفظه؟</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>معرّف حساب عشوائي يُنشأ تلقائيًا عند أول زيارة (حساب ضيف).</li>
          <li>إجاباتك وأوقاتها ونتائجك، لحساب الندرة والمسافات وسلسلتك.</li>
          <li>بريدك الإلكتروني فقط إذا اخترت حفظ تقدمك، ويُستخدم لإرسال رابط الدخول لا غير.</li>
        </ul>

        <h3 className="font-bold">كيف تُستخدم الإجابات؟</h3>
        <p>
          تُحسب نسبة كل إجابة بين جميع اللاعبين بشكل مجمّع. قد نراجع الإجابات غير المطابقة، دون أي بيانات تعريفية، لإضافة
          التهجئات الصحيحة إلى قوائم الإجابات.
        </p>

        <h3 className="font-bold">ما الذي لا نفعله؟</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>لا نبيع البيانات ولا نشاركها لأغراض إعلانية.</li>
          <li>لا نحفظ عنوان IP. يُستخدم مؤقتًا بصيغة مُعمّاة للحد من الطلبات المزعجة.</li>
          <li>الخطوط تُستضاف على خوادمنا، فلا طلبات إلى خدمات خارجية أثناء اللعب.</li>
        </ul>

        <h3 className="font-bold">الخدمات المستخدمة</h3>
        <p>تُستضاف اللعبة على Vercel، وتُخزّن البيانات وتُدار الحسابات عبر Supabase.</p>

        <h3 className="font-bold">حذف بياناتك</h3>
        <p>
          يمكنك تسجيل الخروج في أي وقت. لحذف حسابك وكل رحلاتك، راسل مشغّل اللعبة من البريد المرتبط بحسابك.
        </p>
      </Panel>
    </main>
  );
}
