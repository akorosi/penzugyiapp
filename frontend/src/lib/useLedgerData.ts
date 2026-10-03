import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";
import type { Transaction } from "./types";

type Status = "loading" | "ready" | "error" | "unauthorized";

/** A tranzakciók és a fő attribútum-lista központi állapota. */
export function useLedgerData() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const refreshCategories = useCallback(async () => {
    try {
      setCategories(await api.listCategories());
    } catch {
      /* nem kritikus: csak a javaslatlista marad régi */
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [txs, who] = await Promise.all([api.listTransactions(), api.me(), refreshCategories()]);
      setTransactions(txs);
      setMe(who);
      setStatus("ready");
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setStatus("unauthorized"); // az api már átirányít a belépéshez
        return;
      }
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

  const removeTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    transactions,
    categories,
    status,
    error,
    me,
    reload,
    refreshCategories,
    replaceTransaction,
    removeTransaction,
  };
}
