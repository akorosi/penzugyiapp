import { useEffect, useRef } from "react";
import { Box, Button, Flex, IconButton, Kbd, SegmentedControl, Select, Text, TextField } from "@radix-ui/themes";
import { Cross2Icon, MagnifyingGlassIcon, ResetIcon } from "@radix-ui/react-icons";
import type { Filters, KindFilter } from "../lib/types";
import { hasActiveFilters } from "../lib/ledger";

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  categories: string[];
}

const ALL = "__all__";

export function FilterBar({ filters, onChange, categories }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  // "/" billentyű: ugrás a keresőmezőre (ha nem épp egy szövegmezőben gépel a felhasználó).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = hasActiveFilters(filters);

  return (
    <Flex direction="column" gap="3" role="search" aria-label="Tételek szűrése">
      <Flex gap="3" wrap="wrap" align="end">
        <Box flexGrow="1" minWidth="220px">
          <Text as="label" size="1" weight="medium" color="gray" htmlFor="flt-search" className="field-label">
            Keresés
          </Text>
          <TextField.Root
            id="flt-search"
            ref={searchRef}
            type="search"
            placeholder="Közlemény, típus vagy al-attribútum…"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && set("search", "")}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="16" width="16" />
            </TextField.Slot>
            <TextField.Slot>
              {filters.search ? (
                <IconButton size="1" variant="ghost" color="gray" aria-label="Keresés törlése" onClick={() => set("search", "")}>
                  <Cross2Icon />
                </IconButton>
              ) : (
                <Kbd size="1" className="hide-on-touch">/</Kbd>
              )}
            </TextField.Slot>
          </TextField.Root>
        </Box>

        <Box>
          <Text as="label" size="1" weight="medium" color="gray" htmlFor="flt-from" className="field-label">
            Dátumtól
          </Text>
          <TextField.Root
            id="flt-from"
            type="date"
            value={filters.dateFrom}
            max={filters.dateTo || undefined}
            onChange={(e) => set("dateFrom", e.target.value)}
          />
        </Box>
        <Box>
          <Text as="label" size="1" weight="medium" color="gray" htmlFor="flt-to" className="field-label">
            Dátumig
          </Text>
          <TextField.Root
            id="flt-to"
            type="date"
            value={filters.dateTo}
            min={filters.dateFrom || undefined}
            onChange={(e) => set("dateTo", e.target.value)}
          />
        </Box>

        <Box minWidth="180px">
          <Text as="div" size="1" weight="medium" color="gray" id="flt-cat-label" className="field-label">
            Fő attribútum
          </Text>
          <Select.Root
            value={filters.mainCategory || ALL}
            onValueChange={(v) => set("mainCategory", v === ALL ? "" : v)}
          >
            <Select.Trigger aria-labelledby="flt-cat-label" style={{ width: "100%" }} />
            <Select.Content position="popper">
              <Select.Item value={ALL}>Összes</Select.Item>
              {categories.length > 0 && <Select.Separator />}
              {categories.map((c) => (
                <Select.Item key={c} value={c}>
                  {c}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Box>
      </Flex>

      <Flex gap="3" wrap="wrap" align="center" justify="between">
        <SegmentedControl.Root
          value={filters.kind}
          onValueChange={(v) => set("kind", v as KindFilter)}
          aria-label="Típus"
          size="2"
        >
          <SegmentedControl.Item value="all">Mind</SegmentedControl.Item>
          <SegmentedControl.Item value="income">Bevétel</SegmentedControl.Item>
          <SegmentedControl.Item value="expense">Kiadás</SegmentedControl.Item>
          <SegmentedControl.Item value="savings">Megtakarítás</SegmentedControl.Item>
        </SegmentedControl.Root>

        <Button variant="ghost" color="gray" disabled={!active} onClick={() => onChange({ ...filters, dateFrom: "", dateTo: "", mainCategory: "", search: "", kind: "all" })}>
          <ResetIcon />
          Szűrők törlése
        </Button>
      </Flex>
    </Flex>
  );
}
