/** Mirror of the `categories` table seed (the database is the source of truth). */
export const CATEGORIES = {
  geography: "جغرافيا",
  history: "تاريخ",
  sports: "رياضة",
  food: "طعام ومطبخ",
  culture: "ثقافة وفنون",
  science: "علوم",
  nature: "طبيعة",
  language: "لغة",
} as const;

export type CategorySlug = keyof typeof CATEGORIES;

export function categoryName(slug: string): string {
  return (CATEGORIES as Record<string, string>)[slug] ?? slug;
}

export function isCategory(slug: string): slug is CategorySlug {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, slug);
}
