"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { scene } from "@/game/bridge";
import type { AnswerResult, RunMode, RunState } from "@/lib/api-types";
import { categoryName } from "@/lib/categories";
import { ApiError, api } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { tierById } from "@/lib/tiers";
import { Progress } from "./Progress";
import { TierIcon } from "./TierIcon";
import { Button, ButtonLink, ErrorNote, Km, Loading, Panel } from "./ui";
import { Waterskin } from "./Waterskin";

type Phase = "loading" | "intro" | "question" | "submitting" | "result" | "between" | "error";

const QUESTION_MS = 30_000;

export function GameScreen({ mode, date }: { mode: RunMode; date?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [run, setRunState] = useState<RunState | null>(null);
  const runRef = useRef<RunState | null>(null);
  const setRun = useCallback((s: RunState) => {
    runRef.current = s;
    setRunState(s);
  }, []);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string>("");
  const [remainingMs, setRemainingMs] = useState(QUESTION_MS);
  const [traveling, setTraveling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const offsetRef = useRef(0); // server clock − client clock
  const submittingRef = useRef(false);

  const fail = useCallback(
    (e: unknown) => {
      const current = runRef.current;
      if (e instanceof ApiError && e.code === "finished" && current) {
        router.replace(`/results/${current.id}`);
        return;
      }
      setError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع.");
      setPhase("error");
    },
    [router],
  );

  const applyState = useCallback(
    (s: RunState) => {
      setRun(s);
      if (s.finished) {
        router.replace(`/results/${s.id}`);
        return;
      }
      if (s.current) {
        offsetRef.current = Date.parse(s.current.serverNow) - Date.now();
        scene.setHour(s.current.position - 1);
        setPhase("question");
      } else {
        scene.setHour(s.answered.length);
        setPhase(s.answered.length === 0 ? "intro" : "between");
      }
    },
    [router, setRun],
  );

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      applyState(mode === "daily" ? await api.startDaily() : await api.startUnlimited(date!));
    } catch (e) {
      fail(e);
    }
  }, [applyState, date, fail, mode]);

  useEffect(() => {
    scene.setPhase("journey");
    void load();
    return () => scene.setPhase("home");
  }, [load]);

  const next = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    setResult(null);
    setPhase("loading");
    try {
      applyState(await api.next(current.id));
    } catch (e) {
      fail(e);
    }
  }, [applyState, fail]);

  const submit = useCallback(
    async (text: string) => {
      const run = runRef.current;
      if (!run?.current || submittingRef.current) return;
      submittingRef.current = true;
      const position = run.current.position;
      setPhase("submitting");
      try {
        const r = await api.answer(run.id, position, text);
        setResult(r);
        setRun({
          ...run,
          totalKm: r.totalKm,
          finished: r.finished,
          current: null,
          answered: [
            ...run.answered,
            {
              position,
              category: run.current.category,
              score: r.score,
              correct: r.correct,
              timedOut: r.timedOut,
              answer: text,
              matched: r.matched,
            },
          ],
        });
        setPhase("result");
        setTraveling(true);
        void scene.travel(r.score, r.tier).finally(() => setTraveling(false));
      } catch (e) {
        if (e instanceof ApiError && (e.code === "already_answered" || e.code === "not_served")) {
          applyState(await api.run(run.id));
        } else {
          fail(e);
        }
      } finally {
        submittingRef.current = false;
      }
    },
    [applyState, fail, setRun],
  );

  // The waterskin: counts down from the server deadline; auto-submits at zero.
  useEffect(() => {
    if (phase !== "question" || !run?.current) return;
    const deadline = Date.parse(run.current.deadline);
    let raf = 0;
    const tick = () => {
      const left = deadline - (Date.now() + offsetRef.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        void submit(inputRef.current?.value ?? "");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [phase, run?.current, submit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "loading" && !run) return <Loading />;
  if (phase === "error") return <ErrorNote message={error} onRetry={() => void load()} />;
  if (!run) return <Loading />;

  const currentPos = run.current?.position ?? null;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Panel className="py-2">
        <div className="mb-2 flex items-center justify-between text-sm font-bold">
          <span>
            قافلة #<span className="km">{run.journeyNumber}</span>
            {mode === "unlimited" ? " · رحلة مفتوحة" : ""}
          </span>
          <span className="text-dark-brown">{formatDate(run.date)}</span>
          <Km value={run.totalKm} className="text-lg" />
        </div>
        <Progress answered={run.answered} current={currentPos} />
      </Panel>

      {/* Spacer so the caravan stays visible between the panels. */}
      <div className="min-h-[22dvh] flex-1" />

      {phase === "intro" ? (
        <Panel className="rise-in">
          <h2 className="mb-2 text-xl font-bold">رحلة اليوم</h2>
          <ul className="mb-4 list-inside list-disc space-y-1 text-[0.95rem]">
            <li>سبعة أسئلة، ولكل سؤال 30 ثانية تنفد معها القربة.</li>
            <li>اكتب أي إجابة صحيحة، وبأي لهجة أو تهجئة.</li>
            <li>كلما كانت إجابتك أندر بين اللاعبين، قطعت القافلة مسافة أطول.</li>
          </ul>
          <Button className="w-full" onClick={() => void next()}>
            انطلق
          </Button>
        </Panel>
      ) : null}

      {phase === "between" ? (
        <Panel className="rise-in text-center">
          <p className="mb-3 font-bold">
            توقفت القافلة عند السؤال <span className="km">{run.answered.length}</span> من 7.
          </p>
          <Button className="w-full" onClick={() => void next()}>
            واصل المسير
          </Button>
        </Panel>
      ) : null}

      {(phase === "question" || phase === "submitting") && run.current ? (
        <Panel className="rise-in" key={run.current.position}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">
              السؤال <span className="km">{run.current.position}</span> من 7
            </span>
            <span className="chip">{categoryName(run.current.category)}</span>
          </div>
          <h2 className="mb-3 text-[1.35rem] font-bold leading-snug">{run.current.text}</h2>
          <Waterskin fraction={remainingMs / QUESTION_MS} seconds={seconds} />
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(inputRef.current?.value ?? "");
            }}
          >
            <label htmlFor="answer" className="sr-only">
              إجابتك
            </label>
            <input
              id="answer"
              ref={inputRef}
              className="pixel-input"
              dir="auto"
              type="text"
              inputMode="text"
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={120}
              placeholder="اكتب إجابتك…"
              disabled={phase === "submitting"}
            />
            <Button type="submit" disabled={phase === "submitting"}>
              {phase === "submitting" ? "جارٍ التحقق…" : "أرسل الإجابة"}
            </Button>
          </form>
        </Panel>
      ) : null}

      {phase === "result" && result ? <ResultCard result={result} traveling={traveling} onNext={() => {
        if (result.finished) router.push(`/results/${run.id}`);
        else void next();
      }} /> : null}

      {phase === "loading" ? <Loading label="…" /> : null}

      {mode === "unlimited" ? (
        <p className="text-center text-xs font-bold text-ivory drop-shadow-[0_1px_0_rgba(26,18,34,0.9)]">
          الرحلات المفتوحة لا تؤثر على إحصاءات الندرة ولا على سلسلتك.
        </p>
      ) : null}
      <div className="text-center">
        <ButtonLink href="/" variant="secondary" className="!min-h-0 !py-1 text-sm">
          الرئيسية
        </ButtonLink>
      </div>
    </div>
  );
}

function ResultCard({ result, traveling, onNext }: { result: AnswerResult; traveling: boolean; onNext: () => void }) {
  const tier = result.tier ? tierById(result.tier) : null;
  return (
    <Panel className="rise-in text-center" as="div">
      <div aria-live="polite">
        {result.timedOut ? (
          <>
            <p className="text-3xl" aria-hidden>
              💧
            </p>
            <p className="text-xl font-bold">نفدت القربة!</p>
            <p className="text-sm">لم تصل الإجابة في الوقت. بقيت القافلة في مكانها.</p>
          </>
        ) : result.correct ? (
          <>
            <TierIcon score={result.score} scale={4} className="mx-auto" />
            <p className="text-2xl font-bold">
              + <Km value={result.score} />
            </p>
            <p className="font-bold text-dark-brown">{tier?.name}</p>
            {result.matched ? (
              <p className="mt-1 text-sm">
                احتُسبت إجابتك: <b>{result.matched}</b>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <TierIcon score={0} scale={4} className="mx-auto" />
            <p className="text-xl font-bold">لم تجد القافلة هذه الإجابة</p>
            <p className="text-sm">ستظهر الإجابات المقبولة في نهاية الرحلة.</p>
          </>
        )}
      </div>
      <Button className="mt-3 w-full" onClick={onNext} disabled={traveling}>
        {result.finished ? "إلى المخيّم: النتيجة" : traveling ? "القافلة تسير…" : "السؤال التالي"}
      </Button>
    </Panel>
  );
}
