export interface RawSalesData {
    sku: string | number;
    item_name: string;
    category_name?: string;
    Enero?: number;
    Febrero?: number;
    Marzo?: number;
    Abril?: number;
    Mayo?: number;
    Junio?: number;
    Julio?: number;
    Agosto?: number;
    Septiembre?: number;
    Octubre?: number;
    Noviembre?: number;
    Diciembre?: number;
    [key: string]: any;
}

export interface RawInventoryData {
    [key: string]: any; // Flexibly handled by keys in calculations
}

export interface RawLeadTimeData {
    [key: string]: any; // Flexibly handled by keys in calculations
}

export interface AnalysisResult {
    sku: string;
    itemName: string;
    currentLevel: number;
    leadTimeDays: number;
    leadTimeMonths: number;
    leadTimeStdDays: number;
    leadTimeSource: string;
    leadTimeN: number;
    safetyStock: number;
    reorderPoint: number;
    optimalQuantity: number;
    deviation: number;
    status: 'Urgente' | 'EnCamino' | 'Pedir' | 'Overstock' | 'Optimized' | 'Ignored';
    coverageDays: number;   // días de inventario (stock físico / demanda diaria); -1 = N/A
    coverageRisk: boolean;  // true si cobertura < lead time (riesgo de quiebre)
    monthlyAverage: number;
    annualSales: number;
    stdDev: number;
    demandSource: 'Ventas 2026' | 'Ventas 2025' | 'Promedio Trienal';
    manualReview: boolean;
    variabilityRatio: number;
    category: string;
    isService: boolean;
    unitPrice: number;
    sales2026?: number;
    orderedQuantity: number;
    handQuantity: number;
    physicalHandQuantity: number;
    committedQuantity: number;
    availableQuantity: number;
    manufacturer: string;
    erpLevel: number;
    variabilityClass: 'Alta' | 'Media' | 'Baja';
    demandType: 'Normal' | 'Anormal';
    valueClass: 'Ultra Alto' | 'Alto' | 'Estándar';
    history: {
        [year: string]: number[];
    };
}
