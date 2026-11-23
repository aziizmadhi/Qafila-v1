"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { suggest, type SuggestionIndex } from "@/lib/suggest";
import { Button } from "./ui";

/**
 * The answer input with suggestions underneath (an ARIA combobox). Tapping a
 * suggestion, or picking it with the arrow keys and Enter, fills the input;
 * the player still sends it. The send button sits beside the input, so the
 * list can never cover it. Focus never leaves the input (phone keyboard).
 */
export function AnswerBox({
  inputRef,
  value,
  onChange,
  onSubmit,
  pool,
  disabled,
  canSend,
  placeholder,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pool: SuggestionIndex | null;
  disabled: boolean;
  canSend: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(() => (pool && canSend ? suggest(pool, value) : []), [pool, value, canSend]);
  const shown = open && items.length > 0 && !disabled;

  useEffect(() => setActive(-1), [items]);

  // Keep the list visible above an on-screen keyboard.
  useEffect(() => {
    const list = listRef.current;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!shown || !list || !vv) return;
    const overflow = list.getBoundingClientRect().bottom - (vv.offsetTop + vv.height) + 8;
    if (overflow > 0) window.scrollBy({ top: overflow });
  }, [shown, items]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (shown && active >= 0) choose(items[active]!);
        else onSubmit();
      }}
    >
      <label htmlFor="answer" className="sr-only">
        إجابتك
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id="answer"
          ref={inputRef}
          className="pixel-input min-w-0 flex-1"
          dir="auto"
          type="text"
          inputMode="text"
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={120}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!shown) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls="answer-suggestions"
          aria-activedescendant={shown && active >= 0 ? `answer-suggestion-${active}` : undefined}
          aria-describedby="answer-notice"
        />
        {/* preventDefault on pointer-down keeps focus (and the phone keyboard) on the input. */}
        <Button
          type="submit"
          className="shrink-0 !px-4"
          disabled={disabled || !canSend}
          onPointerDown={(e) => e.preventDefault()}
          aria-label="أرسل الإجابة"
        >
          أرسل
        </Button>
      </div>
      {shown ? (
        <ul
          ref={listRef}
          id="answer-suggestions"
          role="listbox"
          aria-label="اقتراحات"
          className="mt-1 border-2 border-dark-brown bg-ivory"
        >
          {items.map((name, i) => (
            <li
              key={name}
              id={`answer-suggestion-${i}`}
              role="option"
              aria-selected={i === active}
              dir="auto"
              className={`flex min-h-11 cursor-pointer items-center px-3 text-right font-bold ${
                i > 0 ? "border-t border-dark-brown/30" : ""
              } ${i === active ? "bg-gold" : "active:bg-gold/60"}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(name)}
            >
              {name}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
