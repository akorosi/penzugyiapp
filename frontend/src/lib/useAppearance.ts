import { useEffect, useState } from "react";

export type AppearancePref = "light" | "dark" | "system";
const KEY = "penzugyek.appearance";

function readPref(): AppearancePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* nincs tárhely-hozzáférés */
  }
  return "system";
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Világos / sötét / rendszer szerinti megjelenés, a böngészőben megjegyezve. */
export function useAppearance() {
  const [pref, setPref] = useState<AppearancePref>(readPref);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* nincs tárhely-hozzáférés */
    }
  }, [pref]);

  const resolved: "light" | "dark" = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  return { pref, setPref, resolved };
}
