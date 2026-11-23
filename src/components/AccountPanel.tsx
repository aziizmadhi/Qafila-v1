"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { resetSession } from "@/lib/client/session";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Button, Panel } from "./ui";

type Step = "idle" | "sending" | "sent-upgrade" | "exists" | "sent-signin" | "error";

/**
 * Optional account. Anonymous players attach an email (same user id, nothing
 * lost). If the email already has an account, we sign in to it and merge the
 * anonymous progress on the magic-link callback (D5).
 */
export function AccountPanel({ isAnonymous, email }: { isAnonymous: boolean; email: string | null }) {
  const [value, setValue] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");
  const redirect = () => `${window.location.origin}/auth/confirm?next=/profile`;

  const upgrade = async () => {
    const addr = value.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) {
      setStep("error");
      setMessage("اكتب بريدًا إلكترونيًا صحيحًا.");
      return;
    }
    setStep("sending");
    const { error } = await getBrowserSupabase().auth.updateUser({ email: addr }, { emailRedirectTo: redirect() });
    if (!error) return setStep("sent-upgrade");
    if (error.code === "email_exists" || /already/i.test(error.message)) return setStep("exists");
    setStep("error");
    setMessage("تعذّر إرسال الرابط. حاول لاحقًا.");
  };

  const signInExisting = async () => {
    const addr = value.trim();
    setStep("sending");
    try {
      if (isAnonymous) await api.mergeTicket();
      const { error } = await getBrowserSupabase().auth.signInWithOtp({
        email: addr,
        options: { shouldCreateUser: false, emailRedirectTo: redirect() },
      });
      if (error) throw error;
      setStep("sent-signin");
    } catch {
      setStep("error");
      setMessage("تعذّر إرسال رابط الدخول. تأكد من البريد وحاول مجددًا.");
    }
  };

  const signOut = async () => {
    await getBrowserSupabase().auth.signOut();
    resetSession();
    window.location.assign("/");
  };

  if (!isAnonymous) {
    return (
      <Panel>
        <h2 className="mb-1 font-bold">الحساب</h2>
        <p className="mb-3 text-sm">
          تقدمك محفوظ في حساب <b dir="ltr">{email}</b>. ادخل بالبريد نفسه على أي جهاز.
        </p>
        <Button variant="secondary" onClick={() => void signOut()}>
          تسجيل الخروج
        </Button>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="mb-1 font-bold">احفظ تقدمك</h2>
      <p className="mb-2 text-sm">
        أنت تلعب كضيف على هذا الجهاز. أضف بريدك لتحفظ سلسلتك وسجلك وتلعب من أي جهاز. لا كلمات مرور: نرسل لك رابطًا.
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void (step === "exists" ? signInExisting() : upgrade());
        }}
      >
        <label htmlFor="email" className="sr-only">
          البريد الإلكتروني
        </label>
        <input
          id="email"
          className="pixel-input !text-base"
          type="email"
          dir="ltr"
          autoComplete="email"
          inputMode="email"
          placeholder="name@example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={step === "sending"}
        />
        {step === "exists" ? (
          <>
            <p className="text-sm font-bold">هذا البريد مسجّل مسبقًا. ادخل إليه وسندمج رحلاتك الحالية معه.</p>
            <Button type="submit">أرسل رابط الدخول</Button>
          </>
        ) : (
          <Button type="submit" disabled={step === "sending"}>
            {step === "sending" ? "جارٍ الإرسال…" : "أرسل رابط التأكيد"}
          </Button>
        )}
      </form>
      {step === "sent-upgrade" || step === "sent-signin" ? (
        <p className="mt-2 text-sm font-bold" role="status">
          أرسلنا رابطًا إلى بريدك. افتحه على هذا الجهاز ليكتمل الحفظ.
        </p>
      ) : null}
      {step === "error" ? (
        <p className="mt-2 text-sm font-bold text-terracotta" role="alert">
          {message}
        </p>
      ) : null}
      {step === "idle" ? (
        <button type="button" className="mt-2 text-sm font-bold underline" onClick={() => setStep("exists")}>
          لديّ حساب بالفعل
        </button>
      ) : null}
    </Panel>
  );
}
