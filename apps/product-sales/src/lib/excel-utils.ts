import * as XLSX from 'xlsx';

export interface SalesRecord {
    sku: string;
    name: string;
    quantity: number;
    amount: number;
    category?: string;
}

export interface ConsolidatedRecord {
    sku: string;
    item_name: string;
    category_name: string;
    months: { [key: string]: number };
    average_price: number;
    total_amount_cache?: number; // Internal helper
    total_quantity_cache?: number; // Internal helper
}

const MONTH_MAP: { [key: string]: string } = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
    '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
    '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
};

export const getMonthFromFilename = (filename: string): string | null => {
    // Try 6 digits first: _DDMMYY.xlsx (e.g. _030226.xlsx)
    // Assuming DDMMYY format commonly used in Spanish locales
    const match6 = filename.match(/_(\d{2})(\d{2})(\d{2})\.xlsx$/);
    if (match6) {
        const day = parseInt(match6[1], 10);
        let month = parseInt(match6[2], 10);

        // Heuristic: If generated in the first 10 days of the month, 
        // it likely contains data for the previous month.
        // e.g. 03/02 (Feb 3rd) -> Report works on Jan data.
        if (day <= 10) {
            month = month - 1;
            if (month === 0) month = 12;
        }

        const monthCode = month.toString().padStart(2, '0');
        return MONTH_MAP[monthCode] || null;
    }

    // Try 4 digits: _MMYY.xlsx (e.g. _0125.xlsx)
    const match4 = filename.match(/_(\d{2})(\d{2})\.xlsx$/);
    if (match4) {
        const monthCode = match4[1]; // Capture MM
        return MONTH_MAP[monthCode] || null;
    }

    return null;
};

export const parseMonthlyFile = async (file: File): Promise<SalesRecord[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                const jsonData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
                const records: SalesRecord[] = [];

                let headerRowIndex = -1;
                let skuIdx = -1;
                let nameIdx = -1;
                let qtyIdx = -1;
                let amtIdx = -1;
                let catIdx = -1;

                for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
                    const row = jsonData[i] as string[];
                    if (!row) continue;

                    const rowStr = row.map(c => c?.toString().toLowerCase() || '');
                    const sIdx = rowStr.findIndex(c => c.includes('sku') || c.includes('código') || c.includes('codigo'));

                    // Name: Nombre, Artículo, Descripción (BUT exclude SKU/Code explicitly)
                    const nIdx = rowStr.findIndex(c =>
                        (c.includes('nombre') || c.includes('artículo') || c.includes('articulo') || c.includes('descripción')) &&
                        !c.includes('sku') && !c.includes('código') && !c.includes('codigo')
                    );

                    // Quantity: Cantidad, Unidades, Qty, Vendida
                    const qIdx = rowStr.findIndex(c => c.includes('cantidad') || c.includes('unidades') || c.includes('qty') || c.includes('vendida'));

                    // Amount search
                    const aIdx = rowStr.findIndex(c => c.includes('importe') || c.includes('total') || c.includes('venta'));

                    // Category search
                    const cIdx = rowStr.findIndex(c => c.includes('category') || c.includes('categoría') || c.includes('categoria'));

                    if (sIdx !== -1 && (nIdx !== -1 || qIdx !== -1)) {
                        headerRowIndex = i;
                        skuIdx = sIdx;
                        nameIdx = nIdx;
                        qtyIdx = qIdx;
                        amtIdx = aIdx;
                        catIdx = cIdx;
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    console.warn(`Could not find headers in file ${file.name}`);
                    resolve([]);
                    return;
                }

                for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.length === 0) continue;

                    const sku = skuIdx !== -1 ? row[skuIdx]?.toString().trim() || '' : '';
                    const name = nameIdx !== -1 ? row[nameIdx]?.toString().trim() || '' : '';
                    const category = catIdx !== -1 ? row[catIdx]?.toString().trim() || '' : '';
                    const rawQty = qtyIdx !== -1 ? row[qtyIdx] : 0;
                    const rawAmt = amtIdx !== -1 ? row[amtIdx] : 0;

                    if (!sku) continue;

                    let quantity = 0;
                    if (typeof rawQty === 'number') {
                        quantity = rawQty;
                    } else if (typeof rawQty === 'string') {
                        const cleanQty = rawQty.replace(/,/g, '').trim();
                        quantity = parseFloat(cleanQty) || 0;
                    }

                    let amount = 0;
                    if (typeof rawAmt === 'number') {
                        amount = rawAmt;
                    } else if (typeof rawAmt === 'string') {
                        const cleanAmt = rawAmt.replace(/[^\d.-]/g, '');
                        amount = parseFloat(cleanAmt) || 0;
                    }

                    records.push({ sku, name, quantity, amount, category });
                }

                resolve(records);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

export const parseCategoryFile = async (file: File): Promise<Map<string, string>> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                const jsonData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
                const headers = jsonData[0] as string[];

                const skuIndex = headers.findIndex(h => h?.toLowerCase().includes('sku'));
                const catIndex = headers.findIndex(h => h?.toLowerCase().includes('category'));

                const categoryMap = new Map<string, string>();

                if (skuIndex === -1 || catIndex === -1) {
                    resolve(categoryMap);
                    return;
                }

                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row) continue;
                    const sku = row[skuIndex]?.toString();
                    const cat = row[catIndex]?.toString();
                    if (sku && cat) {
                        categoryMap.set(sku, cat);
                    }
                }
                resolve(categoryMap);
            } catch (error) {
                reject(error);
            }
        }
        reader.readAsArrayBuffer(file);
    });
}
