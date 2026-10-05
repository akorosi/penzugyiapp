import type { ReactNode } from "react";
import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { BarChartIcon } from "@radix-ui/react-icons";
import { formatHuf } from "../lib/format";

export const AXIS_TICK = { fill: "var(--gray-11)", fontSize: 12 };
export const GRID_STROKE = "var(--gray-a4)";

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  stacked,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: { fill?: string } }[];
  label?: string | number;
  labelFormatter?: (l: string) => string;
  /** Halmozott diagram: a nulla sorok elmaradnak, a többi csökkenő sorrendben, alul összesen. */
  stacked?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const rows = stacked
    ? payload.filter((p) => (p.value ?? 0) !== 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    : payload;
  const title = label != null && label !== "" ? (labelFormatter ? labelFormatter(String(label)) : String(label)) : null;
  return (
    <div className="chart-tooltip">
      {title && (
        <Text as="div" size="1" weight="medium" mb="1">
          {title}
        </Text>
      )}
      {rows.map((p, i) => (
        <Flex key={i} align="center" gap="2">
          <span className="swatch" style={{ background: p.color ?? p.payload?.fill }} aria-hidden />
          <Text size="1" color="gray">
            {p.name}
          </Text>
          <Text size="1" weight="medium" className="tabular" ml="auto">
            {formatHuf(p.value ?? 0)}
          </Text>
        </Flex>
      ))}
      {stacked && rows.length > 1 && (
        <Flex align="center" gap="2" pt="1" className="chart-tooltip__total">
          <Text size="1" weight="medium">
            Összesen
          </Text>
          <Text size="1" weight="bold" className="tabular" ml="auto">
            {formatHuf(rows.reduce((s, p) => s + (p.value ?? 0), 0))}
          </Text>
        </Flex>
      )}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  /** Opcionális vezérlő a fejléc jobb oldalán (pl. választó). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="3" asChild>
      <section aria-label={title}>
        <Flex justify="between" align="start" gap="3" wrap="wrap" mb="4">
          <Box>
            <Heading as="h3" size="3" mb="1">
              {title}
            </Heading>
            <Text as="p" size="2" color="gray">
              {description}
            </Text>
          </Box>
          {action}
        </Flex>
        {children}
      </section>
    </Card>
  );
}

export function EmptyChart() {
  return (
    <Flex direction="column" align="center" justify="center" gap="2" py="8" className="empty-chart">
      <BarChartIcon width="24" height="24" aria-hidden />
      <Text size="2" color="gray">
        Nincs megjeleníthető kiadás a jelenlegi szűrés és kijelölés mellett.
      </Text>
    </Flex>
  );
}
