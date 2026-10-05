import { useMemo, useState, type ReactNode } from "react";
import { Badge, Box, Card, Flex, Grid, SegmentedControl, Select, Table, Text } from "@radix-ui/themes";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Transaction } from "../lib/types";
import { monthlySpending, movingAverage } from "../lib/ledger";
import { formatCompact, formatHuf, formatMonth, formatNumber, formatPercent } from "../lib/format";
import { CATEGORICAL, OTHER_COLOR, OTHER_LABEL } from "../lib/palette";
import { AXIS_TICK, ChartCard, ChartTooltip, EmptyChart, GRID_STROKE } from "./chartParts";

interface Props {
  included: Transaction[];
  colorIndex: Map<string, number>;
  appearance: "light" | "dark";
}

const ALL = "__all__";
/** Választható mozgóátlag-ablakok (hónap); 0 = kikapcsolva. */
const MA_WINDOWS = [0, 3, 6, 12] as const;
type MaWindow = (typeof MA_WINDOWS)[number];
const maLabel = (w: number) => `${w} havi mozgóátlag`;
const MA_STROKE = "var(--gray-12)";

const legendFormatter = (value: string) => <span style={{ color: "var(--gray-11)" }}>{value}</span>;
const LEGEND_STYLE = { fontSize: 12, color: "var(--gray-11)", paddingBottom: 8 };

function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <Card size="2">
      <Flex direction="column" gap="1">
        <Text size="2" color="gray" weight="medium">
          {label}
        </Text>
        <Text size="5" weight="bold" className="tabular">
          {value}
        </Text>
        {hint && (
          <Text as="div" size="1" color="gray">
            {hint}
          </Text>
        )}
      </Flex>
    </Card>
  );
}

export function MonthlySpendingPanel({ included, colorIndex, appearance }: Props) {
  const palette = CATEGORICAL[appearance];
  const otherColor = OTHER_COLOR[appearance];
  const data = useMemo(() => monthlySpending(included), [included]);
  const [picked, setPicked] = useState<string>(ALL);
  const [maWindow, setMaWindow] = useState<MaWindow>(3);

  // Ha a szűrés miatt eltűnik a kiválasztott attribútum, visszaállunk az összesre.
  const focus = data.byCategory.find((c) => c.category === picked) ?? null;
  const colorOf = (category: string) =>
    colorIndex.has(category) ? palette[colorIndex.get(category)!] : otherColor;

  const n = data.months.length;
  const grandTotal = data.totals.reduce((s, v) => s + v, 0);
  const average = n ? grandTotal / n : 0;

  const totalMa = useMemo(() => (maWindow ? movingAverage(data.totals, maWindow) : []), [data, maWindow]);
  const trendRows = useMemo(
    () => data.months.map((month, i) => ({ month, total: data.totals[i], ma: totalMa[i] ?? null })),
    [data, totalMa],
  );

  // Halmozott oszlopok: a saját színnel rendelkező attribútumok külön sávként, a többi "Egyéb"-ben.
  // A recharts a dataKey-ben lévő pontot útvonalként értelmezné, ezért indexelt kulcsokat használunk.
  const stack = useMemo(() => {
    const named = data.byCategory.filter((c) => colorIndex.has(c.category));
    const rest = data.byCategory.filter((c) => !colorIndex.has(c.category));
    const series: { key: string; name: string; fill: string; perMonth: number[] }[] = named.map((c, i) => ({
      key: `s${i}`,
      name: c.category,
      fill: palette[colorIndex.get(c.category)!],
      perMonth: c.perMonth,
    }));
    if (rest.length) {
      series.push({
        key: "other",
        name: `${OTHER_LABEL} (${rest.length})`,
        fill: otherColor,
        perMonth: data.months.map((_, i) => rest.reduce((s, c) => s + c.perMonth[i], 0)),
      });
    }
    const rows = data.months.map((month, i) => {
      const row: Record<string, string | number | null> = { month, ma: totalMa[i] ?? null };
      for (const s of series) row[s.key] = s.perMonth[i];
      return row;
    });
    return { series, rows };
  }, [data, colorIndex, palette, otherColor, totalMa]);

  const focusRows = useMemo(() => {
    if (!focus) return [];
    const ma = maWindow ? movingAverage(focus.perMonth, maWindow) : [];
    return data.months.map((month, i) => ({ month, amount: focus.perMonth[i], ma: ma[i] ?? null }));
  }, [data, focus, maWindow]);

  const maLine = maWindow ? (
    <Line
      dataKey="ma"
      name={maLabel(maWindow)}
      stroke={MA_STROKE}
      strokeWidth={2}
      dot={false}
      connectNulls={false}
      isAnimationActive={false}
    />
  ) : null;

  if (n === 0) {
    return (
      <Card size="3">
        <EmptyChart />
      </Card>
    );
  }

  const peakIdx = data.totals.indexOf(Math.max(...data.totals));
  const last = data.totals[n - 1];
  const prev = n > 1 ? data.totals[n - 2] : null;
  const change = prev ? (last - prev) / prev : null;

  return (
    <Flex direction="column" gap="4">
      <Grid columns={{ initial: "1", sm: "3" }} gap="3" asChild>
        <section aria-label="Havi költés összesítése">
          <Stat label="Átlagos havi költés" value={formatHuf(average)} hint={`${n} hónap alapján`} />
          <Stat label="Legtöbb költés" value={formatHuf(data.totals[peakIdx])} hint={formatMonth(data.months[peakIdx])} />
          <Stat
            label={`Utolsó hónap (${formatMonth(data.months[n - 1])})`}
            value={formatHuf(last)}
            hint={
              change == null ? (
                "Nincs előző hónap az összevetéshez."
              ) : (
                <Flex align="center" gap="1">
                  {/* Több költés = rossz irány, ezért piros. */}
                  <Badge color={change > 0 ? "red" : "green"} variant="soft" className="tabular">
                    {change > 0 ? "+" : ""}
                    {formatPercent(change)}
                  </Badge>
                  az előző hónaphoz képest
                </Flex>
              )
            }
          />
        </section>
      </Grid>

      <Flex align="center" gap="3" wrap="wrap">
        <Text size="2" weight="medium" color="gray" id="ms-ma-label">
          Mozgóátlag
        </Text>
        <SegmentedControl.Root
          value={String(maWindow)}
          onValueChange={(v) => setMaWindow(Number(v) as MaWindow)}
          aria-labelledby="ms-ma-label"
          size="1"
        >
          {MA_WINDOWS.map((w) => (
            <SegmentedControl.Item key={w} value={String(w)}>
              {w ? `${w} hó` : "Ki"}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
        {maWindow > 0 && (
          <Text size="1" color="gray">
            Minden hónapnál az utolsó {maWindow} hónap átlaga, így kisimul a havi ingadozás.
          </Text>
        )}
      </Flex>

      <ChartCard
        title="Teljes költés havonta"
        description={
          maWindow
            ? `Az oszlopok a havi kiadást, a vonal a ${maLabel(maWindow)}ot, a szaggatott vonal a teljes időszak átlagát mutatja.`
            : "Az oszlopok a havi kiadást, a szaggatott vonal a teljes időszak átlagát mutatja."
        }
      >
        <Box style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="month" tickFormatter={formatMonth} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip labelFormatter={formatMonth} />} cursor={{ fill: "var(--gray-a3)" }} />
              <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} formatter={legendFormatter} wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="total" name="Kiadás" fill={palette[1]} radius={[4, 4, 0, 0]} maxBarSize={36} />
              {maLine}
              <ReferenceLine y={average} stroke="var(--gray-9)" strokeDasharray="4 4" ifOverflow="extendDomain" />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </ChartCard>

      <ChartCard
        title="Költés fő attribútumonként, havonta"
        description={
          focus
            ? `${focus.category}: havi átlag ${formatHuf(focus.total / n)}, összesen ${formatHuf(focus.total)}.${maWindow ? ` A vonal a ${maLabel(maWindow)}.` : ""}`
            : `${maWindow ? `A vonal a teljes költés ${maLabel(maWindow)}a. ` : ""}Válassz egy attribútumot a havi alakulásához, vagy kattints egy sorra az alábbi táblázatban.`
        }
        action={
          <Box minWidth="200px">
            <Text as="div" size="1" weight="medium" color="gray" id="ms-attr-label" className="field-label">
              Fő attribútum
            </Text>
            <Select.Root value={focus ? focus.category : ALL} onValueChange={setPicked}>
              <Select.Trigger aria-labelledby="ms-attr-label" style={{ width: "100%" }} />
              <Select.Content position="popper">
                <Select.Item value={ALL}>Összes (halmozva)</Select.Item>
                <Select.Separator />
                {data.byCategory.map((c) => (
                  <Select.Item key={c.category} value={c.category}>
                    {c.category}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
        }
      >
        <Box style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            {focus ? (
              <ComposedChart data={focusRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<ChartTooltip labelFormatter={formatMonth} />} cursor={{ fill: "var(--gray-a3)" }} />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} formatter={legendFormatter} wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="amount" name={focus.category} fill={colorOf(focus.category)} radius={[4, 4, 0, 0]} maxBarSize={36} />
                {maLine}
                <ReferenceLine y={focus.total / n} stroke="var(--gray-9)" strokeDasharray="4 4" ifOverflow="extendDomain" />
              </ComposedChart>
            ) : (
              <ComposedChart data={stack.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<ChartTooltip labelFormatter={formatMonth} stacked unstackedKeys={["ma"]} />} cursor={{ fill: "var(--gray-a3)" }} />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} formatter={legendFormatter} wrapperStyle={LEGEND_STYLE} />
                {stack.series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    stackId="spend"
                    fill={s.fill}
                    stroke="var(--color-panel-solid)"
                    strokeWidth={1}
                    maxBarSize={36}
                  />
                ))}
                {maLine}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </Box>

        <Box mt="4" className="pivot-scroll">
          <Table.Root size="1" className="pivot-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell className="pivot-sticky">Fő attribútum</Table.ColumnHeaderCell>
                {data.months.map((m) => (
                  <Table.ColumnHeaderCell key={m} align="right">
                    {formatMonth(m)}
                  </Table.ColumnHeaderCell>
                ))}
                <Table.ColumnHeaderCell align="right">Átlag / hó</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell align="right">Összesen</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.byCategory.map((c) => {
                const selected = focus?.category === c.category;
                return (
                  <Table.Row
                    key={c.category}
                    className="pivot-row"
                    data-selected={selected || undefined}
                    tabIndex={0}
                    aria-selected={selected}
                    onClick={() => setPicked(selected ? ALL : c.category)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPicked(selected ? ALL : c.category);
                      }
                    }}
                  >
                    <Table.RowHeaderCell className="pivot-sticky">
                      <Flex align="center" gap="2">
                        <span className="swatch" style={{ background: colorOf(c.category) }} aria-hidden />
                        {c.category}
                      </Flex>
                    </Table.RowHeaderCell>
                    {c.perMonth.map((v, i) => (
                      <Table.Cell key={data.months[i]} align="right" className="tabular" data-zero={v === 0 || undefined}>
                        {v === 0 ? "–" : formatNumber(v)}
                      </Table.Cell>
                    ))}
                    <Table.Cell align="right" className="tabular">
                      {formatNumber(c.total / n)}
                    </Table.Cell>
                    <Table.Cell align="right" className="tabular">
                      <strong>{formatNumber(c.total)}</strong>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
              <Table.Row className="pivot-total">
                <Table.RowHeaderCell className="pivot-sticky">Összesen</Table.RowHeaderCell>
                {data.totals.map((v, i) => (
                  <Table.Cell key={data.months[i]} align="right" className="tabular" data-zero={v === 0 || undefined}>
                    {v === 0 ? "–" : formatNumber(v)}
                  </Table.Cell>
                ))}
                <Table.Cell align="right" className="tabular">
                  {formatNumber(average)}
                </Table.Cell>
                <Table.Cell align="right" className="tabular">
                  {formatNumber(grandTotal)}
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
          <Text as="p" size="1" color="gray" mt="2">
            Összegek forintban.
          </Text>
        </Box>
      </ChartCard>
    </Flex>
  );
}
