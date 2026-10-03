import type { AttributeNode, Filters, Transaction } from "./types";

function attributeTreeMatches(nodes: AttributeNode[], q: string): boolean {
  return nodes.some((n) => n.name.toLowerCase().includes(q) || attributeTreeMatches(n.children, q));
}

/** Szűrés: dátum, fő attribútum, típus, valamint szabad szöveges keresés a
 *  közleményben, a tranzakció típusában és az al-attribútum fában (tetszőleges mélységig). */
export function applyFilters(txs: Transaction[], f: Filters): Transaction[] {
  const q = f.search.trim().toLowerCase();
  return txs.filter((t) => {
    if (f.mainCategory && (t.main_category ?? "") !== f.mainCategory) return false;
    if (f.kind === "income" && t.kind !== "bevétel") return false;
    if (f.kind === "expense" && t.kind !== "kiadás") return false;
    if (f.kind === "savings" && t.kind !== "megtakarítás") return false;
    if (f.dateFrom && t.date < f.dateFrom) return false;
    if (f.dateTo && t.date > f.dateTo) return false;
    if (q) {
      const inText =
        (t.description ?? "").toLowerCase().includes(q) || (t.tx_type ?? "").toLowerCase().includes(q);
      if (!inText && !attributeTreeMatches(t.attributes, q)) return false;
    }
    return true;
  });
}

export function hasActiveFilters(f: Filters) {
  return !!(f.dateFrom || f.dateTo || f.mainCategory || f.search.trim() || f.kind !== "all");
}

export interface Totals {
  income: number;
  expense: number;
  savings: number;
  balance: number;
  incomeCount: number;
  expenseCount: number;
  savingsCount: number;
}

export function computeTotals(txs: Transaction[]): Totals {
  const t: Totals = { income: 0, expense: 0, savings: 0, balance: 0, incomeCount: 0, expenseCount: 0, savingsCount: 0 };
  for (const x of txs) {
    if (x.kind === "bevétel") {
      t.income += x.amount;
      t.incomeCount++;
    } else if (x.kind === "kiadás") {
      t.expense += x.amount;
      t.expenseCount++;
    } else {
      t.savings += x.amount;
      t.savingsCount++;
    }
  }
  t.balance = t.income + t.expense + t.savings;
  return t;
}

export const UNCATEGORIZED = "nincs kategória";

/** Kiadások fő attribútum szerint, pozitív összegként, csökkenő sorrendben. */
export function expensesByCategory(txs: Transaction[]): { category: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const t of txs) {
    if (t.kind !== "kiadás") continue;
    const key = t.main_category?.trim() || UNCATEGORIZED;
    totals.set(key, (totals.get(key) ?? 0) - t.amount);
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Havi bevétel / kiadás (kiadás pozitív előjellel), időrendben. */
export function monthlyFlow(txs: Transaction[]) {
  const months = new Map<string, { month: string; income: number; expense: number }>();
  for (const t of txs) {
    if (t.kind === "megtakarítás") continue;
    const m = t.date.slice(0, 7);
    const row = months.get(m) ?? { month: m, income: 0, expense: 0 };
    if (t.kind === "bevétel") row.income += t.amount;
    else row.expense -= t.amount;
    months.set(m, row);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
