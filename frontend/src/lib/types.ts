export type Kind = "bevétel" | "kiadás" | "megtakarítás";
export type CategorySource = "auto" | "rule" | "manual" | "none";

export interface AttributeNode {
  id: string; // UUID
  name: string;
  parent_id: string | null;
  children: AttributeNode[];
}

export interface Transaction {
  id: string; // UUID
  date: string; // YYYY-MM-DD
  tx_type: string | null;
  description: string | null;
  amount: number;
  kind: Kind;
  main_category: string | null;
  category_source: CategorySource;
  attributes: AttributeNode[];
}

/** Saját kategorizálási szabály: ha a közlemény tartalmazza a mintát, a kiadás ezt a fő attribútumot kapja. */
export interface CategoryRule {
  id: string; // UUID
  pattern: string;
  main_category: string;
  created_at: string;
}

export interface UploadResult {
  inserted: number;
  skipped: number;
  total_parsed: number;
}

export type KindFilter = "all" | "income" | "expense" | "savings";

export interface Filters {
  dateFrom: string;
  dateTo: string;
  mainCategory: string; // "" = összes, NO_MAIN_CATEGORY = csak a fő attribútum nélküliek
  search: string;
  kind: KindFilter;
}

export const EMPTY_FILTERS: Filters = {
  dateFrom: "",
  dateTo: "",
  mainCategory: "",
  search: "",
  kind: "all",
};

/** Szűrőérték: azok a tételek, amelyeknek nincs (üres) fő attribútuma. */
export const NO_MAIN_CATEGORY = "__none__";

export const SAVINGS_LABEL = "megtakarítás";

/** Egy saját szabály mintájának minimális hossza (a szerver is ellenőrzi). */
export const MIN_RULE_PATTERN = 3;
