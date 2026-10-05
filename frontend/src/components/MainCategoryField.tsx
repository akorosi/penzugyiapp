import { useEffect, useRef, useState } from "react";
import { Flex, Spinner, Text, TextField, Tooltip } from "@radix-ui/themes";
import { CheckIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { api } from "../lib/api";
import type { Transaction } from "../lib/types";
import { useDebouncedCallback } from "../lib/useDebouncedCallback";

interface Props {
  tx: Transaction;
  listId: string;
  onSaved: (tx: Transaction) => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const SOURCE_LABEL = { auto: "automatikus", rule: "saját szabály", manual: "kézi", none: "" } as const;

/** Fő attribútum szövegmező: gépelés közben, mentés gomb nélkül ment. */
export function MainCategoryField({ tx, listId, onSaved }: Props) {
  const [value, setValue] = useState(tx.main_category ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef(tx.main_category ?? "");
  const focused = useRef(false);

  // Külső frissítésnél (pl. újratöltés) csak akkor írjuk felül, ha épp nem szerkeszti.
  useEffect(() => {
    if (!focused.current) {
      setValue(tx.main_category ?? "");
      lastSaved.current = tx.main_category ?? "";
    }
  }, [tx.main_category]);

  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  const save = useDebouncedCallback(async (next: string) => {
    if (next.trim() === lastSaved.current.trim()) return;
    setState("saving");
    try {
      const updated = await api.setMainCategory(tx.id, next);
      lastSaved.current = updated.main_category ?? "";
      setState("saved");
      setError(null);
      onSaved(updated);
    } catch (e) {
      setState("error");
      setError((e as Error).message);
    }
  }, 600);

  const source = SOURCE_LABEL[tx.category_source] ?? "";

  return (
    <Flex direction="column" gap="1">
      <TextField.Root
        size="1"
        value={value}
        placeholder="nincs beállítva"
        list={listId}
        aria-label={`Fő attribútum: ${tx.description ?? tx.date}`}
        aria-invalid={state === "error" || undefined}
        color={state === "error" ? "red" : undefined}
        variant={tx.category_source === "manual" ? "surface" : "soft"}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          save.flush(value);
        }}
        onChange={(e) => {
          setValue(e.target.value);
          save(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      >
        <TextField.Slot side="right">
          {state === "saving" && <Spinner size="1" aria-label="Mentés…" />}
          {state === "saved" && <CheckIcon className="save-ok" aria-label="Mentve" />}
          {state === "error" && (
            <Tooltip content={error ?? "Hiba a mentéskor"}>
              <ExclamationTriangleIcon className="save-err" aria-label="Hiba a mentéskor" />
            </Tooltip>
          )}
        </TextField.Slot>
      </TextField.Root>
      {source && (
        <Text size="1" color="gray" className="cat-source">
          {source}
        </Text>
      )}
    </Flex>
  );
}
