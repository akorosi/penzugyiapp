const huf = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("hu-HU", { notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("hu-HU", { style: "percent", maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "short" });

export const formatHuf = (v: number) => huf.format(v);
export const formatNumber = (v: number) => num.format(v);
export const formatCompact = (v: number) => compact.format(v);
export const formatPercent = (v: number) => pct.format(v);

/** "2024-03-15" → "2024. 03. 15." */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${y}. ${m}. ${d}.`;
}

/** "2024-03" → "2024. márc." */
export function formatMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return monthFmt.format(new Date(y, m - 1, 1));
}
