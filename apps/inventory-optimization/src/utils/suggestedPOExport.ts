import { redondear } from '@suite/format';
import type { AnalysisResult } from '../types';

/** Lo que la exportación necesita de cada línea de la OC sugerida (SuggestedPO). */
export interface LineaOcExport {
    sku: string;
    itemName: string;
    status: AnalysisResult['status'];
    physicalAvailable: number;
    reorderPoint: number;
    incoming: number;
    suggestedQty: number;
    leadTimeDays: number;
    unitPrice: number;
    amount: number;
}

/**
 * Las filas del Excel «OC Sugerida», proveedor por proveedor. Vive aparte de
 * SuggestedPO para poder probarlo sin React ni xlsx (DATA-334).
 *
 * DATA-334 — se redondea sólo lo CALCULADO en coma flotante, y sólo aquí, en la
 * frontera: el importe (cantidad × precio) a centavos y la física disponible (a mano −
 * comprometido) a 6 decimales, como `sinResiduo` de hub-api, que no altera ninguna
 * cantidad real. El precio y lo que está en camino son dato de origen y van tal cual.
 */
export function filasOcSugerida(groups: { vendor: string; lines: LineaOcExport[] }[]) {
    return groups.flatMap((g) =>
        g.lines.map((l) => ({
            Proveedor: g.vendor,
            SKU: l.sku,
            'Artículo': l.itemName,
            Estatus: l.status,
            'Física disponible': redondear(l.physicalAvailable, 6),
            'Punto de pedido': Math.round(l.reorderPoint),
            'En camino': l.incoming,
            'Cantidad sugerida': l.suggestedQty,
            'Lead time (días)': l.leadTimeDays,
            'Precio (USD)': l.unitPrice,
            'Importe estimado (USD)': redondear(l.amount, 2),
        }))
    );
}
