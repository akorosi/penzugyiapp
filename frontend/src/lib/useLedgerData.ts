import { useCallback, useEffect, useState } from "react";
import { api, ApiError, UNAUTHORIZED_EVENT } from "./api";
import type { Transaction } from "./types";

type Status = "loading" | "ready" | "error" | "unauthorized";

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
      if (e instanceof ApiError && e.status === 401) {
        setStatus("unauthorized");
        return;
      }
      setError((e as Error).message);
      setStatus("error");
    }
  }, [refreshCategories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Bármelyik API-hívás 401-es válasza a belépő képernyőre visz.
  useEffect(() => {
    const onUnauthorized = () => setStatus("unauthorized");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  /** Egy tétel helyi frissítése a szerver válasza alapján (teljes újratöltés nélkül). */
  const replaceTransaction = useCallback((tx: Transaction) => {
    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    setTransactions([]);
    setCategories([]);
  }, []);

  return {
    transactions,
    categories,
    status,
    error,
    reload,
    refreshCategories,
    replaceTransaction,
    removeTransaction,
    clear,
  };
}
