import type { RawInventoryData, RawSalesData, AnalysisResult, RawLeadTimeData } from '../types';
import { computeEoq } from './eoq';

// Constants
const ADMIN_DELAY_DAYS = 30;
const MIN_MONTHS_FOR_TREND = 3;
const CROSTON_ALPHA = 0.3;      // suavizado de Croston/SBA
const ADI_THRESHOLD = 1.32;     // Syntetos-Boylan: ADI ≥ 1.32 → intermitente/lumpy
const CV2_THRESHOLD = 0.49;     // CV² ≥ 0.49 → errática/lumpy

// --- Nivel de servicio diferenciado (matriz ABC-XYZ) ---
// Filas ABC = importancia (Pareto del valor de consumo anual): los A se protegen más.
// Columnas XYZ = predictibilidad de la demanda: cuanto más errática (Z), más se rebaja
// el objetivo, porque cada punto de servicio sobre ruido cuesta muchísimo stock (y es
// justo lo que inflaba el PdP). BY = 1.645 (95%) conserva el nivel histórico como ancla.
const SERVICE_Z: Record<string, number> = {
  AX: 2.05, AY: 1.88, AZ: 1.75,   // 98% · 97% · 96%
  BX: 1.75, BY: 1.645, BZ: 1.48,  // 96% · 95% · 93%
  CX: 1.48, CY: 1.28, CZ: 1.04,   // 93% · 90% · 85%
};
const DEFAULT_SERVICE_Z = 1.645;  // 95% — respaldo si no hay clase ABC-XYZ
const HIGH_VALUE_Z_CAP = 1.28;    // Alto valor: techo de servicio 90% (no sobre-stockear caro)

// Tope de cordura del PdP: ni el PEOR mes histórico sostenido durante todo el lead
// time más 2 meses de colchón justifica más stock que esto.
const PDP_CAP_EXTRA_MONTHS = 2;

// Obsolescencia (política del negocio): si un artículo no se vende hace más de 12
// meses —o no se ha vendido nunca— no se stockea, punto. Es una red de seguridad
// independiente del pronóstico: aunque el modelo proponga un PdP, aquí se corta.
const OBSOLETE_MONTHS = 12;

// Rango sano de la cantidad óptima (Q), en meses de demanda.
const Q_MIN_MONTHS = 1;
const Q_MAX_MONTHS_STANDARD = 6;
const Q_MAX_MONTHS_HIGH_VALUE = 3;

const HIGH_VALUE_PRICE = 1500;    // USD — a partir de aquí "Alto valor"
const ULTRA_VALUE_PRICE = 10000;  // USD — a partir de aquí "Ultra alto" (PdP = Q = 1)

// Parámetros EOQ por defecto (los mismos que la barra de la tabla).
const EOQ_DEFAULT_ORDER_COST = 100;   // S: costo por pedido (USD)
const EOQ_DEFAULT_HOLDING_RATE = 25;  // H: tasa de mantenimiento anual (% del costo)

type DemandPattern = 'Suave' | 'Intermitente' | 'Errática' | 'Lumpy';

// Croston / SBA (Syntetos-Boylan Approximation) sobre una serie mensual.
// Separa tamaño de demanda (z) e intervalo entre demandas (p), ambos suavizados
// por exponencial. Devuelve el pronóstico por período, ADI, CV² y el patrón.
// meanSize/sigmaSize describen la distribución del TAMAÑO de los pedidos no nulos
// (ignorando los meses en cero): son la base del safety stock de demanda intermitente.
export function crostonSBA(series: number[], alpha = CROSTON_ALPHA): {
    forecast: number; adi: number; cv2: number; pattern: DemandPattern; demands: number;
    meanSize: number; sigmaSize: number;
} {
    let z = 0;      // tamaño suavizado
    let p = 0;      // intervalo suavizado
    let q = 0;      // períodos desde la última demanda
    let init = false;
    let demands = 0;
    const sizes: number[] = [];
    for (let t = 0; t < series.length; t++) {
        const y = series[t];
        q += 1;
        if (y > 0) {
            demands += 1;
            sizes.push(y);
            if (!init) { z = y; p = q; init = true; }
            else {
                z = z + alpha * (y - z);
                p = p + alpha * (q - p);
            }
            q = 0;
        }
    }
    if (!init || p <= 0) {
        return { forecast: 0, adi: series.length || Infinity, cv2: 0, pattern: 'Suave', demands: 0, meanSize: 0, sigmaSize: 0 };
    }
    // Al salir del bucle, q = períodos transcurridos desde la ÚLTIMA demanda. Croston
    // a secas lo descarta, y por eso sigue pronosticando como si el artículo aún se
    // vendiera: con una sola venta, p se queda clavado en el hueco inicial y los años
    // de silencio posteriores no cuentan (un artículo con 1 ud en 43 meses pronosticaba
    // 0.283/mes en vez de 0.024 — 12× de más).
    // El intervalo entre demandas no puede ser más corto que lo que ya llevamos
    // esperando: si hace 40 meses que no se vende, el intervalo es 40 como mínimo.
    const effectiveP = Math.max(p, q);
    const forecast = (1 - alpha / 2) * (z / effectiveP); // SBA
    const adi = series.length / demands;
    const meanSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const variance = sizes.reduce((a, b) => a + (b - meanSize) ** 2, 0) / sizes.length;
    const sigmaSize = Math.sqrt(variance);
    const cv2 = meanSize > 0 ? variance / (meanSize * meanSize) : 0;
    const pattern: DemandPattern =
        adi >= ADI_THRESHOLD
            ? (cv2 >= CV2_THRESHOLD ? 'Lumpy' : 'Intermitente')
            : (cv2 >= CV2_THRESHOLD ? 'Errática' : 'Suave');
    return { forecast, adi, cv2, pattern, demands, meanSize, sigmaSize };
}

// --- Safety stock (#4) ---
// Demanda suave/errática (ADI < 1.32) → modelo normal: SS = z × σ combinada
// (variabilidad de demanda + de lead time).
// Demanda intermitente/lumpy → Poisson compuesto: durante el lead time ocurren N
// pedidos (N ~ Poisson, E[N] = LT_meses / ADI) de tamaño X. La varianza de la demanda
// total es E[N]·(σ_X² + μ_X²). Esto protege contra el PICO real de un pedido esporádico
// en vez de promediarlo con los meses en cero, que es lo que distorsiona el σ mensual.
function safetyStockFor(
    z: number,
    combinedSigma: number,
    opts: { isIntermittent: boolean; adi: number; meanSize: number; sigmaSize: number; leadTimeMonths: number },
): number {
    const { isIntermittent, adi, meanSize, sigmaSize, leadTimeMonths } = opts;
    if (isIntermittent && adi > 0 && meanSize > 0 && leadTimeMonths > 0) {
        const expectedOccurrences = leadTimeMonths / adi;
        if (expectedOccurrences > 0) {
            const variance = expectedOccurrences * (sigmaSize * sigmaSize + meanSize * meanSize);
            return z * Math.sqrt(variance);
        }
    }
    return z * combinedSigma;
}

// --- Cantidad óptima (#6) ---
// Q = EOQ (Wilson) acotado a un rango sano de meses de demanda: el EOQ puro puede
// pedir años de stock en ítems baratos o lotes ridículos en los caros. Sin costo o
// sin demanda el EOQ es 0 → se cae a la heurística de meses de siempre.
function optimalQuantityFor(
    annualSales: number,
    monthlyAverage: number,
    unitCost: number,
    orderCost: number,
    holdingRate: number,
    maxMonths: number,
): number {
    const maxQ = monthlyAverage * maxMonths;
    if (maxQ <= 0) return 0;
    const eoq = computeEoq(annualSales, unitCost, orderCost, holdingRate);
    if (eoq <= 0) return maxQ; // sin datos para EOQ → heurística de meses
    return Math.min(Math.max(eoq, monthlyAverage * Q_MIN_MONTHS), maxQ);
}
const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const calculateStdDev = (values: number[], limit?: number): number => {
    const relevantValues = limit ? values.slice(0, limit) : values;
    const n = relevantValues.length;
    if (n === 0) return 0;
    const mean = relevantValues.reduce((a, b) => a + b, 0) / n;
    const variance = relevantValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    return Math.sqrt(variance);
};

// Helper to get value from object using multiple possible keys
const getValueByKeys = (obj: any, keys: string[]): any => {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const key of keys) {
        if (obj[key] !== undefined) return obj[key];
        const foundKey = Object.keys(obj).find(k => k.toLowerCase().trim() === key.toLowerCase().trim());
        if (foundKey) return obj[foundKey];
    }
    return undefined;
};

// Ingredientes por ítem para la pasada final. El SS/PdP dependen del nivel de
// servicio, que sale de la clase ABC — y el ABC es un ranking global (Pareto) que
// solo se conoce tras recorrer TODOS los ítems. Por eso la 1ª pasada calcula la
// demanda y el stock, y el PdP se resuelve al final.
type ItemCtx = {
    selectedMonthlyAverage: number;
    selectedAnnualSales: number;
    combinedSigma: number;
    leadTimeTotalMonths: number;
    effectiveLeadTimeDays: number;
    leadTimeDays: number;
    maxMonthlyDemand: number;
    isIntermittent: boolean;
    adi: number;
    meanSize: number;
    sigmaSize: number;
    unitPrice: number;
    unitCost: number;
    isInactive: boolean;
    position: number;
    physicalAvailable: number;
    incoming: number;
    physicalOnHand: number;
    reportedLevel: number | null; // null = el ERP no tiene nivel; -1 = "bajo demanda"
};

export const processInventoryData = (
    sales2026: RawSalesData[],
    sales2025: RawSalesData[],
    sales2024: RawSalesData[],
    sales2023: RawSalesData[],
    inventoryData: RawInventoryData[],
    leadTimeData: RawLeadTimeData[],
    eoqOrderCost: number = EOQ_DEFAULT_ORDER_COST,
    eoqHoldingRate: number = EOQ_DEFAULT_HOLDING_RATE,
): AnalysisResult[] => {
    // Keys Mapping
    const SKU_KEYS = ['sku', 'SKU (Código de artículo)', 'Código', 'Código de Producto'];
    const ITEM_NAME_KEYS = ['item_name', 'Nombre del artículo', 'Artículo', 'Nombre de Producto'];
    const REPOSITION_KEYS = ['Nivel de reposición', 'Nivel actual', 'Stock'];
    const LEAD_TIME_KEYS = ['Lead Time', 'Lead Time (días)', 'LT'];
    const LEAD_TIME_STD_KEYS = ['Lead Time Desv', 'Lead Time Std', 'LT Desv'];
    const LEAD_TIME_SOURCE_KEYS = ['Lead Time Fuente', 'LT Fuente'];
    const LEAD_TIME_N_KEYS = ['Lead Time N', 'LT N'];
    const CATEGORY_KEYS = ['Nombre de categoría', 'category_name', 'Categoría', 'Categoria', 'Grupo'];
    const PRICE_KEYS = ['average_price', 'Precio', 'Unit Price', 'Precio Unitario'];
    const ORDERED_KEYS = ['Cantidad pedida', 'Ordered', 'Pedidos'];
    const HAND_KEYS = ['Existencias a mano', 'On Hand', 'Existencias'];
    const PHYSICAL_KEYS = ['Existencias físicas', 'Existencias fisicas', 'Physical Stock', 'Física'];
    const COMMITTED_KEYS = ['Existencias comprometidas', 'Committed', 'Comprometido'];
    const AVAILABLE_KEYS = ['Disponible para la venta', 'Available', 'Disponible'];
    const MANUFACTURER_KEYS = ['Fabricante', 'Manufacturer'];
    const VENDOR_KEYS = ['Proveedor', 'Provider', 'Vendor'];
    const COST_KEYS = ['Costo', 'purchase_rate', 'Precio de Compra por unidad', 'Cost'];
    const SALE_PRICE_KEYS = ['Precio de venta', 'Precio de Venta por unidad', 'rate', 'Sale Price'];
    const ORDER_DATE_KEYS = ['Fecha OC próxima', 'Fecha OC proxima', 'Fecha OC', 'PO Date'];
    const STATUS_KEYS = ['Estado del artículo', 'Estado', 'status', 'Status'];
    const TRACK_KEYS = ['Seguimiento inventario', 'track_inventory'];

    // Create collections and maps
    const allSkus = new Set<string>();
    const namesMap = new Map<string, string>();
    const categoryMap = new Map<string, string>();
    const priceMap = new Map<string, number>();

    const inventoryMap = new Map<string, any>();
    const leadTimeMap = new Map<string, { days: number; std: number; source: string; n: number }>();
    const salesMap2026 = new Map<string, any>();
    const salesMap2025 = new Map<string, any>();
    const salesMap2024 = new Map<string, any>();
    const salesMap2023 = new Map<string, any>();

    const processSource = (data: any[], targetMap?: Map<string, any>, isInventory = false, isLeadTime = false) => {
        data.forEach(item => {
            const rawSku = getValueByKeys(item, SKU_KEYS);
            if (rawSku === undefined) return;
            const sku = String(rawSku).trim();
            if (!sku) return;

            allSkus.add(sku);

            const name = getValueByKeys(item, ITEM_NAME_KEYS);
            if (name && (!namesMap.has(sku) || namesMap.get(sku) === 'Unknown')) {
                namesMap.set(sku, String(name));
            }

            const category = getValueByKeys(item, CATEGORY_KEYS);
            if (category && !categoryMap.has(sku)) {
                categoryMap.set(sku, String(category));
            }

            const price = getValueByKeys(item, PRICE_KEYS);
            if (price !== undefined && !priceMap.has(sku)) {
                priceMap.set(sku, Number(price));
            }

            if (targetMap) {
                if (isInventory) {
                    // El nivel se preserva con sus tres estados (null / -1 / n). Cuidado:
                    // un `|| 0` aquí convertiría el "no configurado" en un nivel 0 real,
                    // que es un valor legítimo y distinto.
                    const rawLevel = getValueByKeys(item, REPOSITION_KEYS);
                    targetMap.set(sku, {
                        level: rawLevel === undefined || rawLevel === null || rawLevel === ''
                            ? null
                            : Number(rawLevel),
                        ordered: Number(getValueByKeys(item, ORDERED_KEYS) || 0),
                        hand: Number(getValueByKeys(item, HAND_KEYS) || 0),
                        physicalHand: Number(getValueByKeys(item, PHYSICAL_KEYS) || 0),
                        committed: Number(getValueByKeys(item, COMMITTED_KEYS) || 0),
                        available: Number(getValueByKeys(item, AVAILABLE_KEYS) || 0),
                        manufacturer: String(getValueByKeys(item, MANUFACTURER_KEYS) || 'Sin Fabricante').trim(),
                        vendor: String(getValueByKeys(item, VENDOR_KEYS) || getValueByKeys(item, MANUFACTURER_KEYS) || 'Sin proveedor').trim(),
                        cost: Number(getValueByKeys(item, COST_KEYS) || 0),
                        salePrice: Number(getValueByKeys(item, SALE_PRICE_KEYS) || 0),
                        orderDate: String(getValueByKeys(item, ORDER_DATE_KEYS) || '').slice(0, 10),
                        itemStatus: String(getValueByKeys(item, STATUS_KEYS) || 'active').toLowerCase().trim(),
                        tracksInventory: String(getValueByKeys(item, TRACK_KEYS) || 'false').toLowerCase().trim() === 'true'
                    });
                } else if (isLeadTime) {
                    targetMap.set(sku, {
                        days: Number(getValueByKeys(item, LEAD_TIME_KEYS) || 0),
                        std: Number(getValueByKeys(item, LEAD_TIME_STD_KEYS) || 0),
                        source: String(getValueByKeys(item, LEAD_TIME_SOURCE_KEYS) || 'Manual').trim(),
                        n: Number(getValueByKeys(item, LEAD_TIME_N_KEYS) || 0),
                    });
                } else {
                    // Consolidate sales data if it already exists for this SKU
                    const existing = targetMap.get(sku) || {};
                    const consolidated = { ...existing, ...item };
                    // For monthly columns, sum them if both exist
                    months.forEach(m => {
                        const val1 = Number(existing[m] || 0);
                        const val2 = Number(item[m] || 0);
                        if (val1 || val2) consolidated[m] = val1 + val2;
                    });
                    targetMap.set(sku, consolidated);
                }
            }
        });
    };

    processSource(leadTimeData, leadTimeMap, false, true);
    processSource(inventoryData, inventoryMap, true);
    processSource(sales2026, salesMap2026);
    processSource(sales2025, salesMap2025);
    processSource(sales2024, salesMap2024);
    processSource(sales2023, salesMap2023);

    const results: AnalysisResult[] = [];
    const contexts: ItemCtx[] = []; // paralelo a results (mismo índice)

    // Referencia temporal para "meses sin venta" (dead stock). El historial cubre
    // 2023-2026 en índices año*12 + mes (mes 0-11).
    const now = new Date();
    const nowMonthIdx = now.getFullYear() * 12 + now.getMonth();

    allSkus.forEach(sku => {
        const item2026 = salesMap2026.get(sku) || {};
        const item2025 = salesMap2025.get(sku) || {};
        const item2024 = salesMap2024.get(sku) || {};
        const item2023 = salesMap2023.get(sku) || {};

        const inventoryInfo = inventoryMap.get(sku) || {
            level: null,
            ordered: 0,
            hand: 0,
            physicalHand: 0,
            committed: 0,
            available: 0,
            manufacturer: 'Sin Fabricante',
            vendor: 'Sin proveedor',
            cost: 0,
            salePrice: 0,
            orderDate: '',
            itemStatus: 'active',
            tracksInventory: false
        };
        const actualCurrentLevel = inventoryInfo.level;
        const itemStatus = String(inventoryInfo.itemStatus || 'active').toLowerCase();
        const isInactive = itemStatus === 'inactive';

        const getStats = (item: any, isPartial = false) => {
            const values = months.map(m => Number(item[m] || 0));
            const total = values.reduce((a, b) => a + b, 0);

            // For partial years (like current 2026), we only calculate stdDev 
            // on months with actual data to avoid zero-skewing
            let activeMonths = 0;
            if (isPartial) {
                // Find last month with data
                for (let i = values.length - 1; i >= 0; i--) {
                    if (values[i] > 0) {
                        activeMonths = i + 1;
                        break;
                    }
                }
            }

            // Mes (0-11) de la PRIMERA venta del año; -1 si no vendió nunca. Se usa
            // para no penalizar a los artículos nuevos al anualizar (#2).
            const firstSaleMonth = values.findIndex(v => v > 0);

            return {
                values,
                total,
                avg: total / 12,
                stdDev: isPartial && activeMonths > 0
                    ? calculateStdDev(values, activeMonths)
                    : calculateStdDev(values),
                activeMonths,
                firstSaleMonth
            };
        };

        const stats2026 = getStats(item2026, true);
        const stats2025 = getStats(item2025);
        const stats2024 = getStats(item2024);
        const stats2023 = getStats(item2023);

        const activeMonths2026 = stats2026.activeMonths;
        const has2026Data = stats2026.total > 0;

        const leadInfo = leadTimeMap.get(sku) || { days: 0, std: 0, source: 'Manual', n: 0 };
        const leadTimeDays = leadInfo.days;
        const leadTimeStdDays = leadInfo.std;
        const isComputedLeadTime = leadInfo.source === 'Calculado';

        // Lead Time Logic Adjustment:
        // 1. If LT is 0, it's a service (no buffer).
        // 2. If the LT was computed from real receptions (source "Calculado"), it
        //    already reflects real delays -> no admin buffer.
        // 3. If LT is exactly 5, 10, 15, or 20 (manual convention), do NOT add the buffer.
        // 4. Otherwise (manual theoretical LT), add the 30-day buffer (ADMIN_DELAY_DAYS).
        const noBufferValues = [5, 10, 15, 20];
        const effectiveLeadTimeDays = isComputedLeadTime
            ? leadTimeDays
            : (noBufferValues.includes(leadTimeDays)
                ? leadTimeDays
                : (leadTimeDays > 0 ? leadTimeDays + ADMIN_DELAY_DAYS : 0));

        const leadTimeTotalMonths = effectiveLeadTimeDays / 30;
        // Lead-time variability in months (only meaningful when computed; 0 for manual).
        const leadTimeStdMonths = isComputedLeadTime ? (leadTimeStdDays / 30) : 0;

        // ETA de lo pedido = fecha de la OC abierta más próxima + lead time efectivo.
        // Solo si hay algo por recibir y una fecha de OC válida.
        let etaDate = '';
        let etaDays = 0;
        if (inventoryInfo.orderDate && inventoryInfo.ordered > 0 && effectiveLeadTimeDays > 0) {
            const od = new Date(inventoryInfo.orderDate);
            if (!isNaN(od.getTime())) {
                const eta = new Date(od.getTime() + effectiveLeadTimeDays * 86400000);
                etaDate = eta.toISOString().slice(0, 10);
                etaDays = Math.round((eta.getTime() - now.getTime()) / 86400000);
            }
        }

        // "Con seguimiento" (Análisis Principal) = el artículo hace seguimiento de
        // inventario en Zoho (track_inventory = true), independiente del reorder_level
        // y del lead time (que son temas aparte). "Sin seguimiento" = artículos que
        // NO son de inventario (servicios, sales/purchases sin stock).
        const isService = !inventoryInfo.tracksInventory;

        // Serie mensual cronológica 2023 → mes actual (se trunca el futuro del año en curso).
        const monthlySeries: number[] = [
            ...stats2023.values, ...stats2024.values, ...stats2025.values,
        ];
        const curYear = now.getFullYear();
        const upto2026 = curYear > 2026 ? 12 : curYear === 2026 ? now.getMonth() + 1 : 0;
        monthlySeries.push(...stats2026.values.slice(0, upto2026));
        const croston = crostonSBA(monthlySeries);
        const demandPattern = croston.pattern;
        const isIntermittent = croston.adi >= ADI_THRESHOLD; // Intermitente o Lumpy

        // Denominador para anualizar 2026: meses TRANSCURRIDOS desde la primera venta
        // hasta el mes en curso, NO los meses "activos" (los que van hasta la última
        // venta). Dividir por los activos descarta los ceros recientes e infla la tasa
        // — era la causa principal del PdP excesivo. Arrancar en la primera venta evita
        // castigar a los artículos nuevos, que todavía no tienen año completo.
        const runRateMonths2026 = stats2026.firstSaleMonth >= 0
            ? Math.max(1, upto2026 - stats2026.firstSaleMonth)
            : Math.max(1, upto2026);

        // Abnormal Demand Logic (Policy v2.0)
        let demandSource: AnalysisResult['demandSource'] = 'Ventas 2025';
        let selectedMonthlyAverage = stats2025.avg;

        if (has2026Data && activeMonths2026 >= MIN_MONTHS_FOR_TREND) {
            const avgPrevFor2026 = (stats2025.total + stats2024.total) / 2;
            const annualProjected2026 = (stats2026.total / runRateMonths2026) * 12;
            const isAbnormal2026 = annualProjected2026 < (0.8 * avgPrevFor2026) && avgPrevFor2026 > 0;

            if (isAbnormal2026) {
                demandSource = 'Promedio Trienal';
                // 2026 va parcial (upto2026 meses) + 2025 y 2024 completos.
                selectedMonthlyAverage = (stats2026.total + stats2025.total + stats2024.total) / (24 + upto2026);
            } else {
                demandSource = 'Ventas 2026';
                selectedMonthlyAverage = stats2026.total / runRateMonths2026;
            }
        } else {
            // If we don't have enough 2026 data, or no 2026 data at all, base on 2025
            const avgPrev = (stats2024.total + stats2023.total) / 2;
            const isAbnormal = stats2025.total < (0.8 * avgPrev) && avgPrev > 0;

            if (isAbnormal) {
                demandSource = 'Promedio Trienal';
                // Include 2026 in the trienal average if it has data, even if below trend threshold
                const totalSales = stats2025.total + stats2024.total + stats2023.total + (has2026Data ? stats2026.total : 0);
                const totalMonths = 36 + (has2026Data ? upto2026 : 0);
                selectedMonthlyAverage = totalSales / totalMonths;
            } else {
                demandSource = 'Ventas 2025';
                selectedMonthlyAverage = stats2025.avg;
            }
        }

        // Demanda intermitente/lumpy (ADI ≥ 1.32) → el promedio simple se sesga con
        // los ceros; uso el pronóstico Croston (SBA) como tasa mensual de demanda.
        if (isIntermittent && croston.forecast > 0) {
            selectedMonthlyAverage = croston.forecast;
            demandSource = 'Croston (SBA)';
        }

        const selectedAnnualSales = selectedMonthlyAverage * 12;

        // Weighted Sigma
        let weightedSigma = 0;
        if (has2026Data) {
            weightedSigma = (0.5 * stats2026.stdDev) + (0.3 * stats2025.stdDev) + (0.2 * stats2024.stdDev);
        } else {
            weightedSigma = (0.5 * stats2025.stdDev) + (0.3 * stats2024.stdDev) + (0.2 * stats2023.stdDev);
        }

        // XYZ (variabilidad): coeficiente de variación = σ / media mensual.
        // X estable (CV ≤ 0.5) · Y variable (≤ 1.0) · Z errática (> 1.0).
        // Sin demanda → Z (impredecible). abcClass se asigna en la 2ª pasada global.
        const coefVariation = selectedMonthlyAverage > 0 ? (weightedSigma / selectedMonthlyAverage) : 0;
        const xyzClass: 'X' | 'Y' | 'Z' =
            selectedMonthlyAverage <= 0 ? 'Z'
                : coefVariation > 1.0 ? 'Z'
                    : coefVariation > 0.5 ? 'Y'
                        : 'X';
        // Valor de consumo anual por COSTO = uds anuales × costo de compra.
        const unitCost = inventoryInfo.cost || 0;
        const annualValue = selectedAnnualSales * unitCost;

        // Combined demand + lead-time variability (safety stock).
        // SS = Z × √( LT·σ²_demanda + demanda²·σ²_LT )
        // The 2nd term is 0 when the LT is manual (σ_LT = 0), so this reduces to the
        // classic Z × σ_demanda × √LT and stays backward-compatible.
        const combinedSigma = Math.sqrt(
            (leadTimeTotalMonths * weightedSigma * weightedSigma)
            + (selectedMonthlyAverage * selectedMonthlyAverage * leadTimeStdMonths * leadTimeStdMonths)
        );

        // Financial Overrides Logic
        // Precio de venta: el configurado en el ítem de Zoho (ERP); si no está
        // configurado, se usa como respaldo el promedio realmente facturado.
        const unitPrice = inventoryInfo.salePrice > 0 ? inventoryInfo.salePrice : (priceMap.get(sku) || 0);

        // Peor mes histórico: base del tope de cordura del PdP (#5), que se aplica en
        // la pasada final junto con el SS/PdP.
        const maxMonthlyDemand = monthlySeries.length ? Math.max(...monthlySeries) : 0;

        // Variability Calculation Logic
        const maxHistoricalStdDev = Math.max(stats2024.stdDev, stats2023.stdDev);
        const variabilityRatio = stats2025.stdDev > 0
            ? maxHistoricalStdDev / stats2025.stdDev
            : (maxHistoricalStdDev > 0 ? 2.5 : 0);

        let variabilityClass: 'Alta' | 'Media' | 'Baja' = 'Baja';
        if (variabilityRatio >= 2.0) variabilityClass = 'Alta';
        else if (variabilityRatio >= 1.2) variabilityClass = 'Media';

        const manualReview = variabilityClass !== 'Baja';

        const demandType: 'Normal' | 'Anormal' = demandSource === 'Promedio Trienal' ? 'Anormal' : 'Normal';

        let valueClass: 'Ultra Alto' | 'Alto' | 'Estándar' = 'Estándar';
        if (unitPrice > 10000) valueClass = 'Ultra Alto';
        else if (unitPrice >= 1500) valueClass = 'Alto';

        // Posición de inventario = Disponible contable (= físico − comprometido + por recibir):
        // lo que efectivamente tienes para cubrir demanda, contando lo que ya viene.
        const position = inventoryInfo.available;
        const physicalAvailable = inventoryInfo.physicalHand - inventoryInfo.committed;
        const incoming = inventoryInfo.ordered; // por recibir

        // --- Dead stock / capital inmovilizado ---
        // Meses desde la última venta (recorriendo 2023-2026); -1 = nunca vendido.
        let lastSaleIdx = -1;
        ([[2023, stats2023.values], [2024, stats2024.values], [2025, stats2025.values], [2026, stats2026.values]] as [number, number[]][])
            .forEach(([yr, vals]) => vals.forEach((v, m) => {
                if (v > 0) { const idx = yr * 12 + m; if (idx > lastSaleIdx) lastSaleIdx = idx; }
            }));
        const monthsSinceLastSale = lastSaleIdx >= 0 ? Math.max(0, nowMonthIdx - lastSaleIdx) : -1;

        const physicalOnHand = inventoryInfo.physicalHand;
        const inventoryValue = Math.max(0, physicalOnHand) * unitCost; // capital total en este ítem

        // Escalonado con existencia física: Lento ≥6m, Muerto ≥12m, Obsoleto ≥24m
        // o nunca vendido. El capital "dead" cuenta Muerto+Obsoleto (físico completo).
        let deadStockClass: 'Activo' | 'Lento' | 'Muerto' | 'Obsoleto' = 'Activo';
        if (physicalOnHand > 0) {
            if (monthsSinceLastSale === -1 || monthsSinceLastSale >= 24) deadStockClass = 'Obsoleto';
            else if (monthsSinceLastSale >= 12) deadStockClass = 'Muerto';
            else if (monthsSinceLastSale >= 6) deadStockClass = 'Lento';
        }
        const deadStockValue = (deadStockClass === 'Muerto' || deadStockClass === 'Obsoleto') ? inventoryValue : 0;

        const itemName = namesMap.get(sku) || 'Unknown';
        const category = categoryMap.get(sku) || 'Sin Categoría';

        // Final level to report: keep actual level if it's not -1
        const reportedLevel = actualCurrentLevel;

        // Ingredientes para la pasada final (SS/PdP/Q/estatus), que necesita la clase ABC.
        contexts.push({
            selectedMonthlyAverage, selectedAnnualSales, combinedSigma, leadTimeTotalMonths,
            effectiveLeadTimeDays, leadTimeDays, maxMonthlyDemand,
            isIntermittent, adi: croston.adi, meanSize: croston.meanSize, sigmaSize: croston.sigmaSize,
            unitPrice, unitCost, isInactive, position, physicalAvailable, incoming,
            physicalOnHand, reportedLevel,
        });

        results.push({
            sku,
            itemName,
            category,
            currentLevel: reportedLevel,
            leadTimeDays,
            leadTimeMonths: leadTimeTotalMonths,
            leadTimeStdDays,
            leadTimeSource: leadInfo.source,
            // SS/PdP/Q y todo lo que cuelga de ellos (estatus, cobertura, sobrestock,
            // desviación) se rellenan en la pasada final: dependen del nivel de servicio,
            // que sale de la clase ABC y esa es un ranking global.
            safetyStock: 0,
            reorderPoint: 0,
            optimalQuantity: 0,
            deviation: 0,
            status: 'Optimized',
            levelStatus: 'OK',
            itemStatus,
            coverageDays: -1,
            coverageRisk: false,
            orderDate: inventoryInfo.orderDate,
            etaDate,
            etaDays,
            unitCost,
            annualValue,
            annualValueRevenue: selectedAnnualSales * unitPrice, // valor anual por precio de venta
            coefVariation,
            xyzClass,
            abcClass: 'C',          // ABC por costo — se asigna en la 2ª pasada (Pareto)
            abcXyz: '',             // idem
            abcClassRevenue: 'C',   // ABC por venta — 2ª pasada
            abcXyzRevenue: '',      // idem
            demandPattern,
            adi: croston.adi,
            cv2: croston.cv2,
            crostonForecast: croston.forecast,
            monthsSinceLastSale,
            deadStockClass,
            deadStockValue,
            overstockUnits: 0,   // depende del techo PdP+Q → pasada final
            overstockValue: 0,   // idem
            inventoryValue,
            monthlyAverage: selectedMonthlyAverage,
            annualSales: selectedAnnualSales,
            stdDev: weightedSigma,
            demandSource,
            manualReview,
            variabilityRatio,
            isService,
            unitPrice,
            sales2026: stats2026.total,
            orderedQuantity: inventoryInfo.ordered,
            handQuantity: inventoryInfo.hand,
            physicalHandQuantity: inventoryInfo.physicalHand,
            committedQuantity: inventoryInfo.committed,
            availableQuantity: inventoryInfo.available,
            manufacturer: inventoryInfo.manufacturer,
            vendor: inventoryInfo.vendor,
            erpLevel: inventoryInfo.level,
            variabilityClass,
            demandType,
            valueClass,
            history: {
                '2026': stats2026.values,
                '2025': stats2025.values,
                '2024': stats2024.values,
                '2023': stats2023.values
            }
        });
    });

    // 2ª pasada — ABC por valor de consumo anual, Pareto acumulado global:
    // A = hasta el 80% del valor, B = 80-95%, C = resto (incluye los de valor 0).
    // Se calcula por COSTO y, en paralelo, por PRECIO DE VENTA (2 matrices).
    const classifyABC = (
        valueOf: (r: AnalysisResult) => number,
        assign: (r: AnalysisResult, cls: 'A' | 'B' | 'C') => void,
    ) => {
        const ranked = [...results].sort((a, b) => valueOf(b) - valueOf(a));
        const total = ranked.reduce((sum, r) => sum + valueOf(r), 0);
        let cumulative = 0;
        ranked.forEach(r => {
            if (total <= 0 || valueOf(r) <= 0) {
                assign(r, 'C');
            } else {
                // Se clasifica por el acumulado ANTES del ítem: un ítem es A mientras lo
                // ya acumulado no haya cubierto el 80%. Con el acumulado DESPUÉS, un ítem
                // que por sí solo vale el 99% caería en C — y ahora el ABC fija el nivel
                // de servicio, así que esa mala clasificación sí duele.
                const pctBefore = cumulative / total;
                cumulative += valueOf(r);
                assign(r, pctBefore < 0.8 ? 'A' : pctBefore < 0.95 ? 'B' : 'C');
            }
        });
    };

    classifyABC(r => r.annualValue, (r, cls) => { r.abcClass = cls; r.abcXyz = `${cls}${r.xyzClass}`; });
    classifyABC(r => r.annualValueRevenue, (r, cls) => { r.abcClassRevenue = cls; r.abcXyzRevenue = `${cls}${r.xyzClass}`; });

    // 3ª pasada — SS / PdP / Q y todo lo que depende de ellos. Va aquí porque el nivel
    // de servicio se lee de la matriz ABC-XYZ, que necesita el Pareto ya resuelto.
    results.forEach((r, i) => {
        const c = contexts[i];

        let ss = 0;
        let pdp = 0;
        let q = 0;

        // Sin ventas en más de 12 meses (o nunca vendido) → no se stockea, sea cual sea
        // el pronóstico. La señal de demanda está muerta y no hay modelo que la resucite.
        const isObsolete = r.monthsSinceLastSale === -1 || r.monthsSinceLastSale > OBSOLETE_MONTHS;

        if (c.leadTimeDays === 0) {
            // Servicios: no se analiza stock.
        } else if (isObsolete) {
            // Demanda muerta: PdP y Q se quedan en 0 → "No stockear".
        } else if (c.unitPrice > ULTRA_VALUE_PRICE) {
            // Ultra-alto valor: se pide contra pedido, uno a uno.
            pdp = 1;
            q = 1;
        } else {
            // Nivel de servicio por criticidad (ABC) × predictibilidad (XYZ). En los de
            // alto valor se aplica un techo: no se sobre-stockea lo caro aunque sea clase A.
            const matrixZ = SERVICE_Z[r.abcXyz] ?? DEFAULT_SERVICE_Z;
            const z = c.unitPrice >= HIGH_VALUE_PRICE ? Math.min(matrixZ, HIGH_VALUE_Z_CAP) : matrixZ;

            ss = safetyStockFor(z, c.combinedSigma, {
                isIntermittent: c.isIntermittent,
                adi: c.adi,
                meanSize: c.meanSize,
                sigmaSize: c.sigmaSize,
                leadTimeMonths: c.leadTimeTotalMonths,
            });
            pdp = (c.selectedMonthlyAverage * c.leadTimeTotalMonths) + ss;

            // Tope de cordura: aunque el σ dispare el SS, no tiene sentido cubrir más de
            // lo que consumiría el PEOR mes histórico durante el lead time + 2 meses.
            if (c.maxMonthlyDemand > 0) {
                const cap = c.maxMonthlyDemand * (c.leadTimeTotalMonths + PDP_CAP_EXTRA_MONTHS);
                if (pdp > cap) {
                    pdp = cap;
                    ss = Math.max(0, pdp - c.selectedMonthlyAverage * c.leadTimeTotalMonths);
                }
            }

            q = optimalQuantityFor(
                c.selectedAnnualSales, c.selectedMonthlyAverage, c.unitCost,
                eoqOrderCost, eoqHoldingRate,
                c.unitPrice >= HIGH_VALUE_PRICE ? Q_MAX_MONTHS_HIGH_VALUE : Q_MAX_MONTHS_STANDARD,
            );
        }

        const roundedPdp = Math.round(pdp);
        // ¿Amerita stock? Un PdP que no llega a 1 unidad significa "no stockear": no se
        // puede tener media unidad en la estantería. Se mira el PdP CRUDO, no el
        // redondeado — Math.round(0.75) da 1 y convertiría un "no amerita stock" en un
        // "sube el nivel a 1" para artículos que venden 2 uds en 4 años.
        const worthStocking = pdp >= 1;

        // Cobertura / días de inventario: cuántos días aguanta el stock físico disponible
        // a la demanda actual. Riesgo (rojo) si la cobertura es menor que el lead time
        // efectivo → nos quedaríamos sin stock antes de que llegue una reposición pedida hoy.
        const dailyDemand = c.selectedMonthlyAverage / 30;
        const coverageApplicable = dailyDemand > 0 && c.leadTimeDays > 0 && worthStocking;
        const coverageDays = coverageApplicable
            ? Math.max(0, Math.round(c.physicalAvailable / dailyDemand))
            : -1; // -1 = N/A (servicio o sin demanda)
        const coverageRisk = coverageApplicable
            && (c.physicalAvailable / dailyDemand) < c.effectiveLeadTimeDays;

        // Sobrestock: exceso sobre el techo sano (PdP + Q óptima) SOLO en ítems que
        // rotan (Activo/Lento); los muertos ya cuentan como dead capital (sin doble conteo).
        const stockCeiling = Math.max(1, Math.round(pdp + q));
        const overstockUnits = (r.deadStockClass === 'Activo' || r.deadStockClass === 'Lento')
            ? Math.max(0, Math.round(c.physicalOnHand) - stockCeiling)
            : 0;

        let status: AnalysisResult['status'] = 'Optimized';
        if (c.isInactive || c.leadTimeDays === 0 || !worthStocking) {
            // Artículo inactivo (dado de baja/sustituido en Zoho), servicio, o sin
            // demanda relevante → no se analiza stock ni se sugiere reposición.
            status = 'Ignored';
        } else if (c.physicalAvailable <= 0 && c.incoming <= 0) {
            // Físicamente en cero (o comprometido más de lo que hay) y nada en camino → pedir YA.
            status = 'Urgente';
        } else if (c.position < roundedPdp && c.incoming > 0) {
            // Falta stock pero ya hay una orden en tránsito → reposición en camino.
            status = 'EnCamino';
        } else if (c.position < roundedPdp) {
            // Bajo el punto de pedido, sin urgencia física ni tránsito → colocar orden.
            status = 'Pedir';
        } else if (c.position > (roundedPdp * 1.2)) {
            status = 'Overstock';
        }

        // Recomendación de ajuste del nivel de reposición del ERP vs el PdP calculado
        // (pestaña Análisis Principal). Es SOLO la recomendación: el estado del ERP se
        // reporta aparte en currentLevel (null = sin configurar, -1 = bajo demanda).
        // Antes esto mezclaba ambas cosas y mentía en dos casos: llamaba "sin configurar"
        // a los -1 (que son una decisión tomada) y "sin datos" a un PdP < 1 (que no es
        // falta de datos, es la conclusión del análisis).
        let levelStatus: AnalysisResult['levelStatus'];
        if (c.leadTimeDays === 0) {
            levelStatus = 'SinDatos';       // sin lead time no hay nada que calcular
        } else if (!worthStocking) {
            levelStatus = 'NoStockear';     // calculado: la demanda no justifica stock
        } else if (c.reportedLevel === null) {
            levelStatus = 'SinConfigurar';  // hay PdP, pero el ERP no tiene nivel
        } else if (c.reportedLevel < roundedPdp) {
            // Aquí caen los -1 ("bajo demanda") cuyo PdP ya justifica stock: el análisis
            // reta la política y propone subirlos.
            levelStatus = 'Subir';
        } else if (c.reportedLevel > roundedPdp * 1.2) {
            levelStatus = 'Bajar';
        } else {
            levelStatus = 'OK';
        }

        r.safetyStock = ss;
        r.reorderPoint = pdp;
        r.optimalQuantity = q;
        r.deviation = c.reportedLevel !== null ? c.reportedLevel - pdp : 0;
        r.status = status;
        r.levelStatus = levelStatus;
        r.coverageDays = coverageDays;
        r.coverageRisk = coverageRisk;
        r.overstockUnits = overstockUnits;
        r.overstockValue = overstockUnits * c.unitCost;
    });

    return results;
};
