import { useCallback, useEffect, useId, useState } from "react";
import { Button, Callout, Checkbox, Dialog, Flex, IconButton, Spinner, Table, Text, TextField } from "@radix-ui/themes";
import { CrossCircledIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { api } from "../lib/api";
import { MIN_RULE_PATTERN, type CategoryRule } from "../lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  /** Hívódik, ha egy új szabály meglévő tételeket is módosított. */
  onApplied: (applied: number) => void | Promise<void>;
}

const LIST_ID = "rule-category-suggestions";

/** Saját kategorizálási szabályok listája, felvétele és törlése. */
export function RulesDialog({ open, onOpenChange, categories, onApplied }: Props) {
  const [rules, setRules] = useState<CategoryRule[] | null>(null);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [applyExisting, setApplyExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { pattern: useId(), category: useId(), apply: useId() };

  const load = useCallback(async () => {
    try {
      setRules(await api.listRules());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRules(null);
    setError(null);
    void load();
  }, [open, load]);

  const canAdd = !busy && pattern.trim().length >= MIN_RULE_PATTERN && !!category.trim();

  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const { applied } = await api.createRule(pattern.trim(), category.trim(), applyExisting);
      setPattern("");
      setCategory("");
      await load();
      if (applied > 0) await onApplied(applied);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: CategoryRule) => {
    setError(null);
    try {
      await api.deleteRule(rule.id);
      setRules((prev) => prev?.filter((r) => r.id !== rule.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>Saját szabályok</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Ha egy kiadás közleménye tartalmazza a mintát (kis- és nagybetűtől függetlenül), importáláskor automatikusan
          megkapja a hozzá tartozó fő attribútumot. A saját szabály elsőbbséget élvez a beépített listával szemben; több
          illeszkedő szabály közül a hosszabb minta nyer.
        </Dialog.Description>

        {rules === null && !error ? (
          <Flex justify="center" py="4">
            <Spinner />
          </Flex>
        ) : rules && rules.length > 0 ? (
          <Table.Root size="1" variant="surface">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Ha a közlemény tartalmazza</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Fő attribútum</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>
                  <span className="visually-hidden">Műveletek</span>
                </Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rules.map((r) => (
                <Table.Row key={r.id} align="center">
                  <Table.Cell>
                    <Text size="2" className="desc">
                      {r.pattern}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="2">{r.main_category}</Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="red"
                      aria-label={`Szabály törlése: ${r.pattern}`}
                      onClick={() => void remove(r)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          rules && (
            <Text as="p" size="2" color="gray">
              Még nincs saját szabály. Felvehetsz itt, vagy a tételek szűrése után a „Fő attribútum beállítása” ablakban.
            </Text>
          )
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Flex direction="column" gap="3" mt="5">
            <Flex gap="3" wrap="wrap" align="end">
              <div style={{ flex: "2 1 220px" }}>
                <Text as="label" size="1" weight="medium" color="gray" htmlFor={ids.pattern} className="field-label">
                  Ha a közlemény tartalmazza
                </Text>
                <TextField.Root
                  id={ids.pattern}
                  placeholder="pl. Budapest NYX CocaColaHBCMag"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <Text as="label" size="1" weight="medium" color="gray" htmlFor={ids.category} className="field-label">
                  Fő attribútum
                </Text>
                <TextField.Root
                  id={ids.category}
                  list={LIST_ID}
                  placeholder="pl. bevásárlás"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <datalist id={LIST_ID}>
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <Button type="submit" disabled={!canAdd}>
                <Spinner loading={busy}>
                  <PlusIcon />
                </Spinner>
                Hozzáadás
              </Button>
            </Flex>
            <Text as="label" size="2" htmlFor={ids.apply}>
              <Flex gap="2" align="center">
                <Checkbox id={ids.apply} checked={applyExisting} onCheckedChange={(c) => setApplyExisting(c === true)} />
                Alkalmazás a már meglévő, fő attribútum nélküli kiadásokra is
              </Flex>
            </Text>
          </Flex>
        </form>

        {error && (
          <Callout.Root color="red" role="alert" mt="4">
            <Callout.Icon>
              <CrossCircledIcon />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        <Flex justify="end" mt="5">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              Bezárás
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
