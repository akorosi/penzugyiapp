import { useState, type FormEvent } from "react";
import { Button, Callout, Card, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { ExclamationTriangleIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { getAccessKey } from "../lib/api";

interface Props {
  onSubmit: (key: string) => Promise<void>;
}

/** Belépés a Terraform által generált hozzáférési kulccsal. */
export function AccessKeyScreen({ onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const hadKey = !!getAccessKey();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex justify="center" py="9">
      <Card size="4" style={{ width: "100%", maxWidth: 440 }}>
        <form onSubmit={submit}>
          <Flex direction="column" gap="4">
            <Flex direction="column" align="center" gap="3">
              <span className="empty-state__icon" aria-hidden>
                <LockClosedIcon width="22" height="22" />
              </span>
              <Heading as="h2" size="5">
                Belépés
              </Heading>
              <Text size="2" color="gray" align="center">
                Add meg a hozzáférési kulcsot. A telepítés után a{" "}
                <code>terraform output -raw access_key</code> paranccsal kérdezhető le.
              </Text>
            </Flex>
            {hadKey && (
              <Callout.Root color="amber" size="1">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>A mentett kulcs érvénytelen vagy lejárt.</Callout.Text>
              </Callout.Root>
            )}
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Hozzáférési kulcs
              </Text>
              <TextField.Root
                type="password"
                autoComplete="current-password"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                size="3"
              />
            </label>
            <Button size="3" type="submit" loading={busy} disabled={!value.trim()}>
              Belépés
            </Button>
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}
