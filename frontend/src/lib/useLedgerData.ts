import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Transaction } from "./types";

type Status = "loading" | "ready" | "error";

/** A tranzakciók és a fő attribútum-lista központi állapota. */
export function useLedgerData() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const refreshCategories = useCallback(async () => {
    try {
      setCategories(await api.listCategories());
    } catch {
      /* nem kritikus: csak a javaslatlista marad régi */
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [txs] = await Promise.all([api.listTransactions(), refreshCategories()]);
      setTransactions(txs);
      setStatus("ready");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }, [refreshCategories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Egy tétel helyi frissítése a szerver válasza alapján (teljes újratöltés nélkül). */
  const replaceTransaction = useCallback((tx: Transaction) => {
    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
  }, []);

  const removeTransaction = useCallback((id: number) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { transactions, categories, status, error, reload, refreshCategories, replaceTransaction, removeTransaction };
}
