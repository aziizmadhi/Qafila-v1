import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Panel({
  children,
  className = "",
  night = false,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  night?: boolean;
  as?: "section" | "div" | "article" | "header";
}) {
  return <Tag className={`pixel-panel ${night ? "pixel-panel--night" : ""} ${className}`}>{children}</Tag>;
}

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" };

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`pixel-button ${variant === "secondary" ? "pixel-button--secondary" : ""} ${className}`}
    />
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  return (
    <Link href={href} className={`pixel-button ${variant === "secondary" ? "pixel-button--secondary" : ""} ${className}`}>
      {children}
    </Link>
  );
}

export function TopBar({ title }: { title?: string }) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2 text-ivory">
      <Link href="/" className="flex items-center gap-2 text-xl font-bold drop-shadow-[0_2px_0_rgba(26,18,34,0.9)]">
        <span aria-hidden>🐪</span>
        <span>قافلة</span>
      </Link>
      {title ? <h1 className="truncate text-base font-bold drop-shadow-[0_2px_0_rgba(26,18,34,0.9)]">{title}</h1> : null}
      <nav className="flex items-center gap-3 text-sm font-bold drop-shadow-[0_2px_0_rgba(26,18,34,0.9)]">
        <Link href="/unlimited">الرحلات</Link>
        <Link href="/profile">حسابي</Link>
      </nav>
    </header>
  );
}

export function Loading({ label = "تجهيز القافلة…" }: { label?: string }) {
  return (
    <div role="status" className="py-10 text-center font-bold text-ivory drop-shadow-[0_2px_0_rgba(26,18,34,0.9)]">
      <span className="inline-block animate-bounce" aria-hidden>
        🐪
      </span>{" "}
      {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Panel className="text-center">
      <p className="mb-3 font-bold">{message}</p>
      {onRetry ? <Button onClick={onRetry}>حاول مرة أخرى</Button> : <ButtonLink href="/">العودة للرئيسية</ButtonLink>}
    </Panel>
  );
}

export function Km({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`km ${className}`} dir="rtl">
      {Math.round(value)} كم
    </span>
  );
}
