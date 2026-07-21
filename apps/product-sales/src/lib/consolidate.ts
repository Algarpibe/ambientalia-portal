import * as XLSX from 'xlsx';
import type { SalesRecord, ConsolidatedRecord } from './excel-utils';

interface MonthlyData {
    month: string;
    records: SalesRecord[];
}

export const consolidateData = (
    monthlyDataList: MonthlyData[],
    categoryMap: Map<string, string>
): ConsolidatedRecord[] => {
    const masterMap = new Map<string, ConsolidatedRecord>();

    // Initialize or Update records
    monthlyDataList.forEach(({ month, records }) => {
        records.forEach(record => {
            const { sku, name, quantity, amount, category } = record;

            if (!masterMap.has(sku)) {
                // Priority: 1) category from file, 2) categoryMap
                const categoryName = category || categoryMap.get(sku) || '';
                masterMap.set(sku, {
                    sku,
                    item_name: name,
                    category_name: categoryName,
                    months: {},
                    average_price: 0,
                    total_amount_cache: 0,
                    total_quantity_cache: 0
                });
            }

            const entry = masterMap.get(sku)!;
            if (!entry.item_name && name) entry.item_name = name;
            if (!entry.category_name && category) entry.category_name = category;
            if (!entry.category_name) entry.category_name = categoryMap.get(sku) || '';

            // Add quantity to the specific month
            entry.months[month] = (entry.months[month] || 0) + quantity;

            // Cache totals for average calculation
            entry.total_quantity_cache = (entry.total_quantity_cache || 0) + quantity;
            entry.total_amount_cache = (entry.total_amount_cache || 0) + amount;
        });
    });

    // Calculate Average Prices
    const results = Array.from(masterMap.values());
    results.forEach(r => {
        if (r.total_quantity_cache && r.total_quantity_cache > 0) {
            r.average_price = r.total_amount_cache ? (r.total_amount_cache / r.total_quantity_cache) : 0;
        } else {
            r.average_price = 0;
        }
    });

    return results;
};

export const generateConsolidatedExcel = (data: ConsolidatedRecord[]): Uint8Array => {
    const allMonths = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    // Flatten for Excel
    const flattenedData = data.map(record => {
        const row: Record<string, string | number> = {
            sku: record.sku,
            item_name: record.item_name,
            category_name: record.category_name,
        };

        allMonths.forEach(m => {
            row[m] = record.months[m] || 0;
        });

        row['average_price'] = record.average_price || 0;

        return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(flattenedData);

    // Set column widths
    worksheet['!cols'] = [
        { wch: 15 }, // sku
        { wch: 40 }, // name
        { wch: 20 }, // category
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, // months
        { wch: 15 } // avg price
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Consolidado');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new Uint8Array(excelBuffer);
};
