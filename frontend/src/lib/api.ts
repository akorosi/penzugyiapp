import type { AttributeNode, Transaction, UploadResult } from "./types";

// ---------- futásidejű konfiguráció ----------
//
// AWS-en a felület és az API is ugyanazon a CloudFront címen érhető el (az
// /api/* útvonalak a Lambdához mennek), így az alapértelmezés az azonos origin.
// A config.json (Terraform írja) és a VITE_API_BASE_URL build-idejű változó
// ezt felülírhatja.

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

// ---------- hitelesítés ----------
//
// AWS-en a belépést a szerver kezeli (Cognito + Google): a munkamenet egy
// HttpOnly sütiben van, amit a böngésző automatikusan küld — a JavaScript
// tokent nem lát. Lejárt munkamenetnél (401) a belépési folyamatra irányítunk,
// majd onnan vissza az aktuális nézetre.

export interface Me {
  email: string;
  auth: "cognito" | "none";
}

export function redirectToLogin() {
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.assign(`/api/auth/login?next=${encodeURIComponent(next)}`);
}

export function logout() {
  window.location.assign("/api/auth/logout");
}

// ---------- kérés-aláírás segédletek ----------
//
// A CloudFront → Lambda Function URL kapcsolatot a CloudFront SigV4-gyel írja
// alá (Origin Access Control). Ehhez a törzzsel rendelkező kérésekben a
// böngészőnek meg kell adnia a törzs SHA-256 hash-ét az x-amz-content-sha256
// fejlécben (a Lambda nem fogad aláíratlan törzset). Helyi futtatásnál a
// fejléc ártalmatlan.

async function sha256Hex(data: Uint8Array): Promise<string | null> {
  // A WebCrypto csak biztonságos kontextusban (HTTPS / localhost) érhető el.
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** multipart/form-data törzs kézi összeállítása — a FormData határolóját a
 *  böngésző csak küldéskor generálja, így annak hash-e előre nem számolható. */
async function multipartFile(field: string, file: File): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = "----penzugyek" + Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const safeName = file.name.replace(/["\r\n]/g, "_");
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${safeName}"\r\n` +
    `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const blob = new Blob([head, file, `\r\n--${boundary}--\r\n`]);
  return { body: new Uint8Array(await blob.arrayBuffer()), contentType: `multipart/form-data; boundary=${boundary}` };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: Uint8Array;
  contentType?: string;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const base = await apiBase();
  const method = opts.method ?? "GET";
  const headers = new Headers();
  // CSRF védelem: a szerver a módosító kéréseknél megköveteli ezt a fejlécet.
  headers.set("X-Requested-With", "penzugyek");
  if (opts.contentType) headers.set("Content-Type", opts.contentType);
  if (method !== "GET" && method !== "HEAD") {
    const hash = await sha256Hex(opts.body ?? new Uint8Array());
    if (hash) headers.set("x-amz-content-sha256", hash);
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body as BodyInit | undefined,
      credentials: "same-origin",
    });
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
    if (res.status === 401) redirectToLogin();
    const msg =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Váratlan hiba (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestOptions => ({
  method,
  contentType: "application/json",
  body: new TextEncoder().encode(JSON.stringify(data)),
});

export const api = {
  me: () => request<Me>("/api/me"),
  listTransactions: () => request<Transaction[]>("/api/transactions"),
  listCategories: () => request<string[]>("/api/categories"),

  upload: async (file: File) => {
    const { body, contentType } = await multipartFile("file", file);
    return request<UploadResult>("/api/upload", { method: "POST", body, contentType });
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
