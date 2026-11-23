"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { scene } from "@/game/bridge";
import type { AnswerResult, RunMode, RunState } from "@/lib/api-types";
import { categoryName } from "@/lib/categories";
import { ApiError, api } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { normalizeAnswer } from "@/lib/normalize";
import { tierById } from "@/lib/tiers";
import { Progress } from "./Progress";
import { TierIcon } from "./TierIcon";
import { Button, ButtonLink, ErrorNote, Km, Loading, Panel } from "./ui";
import { Waterskin } from "./Waterskin";

type Phase = "loading" | "intro" | "question" | "result" | "between" | "error";

const QUESTION_MS = 30_000;
/** Matches the server's MIN_ATTEMPT_GAP_MS: attempts closer than this are spaced out, not dropped. */
const MIN_ATTEMPT_GAP_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const pendingRef = useRef(false);
  const lastSentRef = useRef(0);
  const closingRef = useRef(false);
  // Normalized wrong answers already tried, per question: repeats shake at once, no request.
  const triedRef = useRef(new Map<number, Set<string>>());
  const [hurt, setHurt] = useState(0);
  const [notice, setNotice] = useState("");
  const [locked, setLocked] = useState(false);

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

  /** A question is over (first correct answer, or the clock ran out): show it and move the caravan. */
  const finishQuestion = useCallback(
    (r: AnswerResult, answer: string | null) => {
      const current = runRef.current;
      if (!current?.current || current.current.position !== r.position) return;
      setResult(r);
      setRun({
        ...current,
        totalKm: r.totalKm,
        finished: r.finished,
        current: null,
        answered: [
          ...current.answered,
          {
            position: r.position,
            category: current.current.category,
            score: r.score,
            correct: r.correct,
            timedOut: r.timedOut,
            answer,
            matched: r.matched,
          },
        ],
      });
      setNotice("");
      setLocked(false);
      setPhase("result");
      setTraveling(true);
      void scene.travel(r.score, r.tier).finally(() => setTraveling(false));
    },
    [setRun],
  );

  const recover = useCallback(
    async (e: unknown) => {
      const current = runRef.current;
      if (current && e instanceof ApiError && (e.code === "already_answered" || e.code === "not_served")) {
        try {
          applyState(await api.run(current.id));
        } catch (err) {
          fail(err);
        }
      } else {
        fail(e);
      }
    },
    [applyState, fail],
  );

  /** Wrong answer: shake the waterskin, clear the box, keep the keyboard up. */
  const wrong = useCallback((raw: string, message: string) => {
    setHurt((h) => h + 1);
    setNotice(message);
    const input = inputRef.current;
    if (input) {
      if (input.value.replace(/\s+/g, " ").trim() === raw) input.value = "";
      input.focus({ preventScroll: true });
    }
  }, []);

  const submit = useCallback(
    async (text: string) => {
      const run = runRef.current;
      if (!run?.current || locked) return;
      const position = run.current.position;
      const raw = text.replace(/\s+/g, " ").trim();
      if (!raw) return;
      const norm = normalizeAnswer(raw);
      let tried = triedRef.current.get(position);
      if (!tried) triedRef.current.set(position, (tried = new Set()));
      if (tried.has(norm)) {
        wrong(raw, "جرّبت هذه الإجابة من قبل.");
        return;
      }
      if (pendingRef.current) return;
      pendingRef.current = true;
      try {
        const wait = lastSentRef.current + MIN_ATTEMPT_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastSentRef.current = Date.now();
        const r = await api.answer(run.id, position, raw);
        if (r.correct || r.timedOut) {
          finishQuestion(r, raw);
        } else {
          tried.add(norm);
          wrong(raw, r.duplicate ? "جرّبت هذه الإجابة من قبل." : "ليست هذه. حاول مرة أخرى!");
          if (r.attemptsLeft === 0) setLocked(true);
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === "too_fast") return; // the next try goes through
        if (e instanceof ApiError && e.code === "too_many_attempts") {
          setLocked(true);
          setNotice(e.message);
          return;
        }
        await recover(e);
      } finally {
        pendingRef.current = false;
      }
    },
    [finishQuestion, locked, recover, wrong],
  );

  /** The waterskin ran dry: the server closes the question with 0 km. */
  const timeUp = useCallback(async () => {
    const run = runRef.current;
    if (!run?.current || closingRef.current) return;
    closingRef.current = true;
    const position = run.current.position;
    try {
      for (let tries = 0; ; tries++) {
        try {
          finishQuestion(await api.timeout(run.id, position), null);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === "not_yet" && tries < 3) {
            await sleep(1000); // our clock ran a little fast
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      await recover(e);
    } finally {
      closingRef.current = false;
    }
  }, [finishQuestion, recover]);

  // The waterskin: counts down from the server deadline; at zero the question closes.
  useEffect(() => {
    if (phase !== "question" || !run?.current) return;
    const deadline = Date.parse(run.current.deadline);
    let raf = 0;
    const tick = () => {
      const left = deadline - (Date.now() + offsetRef.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        void timeUp();
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
  }, [phase, run?.current, timeUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new question: fresh notice, unlocked input.
  const position = run?.current?.position;
  useEffect(() => {
    setNotice("");
    setLocked(false);
  }, [position]);

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
            <li>اكتب أي إجابة صحيحة، وبأي لهجة أو تهجئة. إن أخطأت فجرّب مجددًا حتى تنفد القربة.</li>
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

      {phase === "question" && run.current ? (
        <Panel className="rise-in" key={run.current.position}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">
              السؤال <span className="km">{run.current.position}</span> من 7
            </span>
            <span className="chip">{categoryName(run.current.category)}</span>
          </div>
          <h2 className="mb-3 text-[1.35rem] font-bold leading-snug">{run.current.text}</h2>
          <Waterskin fraction={remainingMs / QUESTION_MS} seconds={seconds} hurt={hurt} />
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
              disabled={locked}
              aria-describedby="answer-notice"
            />
            {/* preventDefault on pointer-down keeps focus (and the phone keyboard) on the input. */}
            <Button type="submit" disabled={locked} onPointerDown={(e) => e.preventDefault()}>
              أرسل الإجابة
            </Button>
            <p id="answer-notice" className="min-h-5 text-center text-sm font-bold text-terracotta" aria-live="assertive">
              {notice}
            </p>
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
