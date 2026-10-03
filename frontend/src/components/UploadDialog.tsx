import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button, Callout, Code, Dialog, Flex, Spinner, Text } from "@radix-ui/themes";
import { CheckCircledIcon, CrossCircledIcon, FileTextIcon, UploadIcon } from "@radix-ui/react-icons";
import { api } from "../lib/api";
import type { UploadResult } from "../lib/types";

const ACCEPT = [".xls", ".xlsx"];

interface Props {
  trigger: ReactNode;
  onImported: (r: UploadResult) => void | Promise<void>;
}

export function UploadDialog({ trigger, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pick = (f: File | undefined) => {
    setResult(null);
    if (!f) return;
    const ok = ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext));
    if (!ok) {
      setFile(null);
      setError("Csak .xls vagy .xlsx fájl tölthető fel.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.upload(file);
      setResult(r);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await onImported(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Dialog.Trigger>{trigger}</Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Kivonat importálása</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Töltsd fel a CIB <Code variant="ghost">tranzakciok.xls</Code> (vagy .xlsx) kivonatot. A már korábban
          betöltött vagy törölt tételek automatikusan kimaradnak.
        </Dialog.Description>

        <label
          htmlFor={inputId}
          className="dropzone"
          data-dragging={dragging || undefined}
          data-has-file={file ? "" : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            id={inputId}
            className="visually-hidden"
            type="file"
            accept={ACCEPT.join(",")}
            onChange={(e) => pick(e.target.files?.[0])}
            disabled={busy}
          />
          {file ? (
            <Flex direction="column" align="center" gap="2">
              <FileTextIcon width="28" height="28" aria-hidden />
              <Text size="3" weight="medium" className="dropzone__filename">
                {file.name}
              </Text>
              <Text size="1" color="gray">
                {(file.size / 1024).toFixed(0)} KB · kattints másik fájl választásához
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" align="center" gap="2">
              <UploadIcon width="28" height="28" aria-hidden />
              <Text size="3" weight="medium">
                Húzd ide a fájlt, vagy <span className="dropzone__link">tallózz</span>
              </Text>
              <Text size="1" color="gray">
                .xls, .xlsx · a tételek a 11. sortól kerülnek beolvasásra
              </Text>
            </Flex>
          )}
        </label>

        <div aria-live="polite">
          {error && (
            <Callout.Root color="red" mt="4" role="alert">
              <Callout.Icon>
                <CrossCircledIcon />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {result && (
            <Callout.Root color="green" mt="4">
              <Callout.Icon>
                <CheckCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                <strong>{result.inserted}</strong> új tétel importálva, <strong>{result.skipped}</strong> már
                létezett (összesen {result.total_parsed} sor a fájlban).
              </Callout.Text>
            </Callout.Root>
          )}
        </div>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              {result ? "Kész" : "Mégse"}
            </Button>
          </Dialog.Close>
          <Button onClick={submit} disabled={!file || busy}>
            <Spinner loading={busy}>
              <UploadIcon />
            </Spinner>
            {busy ? "Feldolgozás…" : "Importálás"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
