export type Kind = "bevétel" | "kiadás" | "megtakarítás";
export type CategorySource = "auto" | "manual" | "none";

export interface AttributeNode {
  id: number;
  name: string;
  parent_id: number | null;
  children: AttributeNode[];
}

export interface Transaction {
  id: number;
  date: string; // YYYY-MM-DD
  tx_type: string | null;
  description: string | null;
  amount: number;
  kind: Kind;
  main_category: string | null;
  category_source: CategorySource;
  attributes: AttributeNode[];
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
  mainCategory: string; // "" = összes
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

export const SAVINGS_LABEL = "megtakarítás";
