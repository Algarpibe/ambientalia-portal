import { T } from './warmTheme';

type TipItem = { name?: string; value?: number | string; color?: string; dataKey?: string };

/** Formateador del valor; recibe también el item para formatear por serie (unidades mixtas). */
type TipFmt = (n: number, item?: TipItem) => string;

/** Tooltip oscuro y redondeado, homogéneo para todas las gráficas de la sub-app. */
export default function ChartTooltip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TipItem>;
  label?: string | number;
  fmt: TipFmt;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: T.ink,
        color: T.surface,
        borderRadius: 9,
        padding: '8px 10px',
        fontSize: 12,
        boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
      }}
    >
      {label !== undefined && label !== '' && (
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          {p.name !== undefined && <span style={{ color: '#D9D6CF' }}>{p.name}</span>}
          <span style={{ fontWeight: 600 }}>{fmt(Number(p.value), p)}</span>
        </div>
      ))}
    </div>
  );
}

/** Helper para el prop `content` de recharts <Tooltip>. `fmt` puede formatear por
 *  serie usando el 2º argumento (item) — útil para tooltips con unidades mixtas. */
export function tooltip(fmt: TipFmt) {
  return (p: { active?: boolean; label?: string | number; payload?: ReadonlyArray<TipItem> }) => (
    <ChartTooltip active={p.active} label={p.label} payload={p.payload} fmt={fmt} />
  );
}
