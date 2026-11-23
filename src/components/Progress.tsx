import { TierIcon } from "./TierIcon";
import type { AnsweredQuestion } from "@/lib/api-types";

/** Seven stops on the route, right to left: done (tier emoji), current, upcoming. */
export function Progress({ answered, current, total = 7 }: { answered: AnsweredQuestion[]; current: number | null; total?: number }) {
  return (
    <ol className="flex items-center justify-between gap-1" aria-label="تقدم الرحلة">
      {Array.from({ length: total }, (_, i) => {
        const pos = i + 1;
        const done = answered.find((a) => a.position === pos);
        const isCurrent = current === pos;
        const label = done
          ? `السؤال ${pos}: ${done.score} كم`
          : isCurrent
            ? `السؤال ${pos}: الآن`
            : `السؤال ${pos}`;
        return (
          <li
            key={pos}
            aria-label={label}
            className={`flex h-9 w-9 items-center justify-center border-[3px] text-base ${
              done
                ? "border-dark-brown bg-pale"
                : isCurrent
                  ? "border-gold bg-ember text-ivory"
                  : "border-dark-brown/60 bg-sand-shadow/50 text-dark-brown"
            }`}
          >
            {done ? <TierIcon score={done.score} scale={1.5} /> : <span className="km text-sm font-bold">{pos}</span>}
          </li>
        );
      })}
    </ol>
  );
}
