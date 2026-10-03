import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Flex, IconButton, Popover, Separator, Text, TextField } from "@radix-ui/themes";
import { ChevronRightIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { api } from "../lib/api";
import type { AttributeNode } from "../lib/types";
import { useToast } from "./Toaster";

interface Props {
  txId: number;
  nodes: AttributeNode[];
  onChanged: () => Promise<void> | void;
}

/** Egyetlen szövegmezős mini-űrlap egy popoverben (új címke / átnevezés). */
function NameForm({
  label,
  initial = "",
  submitLabel,
  onSubmit,
  autoFocus = false,
}: {
  label: string;
  initial?: string;
  autoFocus?: boolean;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const handle = async (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onSubmit(name);
      setValue("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={handle}>
      <Text as="label" size="1" weight="medium" color="gray" className="field-label">
        {label}
        <Flex gap="2" mt="1">
          <TextField.Root size="1" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={autoFocus} style={{ flex: 1 }} />
          <Button size="1" type="submit" disabled={!value.trim() || busy} loading={busy}>
            {submitLabel}
          </Button>
        </Flex>
      </Text>
    </form>
  );
}

function countDescendants(n: AttributeNode): number {
  return n.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
}

function TagNode({ txId, node, onChanged }: { txId: number; node: AttributeNode; onChanged: Props["onChanged"] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const descendants = countDescendants(node);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      await onChanged();
      setOpen(false);
      if (okMsg) toast({ title: okMsg, tone: "success" });
    } catch (e) {
      toast({ title: "Nem sikerült menteni", description: (e as Error).message, tone: "error" });
    }
  };

  return (
    <span className="tag-node">
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setConfirmDelete(false);
        }}
      >
        <Popover.Trigger>
          <button type="button" className="tag" aria-label={`Al-attribútum: ${node.name} — szerkesztés`}>
            {node.name}
          </button>
        </Popover.Trigger>
        <Popover.Content size="1" width="280px">
          <Flex direction="column" gap="3">
            <NameForm
              key={`rename-${node.name}`}
              label="Átnevezés"
              initial={node.name}
              autoFocus
              submitLabel="Mentés"
              onSubmit={(name) => run(() => api.renameAttribute(node.id, name))}
            />
            <NameForm
              label={`Új al-attribútum „${node.name}” alá`}
              submitLabel="Hozzáadás"
              onSubmit={(name) => run(() => api.addAttribute(txId, name, node.id))}
            />
            <Separator size="4" />
            {confirmDelete ? (
              <Flex direction="column" gap="2">
                <Text size="1">
                  Biztosan törlöd? {descendants > 0 && `Az alatta lévő ${descendants} al-attribútum is törlődik.`}
                </Text>
                <Flex gap="2" justify="end">
                  <Button size="1" variant="soft" color="gray" onClick={() => setConfirmDelete(false)}>
                    Mégse
                  </Button>
                  <Button size="1" color="red" onClick={() => run(() => api.deleteAttribute(node.id), "Al-attribútum törölve")}>
                    Törlés
                  </Button>
                </Flex>
              </Flex>
            ) : (
              <Button size="1" variant="soft" color="red" onClick={() => setConfirmDelete(true)}>
                <TrashIcon />
                Törlés{descendants > 0 ? ` (+${descendants} alatta)` : ""}
              </Button>
            )}
          </Flex>
        </Popover.Content>
      </Popover.Root>
      {node.children.length > 0 && (
        <span className="tag-children">
          <ChevronRightIcon className="tag-sep" aria-hidden />
          {node.children.map((c) => (
            <TagNode key={c.id} txId={txId} node={c} onChanged={onChanged} />
          ))}
        </span>
      )}
    </span>
  );
}

export function AttributeTree({ txId, nodes, onChanged }: Props): ReactNode {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <Flex gap="1" wrap="wrap" align="center" className="tag-tree">
      {nodes.map((n) => (
        <TagNode key={n.id} txId={txId} node={n} onChanged={onChanged} />
      ))}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger>
          <IconButton size="1" variant="ghost" color="gray" aria-label="Al-attribútum hozzáadása" title="Al-attribútum hozzáadása">
            <PlusIcon />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content size="1" width="260px">
          <NameForm
            label="Új al-attribútum"
            autoFocus
            submitLabel="Hozzáadás"
            onSubmit={async (name) => {
              try {
                await api.addAttribute(txId, name, null);
                await onChanged();
                setOpen(false);
              } catch (e) {
                toast({ title: "Nem sikerült menteni", description: (e as Error).message, tone: "error" });
              }
            }}
          />
        </Popover.Content>
      </Popover.Root>
    </Flex>
  );
}
