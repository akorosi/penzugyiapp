import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Container,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Skeleton,
  Spinner,
  Tabs,
  Text,
} from "@radix-ui/themes";
import {
  BarChartIcon,
  CrossCircledIcon,
  DesktopIcon,
  ExitIcon,
  LightningBoltIcon,
  MoonIcon,
  Pencil2Icon,
  ReloadIcon,
  SunIcon,
  TableIcon,
  UploadIcon,
} from "@radix-ui/react-icons";
import { SummaryCards } from "./components/SummaryCards";
import { FilterBar } from "./components/FilterBar";
import { LedgerTable } from "./components/LedgerTable";
import { UploadDialog } from "./components/UploadDialog";
import { useToast } from "./components/Toaster";
import { api, logout } from "./lib/api";
import { applyFilters, computeTotals, expensesByCategory, hasActiveFilters } from "./lib/ledger";
import { buildCategoryColorIndex } from "./lib/palette";
import { EMPTY_FILTERS, type Filters, type Transaction } from "./lib/types";
import { useLedgerData } from "./lib/useLedgerData";
import type { AppearancePref } from "./lib/useAppearance";

// A diagram-könyvtár külön chunkba kerül, csak az Elemzés fül megnyitásakor töltődik be.
const AnalyticsView = lazy(() => import("./components/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));
// A ritkán használt ablakok szintén csak megnyitáskor töltődnek be.
const BulkCategoryDialog = lazy(() =>
  import("./components/BulkCategoryDialog").then((m) => ({ default: m.BulkCategoryDialog })),
);
const RulesDialog = lazy(() => import("./components/RulesDialog").then((m) => ({ default: m.RulesDialog })));

type View = "tetelek" | "elemzes";
const readView = (): View => (window.location.hash === "#elemzes" ? "elemzes" : "tetelek");

interface Props {
  appearance: { pref: AppearancePref; setPref: (p: AppearancePref) => void; resolved: "light" | "dark" };
}

export function App({ appearance }: Props) {
  const toast = useToast();
  const data = useLedgerData();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Kijelölésből kivett tételek — csak munkamenet-szintű állapot, nem kerül mentésre.
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<View>(readView);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const changeView = (v: string) => {
    setView(v as View);
    history.replaceState(null, "", v === "elemzes" ? "#elemzes" : window.location.pathname + window.location.search);
  };

  const filtered = useMemo(() => applyFilters(data.transactions, filters), [data.transactions, filters]);
  const included = useMemo(() => filtered.filter((t) => !excludedIds.has(t.id)), [filtered, excludedIds]);
  const totals = useMemo(() => computeTotals(included), [included]);
  const colorIndex = useMemo(
    () => buildCategoryColorIndex(expensesByCategory(data.transactions).map((e) => e.category)),
    [data.transactions],
  );

  const toggle = useCallback((id: string, inc: boolean) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (inc) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleMany = useCallback((ids: string[], inc: boolean) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (inc) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const onTxSaved = useCallback(
    (tx: Transaction) => {
      data.replaceTransaction(tx);
      void data.refreshCategories();
    },
    [data],
  );

  const onDelete = async (tx: Transaction) => {
    try {
      await api.deleteTransaction(tx.id);
      data.removeTransaction(tx.id);
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
      void data.refreshCategories();
      toast({ title: "Tétel törölve", tone: "success" });
    } catch (e) {
      toast({ title: "A törlés nem sikerült", description: (e as Error).message, tone: "error" });
      throw e;
    }
  };

  const unauthorized = data.status === "unauthorized";
  const loading = data.status === "loading";
  const isEmpty = data.status === "ready" && data.transactions.length === 0;
  const excludedInView = filtered.length - included.length;

  const importButton = (
    <Button>
      <UploadIcon />
      Importálás
    </Button>
  );

  // Az eredményt maga az import-dialógus jeleníti meg; itt csak frissítünk.
  const onImported = async () => {
    await data.reload();
  };

  const onBulkDone = async ({ updated, ruleApplied }: { updated: number; ruleApplied: number | null }) => {
    await data.reload();
    const parts = [`${updated} tétel módosítva.`];
    if (ruleApplied !== null) {
      parts.push(
        ruleApplied > 0
          ? `Szabály mentve, további ${ruleApplied} meglévő kiadásra is alkalmazva.`
          : "Szabály mentve, a következő importoknál is érvényes.",
      );
    }
    toast({ title: "Fő attribútum beállítva", description: parts.join(" "), tone: "success" });
  };

  const onRuleApplied = async (applied: number) => {
    await data.reload();
    toast({ title: "Szabály alkalmazva", description: `${applied} meglévő kiadás kapott fő attribútumot.`, tone: "success" });
  };

  const ThemeIcon = appearance.pref === "system" ? DesktopIcon : appearance.resolved === "dark" ? MoonIcon : SunIcon;

  return (
    <>
      <a href="#main" className="skip-link">
        Ugrás a tartalomra
      </a>
      <header className="app-header">
        <Container size="4" px={{ initial: "4", md: "6" }}>
          <Flex align="center" justify="between" gap="3" py="3">
            <Flex align="center" gap="3">
              <span className="brand-mark" aria-hidden>
                <BarChartIcon width="18" height="18" />
              </span>
              <Box>
                <Heading as="h1" size="4" weight="bold" trim="both">
                  Pénzügyek
                </Heading>
                <Text size="1" color="gray" className="hide-xs">
                  Folyószámla-könyvelő &amp; kategorizálás
                </Text>
              </Box>
            </Flex>
            <Flex align="center" gap="2">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {data.me ? (
                    <IconButton variant="ghost" color="gray" radius="full" aria-label={`Fiók és beállítások (${data.me.email})`}>
                      <Avatar size="2" radius="full" fallback={data.me.email.charAt(0).toUpperCase()} />
                    </IconButton>
                  ) : (
                    <IconButton variant="ghost" color="gray" aria-label="Beállítások">
                      <ThemeIcon width="18" height="18" />
                    </IconButton>
                  )}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  {data.me && (
                    <>
                      <Box px="3" py="2" maxWidth="260px">
                        <Text as="div" size="1" color="gray">
                          {data.me.auth === "cognito" ? "Bejelentkezve" : "Helyi mód (belépés nélkül)"}
                        </Text>
                        <Text as="div" size="2" weight="medium" truncate>
                          {data.me.email}
                        </Text>
                      </Box>
                      <DropdownMenu.Separator />
                    </>
                  )}
                  {!unauthorized && (
                    <>
                      <DropdownMenu.Item onSelect={() => setRulesOpen(true)}>
                        <LightningBoltIcon /> Saját szabályok…
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                    </>
                  )}
                  <DropdownMenu.Label>Megjelenés</DropdownMenu.Label>
                  <DropdownMenu.RadioGroup
                    value={appearance.pref}
                    onValueChange={(v) => appearance.setPref(v as AppearancePref)}
                  >
                    <DropdownMenu.RadioItem value="light">
                      <SunIcon /> Világos
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="dark">
                      <MoonIcon /> Sötét
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="system">
                      <DesktopIcon /> Rendszer szerint
                    </DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                  {data.me?.auth === "cognito" && (
                    <>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item color="red" onSelect={logout}>
                        <ExitIcon /> Kijelentkezés
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              {!unauthorized && <UploadDialog trigger={importButton} onImported={onImported} />}
            </Flex>
          </Flex>
        </Container>
      </header>

      <Container size="4" px={{ initial: "4", md: "6" }} py={{ initial: "4", md: "6" }} asChild>
        <main id="main">
          <Flex direction="column" gap="5">
            {data.status === "error" && (
              <Callout.Root color="red" role="alert">
                <Callout.Icon>
                  <CrossCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  Nem sikerült betölteni az adatokat: {data.error}{" "}
                  <Button size="1" variant="soft" color="red" ml="2" onClick={() => void data.reload()}>
                    <ReloadIcon /> Újra
                  </Button>
                </Callout.Text>
              </Callout.Root>
            )}

            {unauthorized ? (
              <Flex direction="column" align="center" gap="3" py="9" role="status">
                <Spinner size="3" />
                <Text color="gray">Átirányítás a belépéshez…</Text>
              </Flex>
            ) : (
              <SummaryCards totals={totals} loading={loading} />
            )}

            {unauthorized ? null : isEmpty ? (
              <Card size="4">
                <Flex direction="column" align="center" gap="3" py="6" className="empty-state">
                  <span className="empty-state__icon" aria-hidden>
                    <UploadIcon width="24" height="24" />
                  </span>
                  <Heading as="h2" size="5">
                    Még nincs egyetlen tétel sem
                  </Heading>
                  <Text color="gray" align="center" style={{ maxWidth: 440 }}>
                    Importáld a CIB-ből letöltött <strong>tranzakciok.xls</strong> kivonatot — a kiadásokat a rendszer
                    automatikusan kategorizálja, amit utána bármikor felülírhatsz.
                  </Text>
                  <UploadDialog
                    trigger={
                      <Button size="3" mt="2">
                        <UploadIcon /> Kivonat importálása
                      </Button>
                    }
                    onImported={onImported}
                  />
                </Flex>
              </Card>
            ) : (
              <Tabs.Root value={view} onValueChange={changeView}>
                <Flex align="center" justify="between" gap="3" wrap="wrap">
                  <Tabs.List>
                    <Tabs.Trigger value="tetelek">
                      <Flex align="center" gap="2">
                        <TableIcon /> Tételek
                      </Flex>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="elemzes">
                      <Flex align="center" gap="2">
                        <BarChartIcon /> Elemzés
                      </Flex>
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Skeleton loading={loading}>
                    <Flex gap="2" align="center" aria-live="polite">
                      <Text size="2" color="gray" className="tabular">
                        {hasActiveFilters(filters)
                          ? `${filtered.length} / ${data.transactions.length} tétel`
                          : `${data.transactions.length} tétel`}
                      </Text>
                      {excludedInView > 0 && (
                        <Badge color="amber" variant="soft">
                          {excludedInView} kijelölés nélkül
                        </Badge>
                      )}
                      <Button
                        size="1"
                        variant="soft"
                        disabled={!hasActiveFilters(filters) || filtered.length === 0}
                        title={hasActiveFilters(filters) ? undefined : "Előbb szűrd le a tételeket (pl. kereséssel)"}
                        onClick={() => setBulkOpen(true)}
                      >
                        <Pencil2Icon /> Fő attribútum beállítása
                      </Button>
                    </Flex>
                  </Skeleton>
                </Flex>

                <Card size="2" mt="4">
                  <FilterBar filters={filters} onChange={setFilters} categories={data.categories} />
                </Card>

                <Box mt="4" />

                <Tabs.Content value="tetelek">
                  {loading ? (
                    <Flex direction="column" gap="2">
                      {Array.from({ length: 6 }, (_, i) => (
                        <Skeleton key={i} height="48px" />
                      ))}
                    </Flex>
                  ) : filtered.length === 0 ? (
                    <Card size="3">
                      <Flex direction="column" align="center" gap="2" py="5">
                        <Text weight="medium">A szűrésnek egyetlen tétel sem felel meg.</Text>
                        <Button variant="soft" onClick={() => setFilters(EMPTY_FILTERS)}>
                          Szűrők törlése
                        </Button>
                      </Flex>
                    </Card>
                  ) : (
                    <LedgerTable
                      rows={filtered}
                      categories={data.categories}
                      excludedIds={excludedIds}
                      onToggle={toggle}
                      onToggleMany={toggleMany}
                      onTxSaved={onTxSaved}
                      onAttributesChanged={data.reload}
                      onDelete={onDelete}
                      resetPageKey={JSON.stringify(filters)}
                    />
                  )}
                </Tabs.Content>

                <Tabs.Content value="elemzes">
                  <Suspense fallback={<Skeleton height="320px" />}>
                    <AnalyticsView included={included} colorIndex={colorIndex} appearance={appearance.resolved} />
                  </Suspense>
                </Tabs.Content>
              </Tabs.Root>
            )}
          </Flex>
        </main>
      </Container>

      <Suspense fallback={null}>
        {bulkOpen && (
          <BulkCategoryDialog
            open
            onOpenChange={setBulkOpen}
            rows={filtered}
            categories={data.categories}
            search={filters.search}
            onDone={onBulkDone}
          />
        )}
        {rulesOpen && (
          <RulesDialog open onOpenChange={setRulesOpen} categories={data.categories} onApplied={onRuleApplied} />
        )}
      </Suspense>
    </>
  );
}
