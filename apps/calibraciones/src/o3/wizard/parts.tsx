import { Plus, Trash2 } from 'lucide-react';
import type { Issue } from '../../engine';
import { parseDecimal } from '../../lib/parse';
import type { FactorRow } from '../../lib/draft';
import { Button, DecimalInput, TextInput } from '../../ui';

/** Blocking issues (red) and warnings (amber), always visually separate. */
export function IssueLists({ blocking, warnings, source }: { blocking: Issue[]; warnings: Issue[]; source: string }) {
  if (blocking.length === 0 && warnings.length === 0) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {blocking.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="mb-2 text-sm font-semibold text-red-800">
            Bloquean el cálculo ({blocking.length}) · {source}
          </p>
          <ul className="space-y-2">
            {blocking.map((i) => (
              <li key={i.code + i.messageEs} className="text-sm text-red-800">
                {i.messageEs}
                <span className="block text-xs text-red-600">
                  {i.code} · {i.reference}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-semibold text-amber-900">
            Advertencias ({warnings.length}) · {source}
          </p>
          <ul className="space-y-2">
            {warnings.map((i) => (
              <li key={i.code + i.messageEs} className="text-sm text-amber-900">
                {i.messageEs}
                <span className="block text-xs text-amber-700">
                  {i.code} · {i.reference}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Editable name → value list of internal factors (span, zero…). */
export function FactorEditor({
  label,
  rows,
  onChange,
  readOnly,
}: {
  label: string;
  rows: FactorRow[];
  onChange: (rows: FactorRow[]) => void;
  readOnly: boolean;
}) {
  const set = (i: number, patch: Partial<FactorRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="rounded-xl border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-700">{label}</legend>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const n = parseDecimal(r.value);
          return (
            <div key={i} className="flex items-center gap-2">
              <TextInput
                aria-label="Nombre del factor"
                value={r.name}
                disabled={readOnly}
                onChange={(e) => set(i, { name: e.target.value })}
                className="w-28 shrink-0"
              />
              <DecimalInput
                aria-label={`Valor de ${r.name || 'factor'}`}
                value={r.value}
                disabled={readOnly}
                invalid={n !== null && Number.isNaN(n)}
                onChange={(e) => set(i, { value: e.target.value })}
              />
              {!readOnly && (
                <Button variant="ghost" aria-label="Quitar factor" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <Button variant="ghost" className="mt-2" onClick={() => onChange([...rows, { name: '', value: '' }])}>
          <Plus className="h-4 w-4" aria-hidden /> Añadir factor
        </Button>
      )}
    </fieldset>
  );
}
