import { useId, useMemo, useState } from "react";
import { Button, Callout, Checkbox, Dialog, Flex, Spinner, Text, TextField } from "@radix-ui/themes";
import { CheckIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { api } from "../lib/api";
import { MIN_RULE_PATTERN, type Transaction } from "../lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A jelenleg szűrt (látható) tételek. */
  rows: Transaction[];
  categories: string[];
  /** A keresőmező tartalma — ebből lesz a szabály mintájának alapértéke. */
  search: string;
  onDone: (summary: { updated: number; ruleApplied: number | null }) => void | Promise<void>;
}

const LIST_ID = "bulk-category-suggestions";

/** A szűrt tételek fő attribútumának egyszerre történő beállítása, opcionálisan
 *  a keresett szöveg saját szabályként mentésével (későbbi importokra is). */
export function BulkCategoryDialog({ open, onOpenChange, rows, categories, search, onDone }: Props) {
  // Az ablak minden megnyitáskor újonnan mountolódik, így a kezdőértékek a friss keresésből jönnek.
  const [value, setValue] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [saveRule, setSaveRule] = useState(search.trim().length >= MIN_RULE_PATTERN);
  const [pattern, setPattern] = useState(search.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { value: useId(), onlyEmpty: useId(), saveRule: useId(), pattern: useId() };

  const targets = useMemo(
    () => (onlyEmpty ? rows.filter((t) => !t.main_category?.trim()) : rows),
    [rows, onlyEmpty],
  );

  const category = value.trim();
  const patternOk = pattern.trim().length >= MIN_RULE_PATTERN;
  const canSubmit = !busy && !!category && (targets.length > 0 || saveRule) && (!saveRule || patternOk);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const updated = targets.length ? (await api.bulkSetMainCategory(targets.map((t) => t.id), category)).updated : 0;
      const ruleApplied = saveRule ? (await api.createRule(pattern.trim(), category)).applied : null;
      onOpenChange(false);
      await onDone({ updated, ruleApplied });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Fő attribútum beállítása</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          A jelenlegi szűrésnek megfelelő {rows.length} tétel fő attribútumát egy lépésben állíthatod be.
        </Dialog.Description>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Flex direction="column" gap="4">
            <div>
              <Text as="label" size="1" weight="medium" color="gray" htmlFor={ids.value} className="field-label">
                Fő attribútum
              </Text>
              <TextField.Root
                id={ids.value}
                autoFocus
                list={LIST_ID}
                placeholder="pl. bevásárlás"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <datalist id={LIST_ID}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <Text as="label" size="2" htmlFor={ids.onlyEmpty}>
              <Flex gap="2" align="center">
                <Checkbox id={ids.onlyEmpty} checked={onlyEmpty} onCheckedChange={(c) => setOnlyEmpty(c === true)} />
                Csak a fő attribútum nélküli tételek
              </Flex>
            </Text>
            <Text size="2" color="gray" mt="-2">
              <strong className="tabular">{targets.length}</strong> tétel kapja meg az új értéket.
            </Text>

            <Flex direction="column" gap="2">
              <Text as="label" size="2" htmlFor={ids.saveRule}>
                <Flex gap="2" align="center">
                  <Checkbox id={ids.saveRule} checked={saveRule} onCheckedChange={(c) => setSaveRule(c === true)} />
                  Megjegyzés saját szabályként
                </Flex>
              </Text>
              {saveRule && (
                <div>
                  <Text as="label" size="1" weight="medium" color="gray" htmlFor={ids.pattern} className="field-label">
                    Ha a közlemény tartalmazza
                  </Text>
                  <TextField.Root
                    id={ids.pattern}
                    placeholder="pl. Budapest NYX CocaColaHBCMag"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    aria-invalid={!patternOk || undefined}
                  />
                  <Text as="p" size="1" color="gray" mt="1">
                    A későbbi importokban és a már meglévő, fő attribútum nélküli kiadásoknál is ezt az értéket
                    állítja be (kis- és nagybetűtől függetlenül). Legalább {MIN_RULE_PATTERN} karakter.
                  </Text>
                </div>
              )}
            </Flex>

            {error && (
              <Callout.Root color="red" role="alert">
                <Callout.Icon>
                  <CrossCircledIcon />
                </Callout.Icon>
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}

            <Flex gap="3" justify="end">
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray" disabled={busy}>
                  Mégse
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={!canSubmit}>
                <Spinner loading={busy}>
                  <CheckIcon />
                </Spinner>
                Beállítás
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
