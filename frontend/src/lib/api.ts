import type { AttributeNode, Transaction, UploadResult } from "./types";

// ---------- futásidejű konfiguráció ----------
//
// AWS-en a frontend S3-ról, az API egy Lambda Function URL-ről érkezik. Az API
// címét a Terraform írja a bucketbe (config.json), így a frontendet nem kell
// környezetenként újrabuildelni. Ha nincs config.json (helyi Flask / Vite dev),
// a VITE_API_BASE_URL build-idejű változó, végül az azonos origin a tartalék.

interface RuntimeConfig {
  apiBaseUrl?: string;
}

let configPromise: Promise<string> | null = null;

function apiBase(): Promise<string> {
  configPromise ??= (async () => {
    const fallback = import.meta.env.VITE_API_BASE_URL ?? "";
    try {
      const res = await fetch("./config.json", { cache: "no-store" });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
        const cfg = (await res.json()) as RuntimeConfig;
        if (typeof cfg.apiBaseUrl === "string") return cfg.apiBaseUrl;
      }
    } catch {
      /* nincs config.json → tartalék érték */
    }
    return fallback;
  })().then((base) => base.replace(/\/+$/, ""));
  return configPromise;
}

// ---------- hozzáférési kulcs ----------

const KEY_STORAGE = "penzugyek.accessKey";
export const UNAUTHORIZED_EVENT = "penzugyek:unauthorized";

export function getAccessKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setAccessKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* privát mód: csak a munkamenetre marad meg (nem tároljuk) */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await apiBase();
  const headers = new Headers(init.headers);
  const key = getAccessKey();
  if (key) headers.set("Authorization", `Bearer ${key}`);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
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
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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

  setMainCategory: (txId: string, mainCategory: string) =>
    request<Transaction>(`/api/transactions/${txId}`, json("PATCH", { main_category: mainCategory })),

  deleteTransaction: (txId: string) =>
    request<{ deleted: string }>(`/api/transactions/${txId}`, { method: "DELETE" }),

  addAttribute: (txId: string, name: string, parentId: string | null) =>
    request<AttributeNode>(`/api/transactions/${txId}/attributes`, json("POST", { name, parent_id: parentId })),

  renameAttribute: (attrId: string, name: string) =>
    request<AttributeNode>(`/api/attributes/${attrId}`, json("PATCH", { name })),

  deleteAttribute: (attrId: string) =>
    request<{ deleted: string[] }>(`/api/attributes/${attrId}`, { method: "DELETE" }),
};
