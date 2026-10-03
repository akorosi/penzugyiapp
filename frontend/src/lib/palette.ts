// Kategorikus paletta (CVD-validált sorrend; világos és sötét módhoz külön
// kiválasztott lépcsőkkel). A sorrend a színtévesztő-biztonság része — ne
// keverd át. Legfeljebb ennyi kategória kap saját színt, a többi "Egyéb".
export const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"],
} as const;

export const OTHER_COLOR = { light: "#a3a29d", dark: "#6f6e69" } as const;

export const MAX_CATEGORICAL = CATEGORICAL.light.length;
export const OTHER_LABEL = "Egyéb";

/** Szín a kategóriához (az entitást követi, nem a pillanatnyi helyezést):
 *  a sorrendet a teljes adatkészlet kiadásai határozzák meg, így egy szűrés
 *  nem színezi át a megmaradó kategóriákat. */
export function buildCategoryColorIndex(rankedCategories: string[]): Map<string, number> {
  const m = new Map<string, number>();
  rankedCategories.slice(0, MAX_CATEGORICAL).forEach((c, i) => m.set(c, i));
  return m;
}
