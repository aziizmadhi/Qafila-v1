/** Western digits everywhere (D4). */
const dateFmt = new Intl.DateTimeFormat("ar-u-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const shortDateFmt = new Intl.DateTimeFormat("ar-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T12:00:00Z`));
}

export function formatShortDate(iso: string): string {
  return shortDateFmt.format(new Date(`${iso}T12:00:00Z`));
}

export function formatKm(km: number): string {
  return `${Math.round(km)} كم`;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function pluralDays(n: number): string {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}
