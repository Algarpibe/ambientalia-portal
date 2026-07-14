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
    // Recomendación de ajuste del nivel de reposición del ERP (pestaña Análisis Principal)
    levelStatus: 'Subir' | 'Bajar' | 'OK' | 'SinConfigurar' | 'SinDatos';
    itemStatus: string;     // estado maestro del artículo en Zoho ('active' | 'inactive')
    coverageDays: number;   // días de inventario (stock físico / demanda diaria); -1 = N/A
    coverageRisk: boolean;  // true si cobertura < lead time (riesgo de quiebre)
    orderDate: string;      // fecha de la OC abierta más próxima (ISO); '' si ninguna
    etaDate: string;        // fecha estimada de llegada = fecha OC + lead time; '' si N/A
    etaDays: number;        // días desde hoy hasta la ETA (negativo = atrasada)
    unitCost: number;       // costo de compra por unidad (USD)
    annualValue: number;    // valor de consumo anual por costo = uds anuales × costo
    annualValueRevenue: number; // valor de consumo anual por precio de venta
    coefVariation: number;  // coeficiente de variación de la demanda (σ / media)
    abcClass: 'A' | 'B' | 'C';       // ABC por costo (Pareto)
    xyzClass: 'X' | 'Y' | 'Z';       // XYZ por variabilidad (CV)
    abcXyz: string;                  // combinado por costo, p. ej. "AX"
    abcClassRevenue: 'A' | 'B' | 'C'; // ABC por precio de venta
    abcXyzRevenue: string;            // combinado por venta
    demandPattern: 'Suave' | 'Intermitente' | 'Errática' | 'Lumpy'; // Syntetos-Boylan
    adi: number;                     // Average Demand Interval (períodos por demanda)
    cv2: number;                     // CV² del tamaño de la demanda
    crostonForecast: number;         // pronóstico Croston (SBA) por mes
    monthsSinceLastSale: number;     // meses desde la última venta; -1 = nunca
    deadStockClass: 'Activo' | 'Lento' | 'Muerto' | 'Obsoleto';
    deadStockValue: number;          // capital en dead stock (físico × costo si Muerto/Obsoleto)
    overstockUnits: number;          // unidades por encima del techo sano (PdP + Q)
    overstockValue: number;          // capital en sobrestock (uds exceso × costo)
    inventoryValue: number;          // capital total en el ítem (físico × costo)
    monthlyAverage: number;
    annualSales: number;
    stdDev: number;
    demandSource: 'Ventas 2026' | 'Ventas 2025' | 'Promedio Trienal' | 'Croston (SBA)';
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
    vendor: string;
    erpLevel: number;
    variabilityClass: 'Alta' | 'Media' | 'Baja';
    demandType: 'Normal' | 'Anormal';
    valueClass: 'Ultra Alto' | 'Alto' | 'Estándar';
    history: {
        [year: string]: number[];
    };
}
