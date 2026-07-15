// Web Worker: ejecuta el análisis pesado de inventario fuera del hilo principal
// (DATA-003). La lógica vive en ./utils/calculations (sin cambios); aquí solo
// la envolvemos para no bloquear la UI con datasets grandes.
import { processInventoryData } from '../utils/calculations';
import type { RawSalesData, RawInventoryData, RawLeadTimeData } from '../types';

export interface InventoryWorkerInput {
  sales2026: RawSalesData[];
  sales2025: RawSalesData[];
  sales2024: RawSalesData[];
  sales2023: RawSalesData[];
  inventory: RawInventoryData[];
  leadTime: RawLeadTimeData[];
  // Parámetros del EOQ (S y H). Entran al análisis porque la cantidad óptima (Q)
  // se calcula con el EOQ; si se omiten, calculations usa sus defaults (100/25).
  eoqOrderCost?: number;
  eoqHoldingRate?: number;
}

// Tipado mínimo del contexto del worker para no depender de la lib "webworker"
// (evita conflictos con la lib DOM del proyecto del portal).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (e: MessageEvent) => {
  const d = e.data as InventoryWorkerInput;
  try {
    const result = processInventoryData(
      d.sales2026, d.sales2025, d.sales2024, d.sales2023, d.inventory, d.leadTime,
      d.eoqOrderCost, d.eoqHoldingRate,
    );
    ctx.postMessage({ ok: true, result });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
