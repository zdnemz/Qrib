// Shared tokens. One accent (emerald), pills for buttons, 16px for cards.
export const btn =
  "rounded-full px-6 py-3 text-base font-semibold transition-colors active:scale-[0.98] disabled:opacity-50";
export const primary = `${btn} bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300`;
export const secondary = `${btn} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`;
export const card = "rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800";
export const tint = "rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900";
export const input =
  "w-full rounded-2xl border border-zinc-300 px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900";
export const muted = "text-zinc-600 dark:text-zinc-400";
export const errorCard = `${card} border-red-300 text-red-700 dark:border-red-800 dark:text-red-300`;
