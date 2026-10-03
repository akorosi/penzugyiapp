import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Flex,
  IconButton,
  Select,
  Table,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  CaretDownIcon,
  CaretSortIcon,
  CaretUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import type { Transaction } from "../lib/types";
import { formatDate, formatHuf } from "../lib/format";
import { MainCategoryField } from "./MainCategoryField";
import { AttributeTree } from "./AttributeTree";

type SortKey = "date" | "amount";
type SortDir = "asc" | "desc";

interface Props {
  rows: Transaction[];
  categories: string[];
  excludedIds: Set<string>;
  onToggle: (id: string, included: boolean) => void;
  onToggleMany: (ids: string[], included: boolean) => void;
  onTxSaved: (tx: Transaction) => void;
  onAttributesChanged: () => Promise<void> | void;
  onDelete: (tx: Transaction) => Promise<void>;
  resetPageKey: string;
}

const PAGE_SIZES = ["25", "50", "100", "all"] as const;
const LIST_ID = "category-suggestions";
const KIND_COLOR = { bevétel: "green", kiadás: "red", megtakarítás: "blue" } as const;

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === k;
  const Icon = !active ? CaretSortIcon : sort.dir === "asc" ? CaretUpIcon : CaretDownIcon;
  return (
    <Table.ColumnHeaderCell
      align={align}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sort-btn" onClick={() => onSort(k)}>
        {label}
        <Icon aria-hidden />
      </button>
    </Table.ColumnHeaderCell>
  );
}

export function LedgerTable({
  rows,
  categories,
  excludedIds,
  onToggle,
  onToggleMany,
  onTxSaved,
  onAttributesChanged,
  onDelete,
  resetPageKey,
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "date", dir: "desc" });
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>("50");
  const [page, setPage] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setPage(0), [resetPageKey, pageSize, sort]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const d = sort.key === "date" ? a.date.localeCompare(b.date) : a.amount - b.amount;
      return d !== 0 ? d * dir : a.id.localeCompare(b.id) * dir;
    });
  }, [rows, sort]);

  const size = pageSize === "all" ? sorted.length || 1 : Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * size, safePage * size + size);

  const includedInView = rows.filter((r) => !excludedIds.has(r.id)).length;
  const headerChecked: boolean | "indeterminate" =
    includedInView === 0 ? false : includedInView === rows.length ? true : "indeterminate";

  const onSort = (k: SortKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }));

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <datalist id={LIST_ID}>
        {Array.from(new Set([...categories, "megtakarítás"]))
          .sort((a, b) => a.localeCompare(b, "hu"))
          .map((c) => (
            <option key={c} value={c} />
          ))}
      </datalist>

      <Table.Root variant="surface" size="2" className="ledger">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell className="col-check">
              <Tooltip content="Kijelölt tételek számítanak bele az összesítésekbe és a diagramokba">
                <Checkbox
                  checked={headerChecked}
                  disabled={!rows.length}
                  aria-label="Minden szűrt tétel kijelölése"
                  onCheckedChange={() => onToggleMany(rows.map((r) => r.id), headerChecked !== true)}
                />
              </Tooltip>
            </Table.ColumnHeaderCell>
            <SortHeader label="Dátum" k="date" sort={sort} onSort={onSort} />
            <Table.ColumnHeaderCell>Közlemény</Table.ColumnHeaderCell>
            <SortHeader label="Összeg" k="amount" sort={sort} onSort={onSort} align="right" />
            <Table.ColumnHeaderCell className="col-main">
              <Flex align="center" gap="1">
                Fő attribútum
                <Tooltip content="„megtakarítás” értéknél a tétel se bevételnek, se kiadásnak nem számít — csak az egyenleget módosítja.">
                  <InfoCircledIcon aria-label="Súgó" tabIndex={0} />
                </Tooltip>
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="col-tags">Al-attribútumok</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="col-actions">
              <span className="visually-hidden">Műveletek</span>
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {visible.map((tx) => {
            const included = !excludedIds.has(tx.id);
            return (
              <Table.Row key={tx.id} data-excluded={!included || undefined} className="ledger-row">
                <Table.Cell className="col-check">
                  <Checkbox
                    checked={included}
                    onCheckedChange={(c) => onToggle(tx.id, c === true)}
                    aria-label={`Beleszámít az összesítésbe: ${tx.description ?? formatDate(tx.date)}`}
                  />
                </Table.Cell>
                <Table.Cell className="col-date tabular">
                  <Text size="2">{formatDate(tx.date)}</Text>
                </Table.Cell>
                <Table.Cell className="col-desc">
                  <Flex direction="column" gap="1">
                    <Text size="2" className="desc">
                      {tx.description || <Text color="gray">—</Text>}
                    </Text>
                    {tx.tx_type && (
                      <Text size="1" color="gray">
                        {tx.tx_type}
                      </Text>
                    )}
                  </Flex>
                </Table.Cell>
                <Table.Cell align="right" className="col-amount">
                  <Flex direction="column" align="end" gap="1">
                    <Text size="2" weight="medium" className="tabular" color={KIND_COLOR[tx.kind]}>
                      {formatHuf(tx.amount)}
                    </Text>
                    <Badge size="1" variant="soft" color={KIND_COLOR[tx.kind]}>
                      {tx.kind}
                    </Badge>
                  </Flex>
                </Table.Cell>
                <Table.Cell className="col-main">
                  <MainCategoryField tx={tx} listId={LIST_ID} onSaved={onTxSaved} />
                </Table.Cell>
                <Table.Cell className="col-tags">
                  <AttributeTree txId={tx.id} nodes={tx.attributes} onChanged={onAttributesChanged} />
                </Table.Cell>
                <Table.Cell className="col-actions">
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="red"
                    aria-label="Tétel törlése"
                    title="Tétel törlése"
                    onClick={() => setPendingDelete(tx)}
                  >
                    <TrashIcon />
                  </IconButton>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>

      <Flex justify="between" align="center" wrap="wrap" gap="3" mt="3">
        <Flex align="center" gap="2">
          <Text size="2" color="gray" id="page-size-label">
            Sorok oldalanként
          </Text>
          <Select.Root value={pageSize} onValueChange={(v) => setPageSize(v as typeof pageSize)} size="1">
            <Select.Trigger aria-labelledby="page-size-label" />
            <Select.Content>
              {PAGE_SIZES.map((s) => (
                <Select.Item key={s} value={s}>
                  {s === "all" ? "Összes" : s}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex align="center" gap="3">
          <Text size="2" color="gray" className="tabular" aria-live="polite">
            {sorted.length ? `${safePage * size + 1}–${Math.min(sorted.length, (safePage + 1) * size)} / ${sorted.length}` : "0"}
          </Text>
          <Flex gap="1">
            <IconButton variant="soft" color="gray" size="1" aria-label="Előző oldal" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              variant="soft"
              color="gray"
              size="1"
              aria-label="Következő oldal"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRightIcon />
            </IconButton>
          </Flex>
        </Flex>
      </Flex>

      <AlertDialog.Root open={!!pendingDelete} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Tétel törlése</AlertDialog.Title>
          <AlertDialog.Description size="2">
            A tétel eltűnik a listából és a számításokból. Egy későbbi újrafeltöltés sem hozza vissza.
          </AlertDialog.Description>
          {pendingDelete && (
            <Flex direction="column" gap="1" mt="3" p="3" className="delete-preview">
              <Text size="2" weight="medium">
                {pendingDelete.description || pendingDelete.tx_type || "—"}
              </Text>
              <Text size="2" color="gray" className="tabular">
                {formatDate(pendingDelete.date)} · {formatHuf(pendingDelete.amount)}
              </Text>
            </Flex>
          )}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={deleting}>
                Mégse
              </Button>
            </AlertDialog.Cancel>
            <Button color="red" onClick={confirmDelete} loading={deleting}>
              Törlés
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
