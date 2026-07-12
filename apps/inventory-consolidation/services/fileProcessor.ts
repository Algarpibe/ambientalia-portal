import { RawRowData, ProcessedItem } from '../types';
import * as XLSX from 'xlsx';

export const findColumnKey = (columns: string[], aliases: string[]): string | null => {
  for (const alias of aliases) {
    const foundKey = columns.find(col => col.toLowerCase().trim().startsWith(alias.toLowerCase().trim()));
    if (foundKey) return foundKey;
  }
  return null;
};

export const readFileData = (file: File): Promise<RawRowData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!e.target?.result) {
            reject(new Error(`Error al leer el archivo ${file.name}: No hay contenido.`));
            return;
        }
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (rawData.length === 0) {
          resolve([]);
          return;
        }

        let headerIndex = -1;
        for (let i = 0; i < rawData.length; i++) {
            const lowercasedRow = rawData[i].map(cell => String(cell).toLowerCase().trim());
            if (lowercasedRow.includes('sku')) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) {
            throw new Error(`En '${file.name}', no se pudo encontrar la fila de encabezado con la columna 'sku'.`);
        }

        const headers = rawData[headerIndex].map(h => String(h).trim()); // Keep original case for keys, but trim
        const jsonData: RawRowData[] = [];

        for (let i = headerIndex + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (row.every(cell => String(cell).trim() === '')) continue; 
            let rowObject: RawRowData = {};
            headers.forEach((header, index) => {
                if (header) { // Only add if header is not empty
                    rowObject[header] = row[index];
                }
            });
            jsonData.push(rowObject);
        }
        resolve(jsonData);
      } catch (err: any) {
        reject(new Error(`No se pudo procesar ${file.name}. Detalles: ${err.message}`));
      }
    };
    reader.onerror = (err) => reject(new Error(`No se pudo leer ${file.name}. Error: ${err}`));
    reader.readAsArrayBuffer(file);
  });
};

export const processInventoryData = (
    invData: RawRowData[], 
    factData: RawRowData[], 
    envData: RawRowData[]
): ProcessedItem[] => {
    if (invData.length === 0) throw new Error("El archivo de inventario (Resumen de Inventario) no contiene datos o no tiene el formato esperado.");
    
    const finalData: ProcessedItem[] = [];

    const invKeys = Object.keys(invData[0]);
    const invKeyMap = {
        sku: findColumnKey(invKeys, ['sku']),
        itemName: findColumnKey(invKeys, ['item_name', 'nombre del artículo', 'item name']),
        qtyAvailable: findColumnKey(invKeys, ['quantity_available', 'existencias a mano', 'available'])
    };

    if (!invKeyMap.sku || !invKeyMap.itemName || !invKeyMap.qtyAvailable) {
        throw new Error(`Faltan columnas esenciales en el archivo de Inventario. Se requieren SKU, Item Name/Nombre del Artículo, Quantity Available/Existencias a Mano. Columnas encontradas: [${invKeys.join(', ')}]`);
    }
    
    const factKeys = factData.length > 0 ? Object.keys(factData[0]) : [];
    const factKeyMap = {
        sku: factData.length > 0 ? findColumnKey(factKeys, ['sku']) : null,
        itemName: factData.length > 0 ? findColumnKey(factKeys, ['item_name', 'nombre del artículo', 'item name']) : null,
        qtyComprometidas: factData.length > 0 ? findColumnKey(factKeys, ['existencias comprometidas', 'quantity committed']) : null,
        transaccion: factData.length > 0 ? findColumnKey(factKeys, ['transacción#', 'transaccion#', 'transaction#', 'transaction id']) : null
    };

    const envKeys = envData.length > 0 ? Object.keys(envData[0]) : [];
    const envKeyMap = {
        sku: envData.length > 0 ? findColumnKey(envKeys, ['sku']) : null,
        itemName: envData.length > 0 ? findColumnKey(envKeys, ['item_name', 'nombre del artículo', 'item name']) : null,
        qtyComprometidas: envData.length > 0 ? findColumnKey(envKeys, ['existencias comprometidas', 'quantity committed']) : null,
        transaccion: envData.length > 0 ? findColumnKey(envKeys, ['transacción#', 'transaccion#', 'transaction#', 'transaction id']) : null
    };

    for (const invRow of invData) {
        const sku = String(invRow[invKeyMap.sku!]);
        const itemName = String(invRow[invKeyMap.itemName!]);

        const itemFactData = factKeyMap.sku && factKeyMap.itemName ? factData.filter(row => String(row[factKeyMap.sku!]) === sku && String(row[factKeyMap.itemName!]) === itemName) : [];
        const itemEnvData = envKeyMap.sku && envKeyMap.itemName ? envData.filter(row => String(row[envKeyMap.sku!]) === sku && String(row[envKeyMap.itemName!]) === itemName) : [];

        const totalQuantityDemanded = itemFactData.reduce((sum, row) => sum + (Number(row[factKeyMap.qtyComprometidas!]) || 0), 0);
        const totalExistenciasFisicoComprometidas = itemEnvData.reduce((sum, row) => sum + (Number(row[envKeyMap.qtyComprometidas!]) || 0), 0);
        const quantityAvailableContabilidad = Number(invRow[invKeyMap.qtyAvailable!]) || 0;
        
        // 'Existencias a mano físicas' = 'Existencias a mano de contabilidad' - 'Existencias Comprometidas en físico (Por Enviar)'
        const quantityAvailableFisicas = quantityAvailableContabilidad - totalExistenciasFisicoComprometidas;
        // 'Disponible para la venta' = 'Existencias a mano de contabilidad' - 'Existencias Comprometidas en contabilidad (Por facturar)'
        const quantityAvailableForSale = quantityAvailableContabilidad - totalQuantityDemanded;

        const commonData = {
            'sku': sku,
            'item_name': itemName,
            'Existencias Comprometidas en contabilidad (Por facturar)': totalQuantityDemanded,
            'Existencias Comprometidas en físico (Por Enviar)': totalExistenciasFisicoComprometidas,
            'Existencias a mano de contabilidad': quantityAvailableContabilidad,
            'Existencias a mano físicas': quantityAvailableFisicas,
            'Disponible para la venta': quantityAvailableForSale
        };

        if (itemFactData.length === 0 && itemEnvData.length === 0) {
            finalData.push({
                ...commonData,
                'Cantidad Por Facturar': '', 'Por Facturar': '',
                'Cantidad Por Entregar': '', 'Por Entregar': ''
            });
            continue;
        }

        const ovMap = new Map<string, { factQty?: number, factTx?: string, envQty?: number, envTx?: string }>();

        if(factKeyMap.transaccion && factKeyMap.qtyComprometidas) {
            itemFactData.forEach(row => {
                const transaccion = String(row[factKeyMap.transaccion!]);
                if (!ovMap.has(transaccion)) ovMap.set(transaccion, {});
                const entry = ovMap.get(transaccion)!;
                entry.factQty = Number(row[factKeyMap.qtyComprometidas!]) || 0;
                entry.factTx = transaccion;
            });
        }
        
        if(envKeyMap.transaccion && envKeyMap.qtyComprometidas) {
            itemEnvData.forEach(row => {
                const transaccion = String(row[envKeyMap.transaccion!]);
                if (!ovMap.has(transaccion)) ovMap.set(transaccion, {});
                const entry = ovMap.get(transaccion)!;
                entry.envQty = Number(row[envKeyMap.qtyComprometidas!]) || 0;
                entry.envTx = transaccion;
            });
        }
        
        if (ovMap.size === 0) { // If transactions couldn't be mapped (e.g. missing transaccion# column)
            finalData.push({
                ...commonData,
                'Cantidad Por Facturar': '', 'Por Facturar': '',
                'Cantidad Por Entregar': '', 'Por Entregar': ''
            });
        } else {
            for (const ov of ovMap.values()) {
                finalData.push({
                    ...commonData,
                    'Cantidad Por Facturar': ov.factQty !== undefined ? ov.factQty : '',
                    'Por Facturar': ov.factTx || '',
                    'Cantidad Por Entregar': ov.envQty !== undefined ? ov.envQty : '',
                    'Por Entregar': ov.envTx || ''
                });
            }
        }
    }
    return finalData;
};

export const downloadExcelFile = (data: ProcessedItem[], filename: string): void => {
  if (data.length === 0) {
    console.warn("No data to download.");
    return;
  }
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario Desglosado");
  
  const columnKeys = Object.keys(data[0]) as (keyof ProcessedItem)[];
  const columnWidths = columnKeys.map(key => ({ wch: Math.max(String(key).length + 2, 25) }));
  worksheet["!cols"] = columnWidths;

  XLSX.writeFile(workbook, filename);
};