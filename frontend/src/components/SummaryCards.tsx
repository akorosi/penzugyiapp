import type { ComponentType } from "react";
import { Card, Flex, Grid, Skeleton, Text } from "@radix-ui/themes";
import { ArrowDownIcon, ArrowUpIcon, BookmarkIcon, LayersIcon } from "@radix-ui/react-icons";
import { formatHuf } from "../lib/format";
import type { Totals } from "../lib/ledger";

interface Props {
  totals: Totals;
  loading: boolean;
}

type Accent = "green" | "red" | "blue" | "gray";

function Stat({
  label,
  value,
  hint,
  accent,
  Icon,
  loading,
}: {
  label: string;
  value: number;
  hint: string;
  accent: Accent;
  Icon: ComponentType<{ width?: string; height?: string }>;
  loading: boolean;
}) {
  return (
    <Card size="2" className="stat" data-accent={accent}>
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <span className="stat__icon" aria-hidden>
            <Icon width="14" height="14" />
          </span>
          <Text size="2" color="gray" weight="medium">
            {label}
          </Text>
        </Flex>
        <Skeleton loading={loading}>
          <Text as="p" size={{ initial: "4", sm: "6" }} weight="bold" className="tabular stat__value">
            {formatHuf(value)}
          </Text>
        </Skeleton>
        <Skeleton loading={loading}>
          <Text size="1" color="gray">
            {hint}
          </Text>
        </Skeleton>
      </Flex>
    </Card>
  );
}

export function SummaryCards({ totals, loading }: Props) {
  return (
    <Grid columns={{ initial: "2", md: "4" }} gap="3" asChild>
      <section aria-label="Összesítés">
        <Stat label="Bevétel" value={totals.income} hint={`${totals.incomeCount} tétel`} accent="green" Icon={ArrowUpIcon} loading={loading} />
        <Stat label="Kiadás" value={totals.expense} hint={`${totals.expenseCount} tétel`} accent="red" Icon={ArrowDownIcon} loading={loading} />
        <Stat label="Megtakarítás" value={totals.savings} hint={`${totals.savingsCount} tétel`} accent="blue" Icon={BookmarkIcon} loading={loading} />
        <Stat
          label="Egyenleg"
          value={totals.balance}
          hint="Kijelölt tételek alapján"
          accent="gray"
          Icon={LayersIcon}
          loading={loading}
        />
      </section>
    </Grid>
  );
}
