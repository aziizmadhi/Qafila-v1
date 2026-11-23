"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { scene } from "@/game/bridge";
import type { AnswerResult, CurrentQuestion, RunMode, RunState } from "@/lib/api-types";
import { categoryName } from "@/lib/categories";
import { ApiError, api } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { normalizeAnswer } from "@/lib/normalize";
import { tierById } from "@/lib/tiers";
import { MIN_ATTEMPT_GAP_MS, QUESTION_MS, TRANSITION_MS, nextQuestionStart } from "@/lib/timing";
import { Progress } from "./Progress";
import { TierIcon } from "./TierIcon";
import { Button, ButtonLink, ErrorNote, Km, Loading, Panel } from "./ui";
import { Waterskin } from "./Waterskin";

/**
 * loading → intro → (question ⇄ result)… → results page.
 * After "انطلق" the clock is chained on the server: each question starts
 * TRANSITION_MS after the previous one ends, so moving on needs no request.
 * All seven question texts are already in memory.
 */
type Phase = "loading" | "intro" | "question" | "result" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

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
  const timeUpWhilePendingRef = useRef(false);
  const lastSentRef = useRef(0);
  // Normalized wrong answers already tried, per question: repeats shake at once, no request.
  const triedRef = useRef(new Map<number, Set<string>>());
  const [hurt, setHurt] = useState(0);
  const [notice, setNotice] = useState("");
  const [locked, setLocked] = useState(false);
  // Ticks while waiting for the next question's clock to start.
  const [, setTick] = useState(0);

  /** Server time now, in client milliseconds. */
  const serverNow = () => Date.now() + offsetRef.current;
  const syncClock = (serverIso: string, sentAt: number) => {
    offsetRef.current = Date.parse(serverIso) - (sentAt + Date.now()) / 2;
  };

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
    (s: RunState, sentAt: number) => {
      syncClock(s.serverNow, sentAt);
      setRun(s);
      setResult(null);
      if (s.finished) {
        router.replace(`/results/${s.id}`);
        return;
      }
      if (!s.questions || !s.current) {
        scene.setHour(0);
        setPhase("intro");
        return;
      }
      scene.setHour(s.current.position - 1);
      setPhase(Date.parse(s.current.servedAt) <= serverNow() ? "question" : "result");
    },
    [router, setRun],
  );

  const load = useCallback(async () => {
    setPhase("loading");
    const sentAt = Date.now();
    try {
      applyState(mode === "daily" ? await api.startDaily() : await api.startUnlimited(date!), sentAt);
    } catch (e) {
      fail(e);
    }
  }, [applyState, date, fail, mode]);

  useEffect(() => {
    scene.setPhase("journey");
    void load();
    return () => scene.setPhase("home");
  }, [load]);

  const begin = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    setPhase("loading");
    const sentAt = Date.now();
    try {
      applyState(await api.begin(current.id), sentAt);
    } catch (e) {
      fail(e);
    }
  }, [applyState, fail]);

  const recover = useCallback(
    async (e: unknown) => {
      const current = runRef.current;
      if (current && e instanceof ApiError && (e.code === "already_answered" || e.code === "not_served")) {
        const sentAt = Date.now();
        try {
          applyState(await api.run(current.id), sentAt);
        } catch (err) {
          fail(err);
        }
      } else {
        fail(e);
      }
    },
    [applyState, fail],
  );

  /** A question is over (first correct answer, or the clock ran out): show it and move the caravan at once. */
  const finishQuestion = useCallback(
    (r: AnswerResult, answer: string | null) => {
      const current = runRef.current;
      if (!current?.current || current.current.position !== r.position) return;
      const position = r.position;
      const next: CurrentQuestion | null = r.next
        ? {
            position: r.next.position,
            servedAt: r.next.servedAt,
            deadline: new Date(Date.parse(r.next.servedAt) + QUESTION_MS).toISOString(),
            attempts: 0,
          }
        : null;
      setRun({
        ...current,
        totalKm: r.totalKm,
        finished: r.finished,
        current: next,
        answered: [
          ...current.answered,
          {
            position,
            category: current.questions?.[position - 1]?.category ?? "",
            score: r.score,
            correct: r.correct,
            timedOut: r.timedOut,
            answer,
            matched: r.matched,
          },
        ],
      });
      setResult(r);
      setNotice("");
      setLocked(false);
      setPhase("result");
      if (r.correct && inputRef.current) inputRef.current.value = "";
      setTraveling(true);
      void scene.travel(r.score, r.tier).finally(() => setTraveling(false));
    },
    [setRun],
  );

  /** Wrong answer: shake the waterskin, clear the box, keep the keyboard up. */
  const wrong = useCallback((raw: string, message: string) => {
    setHurt((h) => h + 1);
    setNotice(message);
    const input = inputRef.current;
    if (input) {
      if (clean(input.value) === raw) input.value = "";
      input.focus({ preventScroll: true });
    }
  }, []);

  /** The waterskin ran dry. The server's clock does the same on its own: no request needed. */
  const timeUp = useCallback(() => {
    const current = runRef.current?.current;
    const state = runRef.current;
    if (!current || !state) return;
    if (pendingRef.current) {
      // An answer is on its way: let the server's verdict decide.
      timeUpWhilePendingRef.current = true;
      return;
    }
    const servedAt = Date.parse(current.servedAt);
    const last = current.position >= state.questionCount;
    finishQuestion(
      {
        position: current.position,
        correct: false,
        timedOut: true,
        score: 0,
        tier: null,
        matched: null,
        totalKm: state.totalKm,
        finished: last,
        next: last
          ? null
          : { position: current.position + 1, servedAt: new Date(nextQuestionStart(servedAt, null)).toISOString() },
        serverNow: new Date(serverNow()).toISOString(),
      },
      null,
    );
  }, [finishQuestion]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(
    async (text: string) => {
      const state = runRef.current;
      if (phase !== "question" || !state?.current || locked) return;
      const position = state.current.position;
      const raw = clean(text);
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
      timeUpWhilePendingRef.current = false;
      try {
        const wait = lastSentRef.current + MIN_ATTEMPT_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastSentRef.current = Date.now();
        const sentAt = Date.now();
        const r = await api.answer(state.id, position, raw);
        syncClock(r.serverNow, sentAt);
        pendingRef.current = false;
        if (r.correct || r.timedOut) {
          finishQuestion(r, raw);
          return;
        }
        tried.add(norm);
        if (timeUpWhilePendingRef.current) {
          timeUp();
          return;
        }
        wrong(raw, r.duplicate ? "جرّبت هذه الإجابة من قبل." : "ليست هذه. حاول مرة أخرى!");
        if (r.attemptsLeft === 0) setLocked(true);
      } catch (e) {
        pendingRef.current = false;
        if (timeUpWhilePendingRef.current) {
          timeUp();
          return;
        }
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
    [finishQuestion, locked, phase, recover, timeUp, wrong], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The waterskin counts down from the server deadline; at zero the question closes.
  useEffect(() => {
    if (phase !== "question" || !run?.current) return;
    const deadline = Date.parse(run.current.deadline);
    let raf = 0;
    const tick = () => {
      const left = deadline - serverNow();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        timeUp();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    inputRef.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(raf);
  }, [phase, run?.current, timeUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Between questions: start the next one exactly when its (server) clock starts.
  useEffect(() => {
    if (phase !== "result" || !run) return;
    if (run.finished || !run.current) {
      const t = window.setTimeout(() => router.push(`/results/${run.id}`), TRANSITION_MS);
      return () => window.clearTimeout(t);
    }
    const startsAt = Date.parse(run.current.servedAt);
    const iv = window.setInterval(() => setTick((n) => n + 1), 250);
    const t = window.setTimeout(
      () => {
        setResult(null);
        scene.setHour(run.current!.position - 1);
        setPhase("question");
      },
      Math.max(0, startsAt - serverNow()),
    );
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [phase, run, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new question: fresh notice, unlocked input.
  const position = run?.current?.position;
  useEffect(() => {
    setNotice("");
    setLocked(false);
  }, [position]);

  if (phase === "loading" && !run) return <Loading />;
  if (phase === "error") return <ErrorNote message={error} onRetry={() => void load()} />;
  if (!run) return <Loading />;

  const inJourney = phase === "question" || phase === "result";
  const shown = phase === "question" ? run.current : null;
  const q = shown ? run.questions?.[shown.position - 1] : null;
  const seconds = Math.ceil(remainingMs / 1000);
  const startsIn = phase === "result" && run.current ? Math.max(0, Date.parse(run.current.servedAt) - serverNow()) : 0;
  const progressCurrent = phase === "question" ? (run.current?.position ?? null) : null;

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
        <Progress answered={run.answered} current={progressCurrent} />
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
            <li>بعد الانطلاق لا تتوقف القافلة: يبدأ كل سؤال بعد السابق مباشرة.</li>
          </ul>
          <Button className="w-full" onClick={() => void begin()}>
            انطلق
          </Button>
        </Panel>
      ) : null}

      {inJourney ? (
        // One panel for the whole journey: the input stays mounted (and focused) between questions,
        // so the phone keyboard doesn't drop and come back every time.
        <Panel className="rise-in">
          {phase === "question" && shown && q ? (
            <div key={shown.position}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold">
                  السؤال <span className="km">{shown.position}</span> من 7
                </span>
                <span className="chip">{categoryName(q.category)}</span>
              </div>
              <h2 className="mb-3 text-[1.35rem] font-bold leading-snug">{q.text}</h2>
              <Waterskin fraction={remainingMs / QUESTION_MS} seconds={seconds} hurt={hurt} />
            </div>
          ) : (
            <ResultBody result={result} traveling={traveling} startsIn={startsIn} finished={run.finished} />
          )}

          {run.finished && phase === "result" ? (
            <Button className="mt-3 w-full" onClick={() => router.push(`/results/${run.id}`)}>
              إلى المخيّم: النتيجة
            </Button>
          ) : (
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
                placeholder={phase === "question" ? "اكتب إجابتك…" : "استعد للسؤال التالي…"}
                disabled={locked}
                aria-describedby="answer-notice"
              />
              {/* preventDefault on pointer-down keeps focus (and the phone keyboard) on the input. */}
              <Button
                type="submit"
                disabled={locked || phase !== "question"}
                onPointerDown={(e) => e.preventDefault()}
              >
                أرسل الإجابة
              </Button>
              <p id="answer-notice" className="min-h-5 text-center text-sm font-bold text-terracotta" aria-live="assertive">
                {notice}
              </p>
            </form>
          )}
        </Panel>
      ) : null}

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

function ResultBody({
  result,
  traveling,
  startsIn,
  finished,
}: {
  result: AnswerResult | null;
  traveling: boolean;
  startsIn: number;
  finished: boolean;
}) {
  const tier = result?.tier ? tierById(result.tier) : null;
  const footer = finished ? (
    <p className="mt-2 text-sm font-bold">{traveling ? "القافلة تسير…" : "وصلت القافلة إلى المخيّم."}</p>
  ) : (
    <p className="mt-2 text-sm font-bold text-dark-brown">
      السؤال التالي بعد <span className="km">{Math.max(1, Math.ceil(startsIn / 1000))}</span>…
    </p>
  );
  return (
    <div className="text-center" aria-live="polite">
      {!result ? (
        <p className="py-6 text-lg font-bold">استعد للسؤال التالي…</p>
      ) : result.timedOut ? (
        <>
          <p className="text-3xl" aria-hidden>
            💧
          </p>
          <p className="text-xl font-bold">نفدت القربة!</p>
          <p className="text-sm">لم تصل إجابة صحيحة في الوقت. بقيت القافلة في مكانها.</p>
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
      ) : null}
      {footer}
    </div>
  );
}
