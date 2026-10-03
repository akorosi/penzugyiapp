import type { AttributeNode, Transaction, UploadResult } from "./types";

// Üres érték → ugyanarról az originről hívjuk az API-t (Flask kiszolgálás).
// Külön hosztolt frontendnél (pl. S3) a VITE_API_BASE_URL adja a backend címét.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError("A szerver nem érhető el. Ellenőrizd a kapcsolatot.", 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* nincs JSON törzs */
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Váratlan hiba (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const api = {
  listTransactions: () => request<Transaction[]>("/api/transactions"),
  listCategories: () => request<string[]>("/api/categories"),

  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResult>("/api/upload", { method: "POST", body: form });
  },

  setMainCategory: (txId: number, mainCategory: string) =>
    request<Transaction>(`/api/transactions/${txId}`, json("PATCH", { main_category: mainCategory })),

  deleteTransaction: (txId: number) =>
    request<{ deleted: number }>(`/api/transactions/${txId}`, { method: "DELETE" }),

  addAttribute: (txId: number, name: string, parentId: number | null) =>
    request<AttributeNode>(`/api/transactions/${txId}/attributes`, json("POST", { name, parent_id: parentId })),

  renameAttribute: (attrId: number, name: string) =>
    request<AttributeNode>(`/api/attributes/${attrId}`, json("PATCH", { name })),

  deleteAttribute: (attrId: number) =>
    request<{ deleted: number[] }>(`/api/attributes/${attrId}`, { method: "DELETE" }),
};
