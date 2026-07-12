import type { RawInventoryData, RawSalesData, AnalysisResult, RawLeadTimeData } from '../types';
import * as XLSX from 'xlsx';

// Constants
const ADMIN_DELAY_DAYS = 30;
const SERVICE_LEVEL_Z = 1.645; // 95%
const MIN_MONTHS_FOR_TREND = 3;
const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export const parseExcel = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to array of arrays first to find the header row
                const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

                if (!rawRows || rawRows.length === 0) {
                    resolve([]);
                    return;
                }

                // Find header row: Look for a row containing 'SKU' or 'Artículo'
                let headerRowIndex = 0;
                const targetKeys = ['sku', 'articulo', 'artículo', 'código', 'codigo', 'item'];
                for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
                    const row = rawRows[i];
                    if (row && Array.isArray(row) && row.some(cell => {
                        if (cell === null || cell === undefined) return false;
                        const s = String(cell).toLowerCase();
                        return targetKeys.some(key => s.includes(key));
                    })) {
                        headerRowIndex = i;
                        break;
                    }
                }

                const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex });
                resolve(jsonData);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

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

export const processInventoryData = (
    sales2026: RawSalesData[],
    sales2025: RawSalesData[],
    sales2024: RawSalesData[],
    sales2023: RawSalesData[],
    inventoryData: RawInventoryData[],
    leadTimeData: RawLeadTimeData[]
): AnalysisResult[] => {
    // Keys Mapping
    const SKU_KEYS = ['sku', 'SKU (Código de artículo)', 'Código', 'Código de Producto'];
    const ITEM_NAME_KEYS = ['item_name', 'Nombre del artículo', 'Artículo', 'Nombre de Producto'];
    const REPOSITION_KEYS = ['Nivel de reposición', 'Nivel actual', 'Stock'];
    const LEAD_TIME_KEYS = ['Lead Time', 'Lead Time (días)', 'LT'];
    const CATEGORY_KEYS = ['Nombre de categoría', 'category_name', 'Categoría', 'Categoria', 'Grupo'];
    const PRICE_KEYS = ['average_price', 'Precio', 'Unit Price', 'Precio Unitario'];
    const ORDERED_KEYS = ['Cantidad pedida', 'Ordered', 'Pedidos'];
    const HAND_KEYS = ['Existencias a mano', 'On Hand', 'Existencias'];
    const PHYSICAL_KEYS = ['Existencias físicas', 'Existencias fisicas', 'Physical Stock', 'Física'];
    const COMMITTED_KEYS = ['Existencias comprometidas', 'Committed', 'Comprometido'];
    const AVAILABLE_KEYS = ['Disponible para la venta', 'Available', 'Disponible'];
    const MANUFACTURER_KEYS = ['Fabricante', 'Manufacturer', 'Proveedor', 'Provider'];

    // Create collections and maps
    const allSkus = new Set<string>();
    const namesMap = new Map<string, string>();
    const categoryMap = new Map<string, string>();
    const priceMap = new Map<string, number>();

    const inventoryMap = new Map<string, any>();
    const leadTimeMap = new Map<string, number>();
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
                    targetMap.set(sku, {
                        level: Number(getValueByKeys(item, REPOSITION_KEYS) || 0),
                        ordered: Number(getValueByKeys(item, ORDERED_KEYS) || 0),
                        hand: Number(getValueByKeys(item, HAND_KEYS) || 0),
                        physicalHand: Number(getValueByKeys(item, PHYSICAL_KEYS) || 0),
                        committed: Number(getValueByKeys(item, COMMITTED_KEYS) || 0),
                        available: Number(getValueByKeys(item, AVAILABLE_KEYS) || 0),
                        manufacturer: String(getValueByKeys(item, MANUFACTURER_KEYS) || 'Sin Fabricante').trim()
                    });
                } else if (isLeadTime) {
                    targetMap.set(sku, Number(getValueByKeys(item, LEAD_TIME_KEYS) || 0));
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

    allSkus.forEach(sku => {
        const item2026 = salesMap2026.get(sku) || {};
        const item2025 = salesMap2025.get(sku) || {};
        const item2024 = salesMap2024.get(sku) || {};
        const item2023 = salesMap2023.get(sku) || {};

        const inventoryInfo = inventoryMap.get(sku) || {
            level: -1,
            ordered: 0,
            hand: 0,
            physicalHand: 0,
            committed: 0,
            available: 0,
            manufacturer: 'Sin Fabricante'
        };
        const actualCurrentLevel = inventoryInfo.level;

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

            return {
                values,
                total,
                avg: total / 12,
                stdDev: isPartial && activeMonths > 0
                    ? calculateStdDev(values, activeMonths)
                    : calculateStdDev(values),
                activeMonths
            };
        };

        const stats2026 = getStats(item2026, true);
        const stats2025 = getStats(item2025);
        const stats2024 = getStats(item2024);
        const stats2023 = getStats(item2023);

        const activeMonths2026 = stats2026.activeMonths;
        const has2026Data = stats2026.total > 0;

        const leadTimeDays = leadTimeMap.get(sku) || 0;

        // Lead Time Logic Adjustment:
        // 1. If LT is 0, it's a service (no buffer).
        // 2. If LT is exactly 5, 10, 15, or 20, do NOT add the 30-day buffer.
        // 3. Otherwise, add the 30-day buffer (ADMIN_DELAY_DAYS).
        const noBufferValues = [5, 10, 15, 20];
        const effectiveLeadTimeDays = noBufferValues.includes(leadTimeDays)
            ? leadTimeDays
            : (leadTimeDays > 0 ? leadTimeDays + ADMIN_DELAY_DAYS : 0);

        const leadTimeTotalMonths = effectiveLeadTimeDays / 30;

        // Is Service Check
        const isService = leadTimeDays === 0 || actualCurrentLevel === -1;

        // Abnormal Demand Logic (Policy v2.0)
        let demandSource: AnalysisResult['demandSource'] = 'Ventas 2025';
        let selectedMonthlyAverage = stats2025.avg;

        if (has2026Data && activeMonths2026 >= MIN_MONTHS_FOR_TREND) {
            const avgPrevFor2026 = (stats2025.total + stats2024.total) / 2;
            const annualProjected2026 = (stats2026.total / Math.max(1, activeMonths2026)) * 12;
            const isAbnormal2026 = annualProjected2026 < (0.8 * avgPrevFor2026) && avgPrevFor2026 > 0;

            if (isAbnormal2026) {
                demandSource = 'Promedio Trienal';
                selectedMonthlyAverage = (stats2026.total + stats2025.total + stats2024.total) / 36;
            } else {
                demandSource = 'Ventas 2026';
                selectedMonthlyAverage = stats2026.total / Math.max(1, activeMonths2026);
            }
        } else {
            // If we don't have enough 2026 data, or no 2026 data at all, base on 2025
            const avgPrev = (stats2024.total + stats2023.total) / 2;
            const isAbnormal = stats2025.total < (0.8 * avgPrev) && avgPrev > 0;

            if (isAbnormal) {
                demandSource = 'Promedio Trienal';
                // Include 2026 in the trienal average if it has data, even if below trend threshold
                const totalSales = stats2025.total + stats2024.total + stats2023.total + (has2026Data ? stats2026.total : 0);
                const totalMonths = 36 + (has2026Data ? activeMonths2026 : 0);
                selectedMonthlyAverage = totalSales / totalMonths;
            } else {
                demandSource = 'Ventas 2025';
                selectedMonthlyAverage = stats2025.avg;
            }
        }

        const selectedAnnualSales = selectedMonthlyAverage * 12;

        // Weighted Sigma
        let weightedSigma = 0;
        if (has2026Data) {
            weightedSigma = (0.5 * stats2026.stdDev) + (0.3 * stats2025.stdDev) + (0.2 * stats2024.stdDev);
        } else {
            weightedSigma = (0.5 * stats2025.stdDev) + (0.3 * stats2024.stdDev) + (0.2 * stats2023.stdDev);
        }

        // Financial Overrides Logic
        const unitPrice = priceMap.get(sku) || 0;
        let ss = 0;
        let pdp = 0;
        let q = 0;

        if (leadTimeDays === 0) {
            // Servicios: No analizar stock
            ss = 0;
            pdp = 0;
            q = 0;
        } else if (unitPrice > 10000) {
            // Ultra-Alto Valor: Precio > 10,000 USD
            pdp = 1;
            q = 1;
            ss = 0;
        } else if (unitPrice >= 1500) {
            // Alto Valor: Precio 1,500 - 10,000 USD
            const highValueZ = 1.28; // 80% confidence
            ss = highValueZ * weightedSigma * Math.sqrt(leadTimeTotalMonths);
            pdp = (selectedMonthlyAverage * leadTimeTotalMonths) + ss;
            q = selectedMonthlyAverage * 3; // 3 months demand
        } else {
            // Estándar: Precio < 1,500 USD
            ss = SERVICE_LEVEL_Z * weightedSigma * Math.sqrt(leadTimeTotalMonths);
            pdp = (selectedMonthlyAverage * leadTimeTotalMonths) + ss;
            q = selectedMonthlyAverage * 6; // 6 months demand (standard logic)
        }

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

        let status: 'Risk' | 'Overstock' | 'Optimized' | 'Ignored' = 'Optimized';
        const roundedPdp = Math.round(pdp);

        if (leadTimeDays === 0) {
            status = 'Ignored';
        } else if (actualCurrentLevel === -1) {
            status = roundedPdp >= 1 ? 'Risk' : 'Ignored';
        } else if (actualCurrentLevel < roundedPdp) {
            status = 'Risk';
        } else if (actualCurrentLevel > (roundedPdp * 1.2)) {
            status = 'Overstock';
        }

        const itemName = namesMap.get(sku) || 'Unknown';
        const category = categoryMap.get(sku) || 'Sin Categoría';

        // Final level to report: keep actual level if it's not -1
        const reportedLevel = actualCurrentLevel;

        const deviation = reportedLevel !== -1 ? reportedLevel - pdp : 0;

        results.push({
            sku,
            itemName,
            category,
            currentLevel: reportedLevel,
            leadTimeDays,
            leadTimeMonths: leadTimeTotalMonths,
            safetyStock: ss,
            reorderPoint: pdp,
            optimalQuantity: q,
            deviation,
            status,
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

    return results;
};
