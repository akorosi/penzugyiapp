import { useMemo, type ReactNode } from "react";
import { Box, Card, Flex, Grid, Heading, Table, Text } from "@radix-ui/themes";
import { BarChartIcon } from "@radix-ui/react-icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Transaction } from "../lib/types";
import { expensesByCategory, monthlyFlow } from "../lib/ledger";
import { formatCompact, formatHuf, formatMonth, formatPercent } from "../lib/format";
import { CATEGORICAL, OTHER_COLOR, OTHER_LABEL } from "../lib/palette";

interface Props {
  included: Transaction[];
  colorIndex: Map<string, number>;
  appearance: "light" | "dark";
}

const AXIS_TICK = { fill: "var(--gray-11)", fontSize: 12 };
const GRID_STROKE = "var(--gray-a4)";

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: { fill?: string } }[];
  label?: string | number;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const title = label != null && label !== "" ? (labelFormatter ? labelFormatter(String(label)) : String(label)) : null;
  return (
    <div className="chart-tooltip">
      {title && (
        <Text as="div" size="1" weight="medium" mb="1">
          {title}
        </Text>
      )}
      {payload.map((p, i) => (
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
    </div>
  );
}

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card size="3" asChild>
      <section aria-label={title}>
        <Heading as="h3" size="3" mb="1">
          {title}
        </Heading>
        <Text as="p" size="2" color="gray" mb="4">
          {description}
        </Text>
        {children}
      </section>
    </Card>
  );
}

function EmptyChart() {
  return (
    <Flex direction="column" align="center" justify="center" gap="2" py="8" className="empty-chart">
      <BarChartIcon width="24" height="24" aria-hidden />
      <Text size="2" color="gray">
        Nincs megjeleníthető kiadás a jelenlegi szűrés és kijelölés mellett.
      </Text>
    </Flex>
  );
}

export function AnalyticsView({ included, colorIndex, appearance }: Props) {
  const palette = CATEGORICAL[appearance];
  const otherColor = OTHER_COLOR[appearance];
  const expenses = useMemo(() => expensesByCategory(included), [included]);
  const monthly = useMemo(() => monthlyFlow(included), [included]);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);

  // Donut: a színnel rendelkező kategóriák külön szeletként, a többi "Egyéb"-be gyűjtve.
  const donut = useMemo(() => {
    const named = expenses.filter((e) => colorIndex.has(e.category));
    const rest = expenses.filter((e) => !colorIndex.has(e.category));
    const rows: { category: string; amount: number; fill: string }[] = named.map((e) => ({
      ...e,
      fill: palette[colorIndex.get(e.category)!],
    }));
    if (rest.length) {
      rows.push({ category: `${OTHER_LABEL} (${rest.length})`, amount: rest.reduce((s, e) => s + e.amount, 0), fill: otherColor });
    }
    return rows;
  }, [expenses, colorIndex, palette, otherColor]);

  const barHeight = Math.max(160, expenses.length * 36 + 40);

  return (
    <Flex direction="column" gap="4">
      <Text size="2" color="gray">
        A diagramok csak a jelenlegi szűrésnek megfelelő <strong>és kijelölt</strong> tételek alapján számolnak.
      </Text>

      <Grid columns={{ initial: "1", lg: "2" }} gap="4">
        <ChartCard title="Kiadások fő attribútum szerint" description="Legnagyobb költés felül, csökkenő sorrendben.">
          {expenses.length === 0 ? (
            <EmptyChart />
          ) : (
            <Box style={{ height: barHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={expenses} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
                  <XAxis type="number" tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={130}
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--gray-a3)" }} />
                  <Bar dataKey="amount" name="Kiadás" fill={palette[0]} radius={[0, 4, 4, 0]} maxBarSize={24}>
                    <LabelList
                      dataKey="amount"
                      position="right"
                      formatter={(v: unknown) => formatCompact(Number(v))}
                      style={{ fill: "var(--gray-11)", fontSize: 12 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          )}
        </ChartCard>

        <ChartCard
          title="Kiadások megoszlása"
          description={`A ${palette.length} legnagyobb kategória külön, a többi „${OTHER_LABEL}” alatt.`}
        >
          {donut.length === 0 ? (
            <EmptyChart />
          ) : (
            <Flex direction={{ initial: "column", sm: "row" }} gap="4" align="center">
              <Box style={{ width: 220, height: 220, flexShrink: 0 }} position="relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donut}
                      dataKey="amount"
                      nameKey="category"
                      innerRadius={66}
                      outerRadius={104}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={1}
                      stroke="var(--color-panel-solid)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {donut.map((d) => (
                        <Cell key={d.category} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <Flex direction="column" align="center" justify="center" className="donut-center">
                  <Text size="1" color="gray">
                    Összesen
                  </Text>
                  <Text size="3" weight="bold" className="tabular">
                    {formatCompact(totalExpense)} Ft
                  </Text>
                </Flex>
              </Box>
              <Table.Root size="1" className="donut-legend">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Kategória</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell align="right">Összeg</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell align="right">Arány</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {donut.map((d) => (
                    <Table.Row key={d.category}>
                      <Table.Cell>
                        <Flex align="center" gap="2">
                          <span className="swatch" style={{ background: d.fill }} aria-hidden />
                          {d.category}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell align="right" className="tabular">
                        {formatHuf(d.amount)}
                      </Table.Cell>
                      <Table.Cell align="right" className="tabular">
                        {formatPercent(d.amount / totalExpense)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Flex>
          )}
        </ChartCard>
      </Grid>

      <ChartCard title="Havi pénzmozgás" description="Bevétel és kiadás hónapról hónapra (megtakarítás nélkül).">
        {monthly.length === 0 ? (
          <EmptyChart />
        ) : (
          <Box style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<ChartTooltip labelFormatter={formatMonth} />} cursor={{ fill: "var(--gray-a3)" }} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ color: "var(--gray-11)" }}>{value}</span>}
                  wrapperStyle={{ fontSize: 12, color: "var(--gray-11)", paddingBottom: 8 }}
                />
                <Bar dataKey="income" name="Bevétel" fill={palette[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expense" name="Kiadás" fill={palette[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </ChartCard>
    </Flex>
  );
}
