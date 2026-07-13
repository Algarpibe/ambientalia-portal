import * as XLSX from 'xlsx';
import { inferColumns } from './inferColumns';
import { normalizeClientName, safeString } from '../utils/normalize';
import { parseCurrency, parseExcelDate } from '../utils/parsing';
import { ColumnMapping, InvoiceRecord, MasterCostRecord, PaymentRecord, SalesRecord } from '../types';

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array' });
}

function findHeaderRow(raw: Array<Array<unknown>>, synonyms: ColumnMapping, maxScan = 20): number {
  for (let i = 0; i < Math.min(raw.length, maxScan); i++) {
    const row = raw[i].map((c) => safeString(c).toLowerCase().replace(/[º°ª#\-_\.\(\)]/g, '').replace(/\s+/g, ' ').trim());
    const nonEmptyCells = row.filter((c) => c.length > 0).length;
    if (nonEmptyCells < 3) continue;

    // Count how many required columns are found in this row
    let matchCount = 0;
    for (const synonymList of Object.values(synonyms.required)) {
      const normalized = synonymList.map((s) => safeString(s).toLowerCase().replace(/[º°ª#\-_\.\(\)]/g, '').replace(/\s+/g, ' ').trim());
      
      // Try exact substring match
      let found = normalized.some((n) => row.some((cell) => cell.includes(n) || n.includes(cell)));
      
      // Try word-based match if exact didn't work
      if (!found) {
        found = normalized.some((n) => {
          const nWords = n.split(/\s+/);
          return row.some((cell) => {
            const cellWords = cell.split(/\s+/);
            return nWords.some((nw) => cellWords.includes(nw));
          });
        });
      }
      
      if (found) matchCount++;
    }

    // Accept if at least 80% of required columns are found
    const requiredCount = Object.keys(synonyms.required).length;
    if (matchCount >= Math.ceil(requiredCount * 0.8)) return i;
  }
  return -1; // Signal no header found
}

function sheetObjects(workbook: XLSX.WorkBook, mapping: ColumnMapping): [Record<string, string>, Array<Record<string, unknown>>, Array<Array<unknown>>] {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, defval: '' });
  if (!raw.length) throw new Error('El archivo está vacío');

  const headerIndex = findHeaderRow(raw, mapping);
  if (headerIndex === -1) throw new Error('No se encontraron encabezados válidos');

  const headerRow = raw[headerIndex].map((h, idx) => safeString(h) || `__col${idx}`);
  const dataRows = raw.slice(headerIndex + 1).filter((r) => r.some((c) => safeString(c) !== ''));
  const rows = dataRows.map((row) => {
    const obj: Record<string, unknown> = {};
    headerRow.forEach((key, idx) => {
      obj[key] = row[idx];
    });
    return obj;
  });

  const columns = inferColumns(headerRow, mapping);
  return [columns, rows, raw];
}

const salesMapping: ColumnMapping = {
  required: {
    cliente: ['cliente', 'razon social', 'razón social', 'nombre del cliente', 'nombre de empresa', 'nombre empresa'],
    sku: ['sku', 'código de artículo', 'codigo de articulo', 'codigo', 'código', 'producto', 'item', 'codigo articulo', 'código de artículo'],
    cantidad: ['cantidad vendida', 'cantidad', 'qty', 'units', 'unidades', 'cantvendida'],
    ventasNetas: ['importe', 'ventas', 'valor', 'monto', 'total', 'importebcy', 'ventas netas', 'venta neta', 'revenue', 'sales']
  },
  optional: {
    descripcion: ['nombre del artículo', 'descripcion', 'descripción', 'articulo', 'artículo', 'nombre articulo'],
    marca: ['marca', 'brand'],
    ordenId: ['orden', 'orden id', 'order', 'order id', 'pedido', 'numero orden', 'número orden'],
    fechaOrden: ['fecha', 'fecha orden', 'fecha pedido', 'order date', 'date'],
    año: ['año', 'anio', 'year'],
    linea: ['linea', 'línea', 'line', 'categoria', 'categoría', 'tipo'],
    familia: ['familia', 'family', 'grupo', 'group'],
    cogs: ['cogs', 'costo', 'cost', 'costo de ventas', 'cost of goods', 'costo mercancia']
  }
};

const masterMapping: ColumnMapping = {
  required: {
    sku: ['codigo de producto', 'código de producto', 'sku', 'codigo', 'código'],
    costoUnitario: ['precio de compra por unidad', 'costo', 'costo unitario']
  },
  optional: {
    fabricante: ['fabricante', 'brand', 'marca'],
    categoria: ['categoria', 'categoría', 'category'],
    descripcion: ['nombre de producto', 'nombre del artículo']
  }
};

const invoiceMapping: ColumnMapping = {
  required: {
    factura: ['n.º de factura', 'numero de factura', 'factura', 'invoice', 'n. de factura'],
    cliente: ['nombre del cliente', 'cliente', 'client', 'customer'],
    fechaFactura: ['fecha de la factura', 'fecha factura', 'invoice date', 'fecha'],
    fechaVencimiento: ['fecha de vencimiento', 'fecha vencimiento', 'due date', 'vencimiento'],
    total: ['total', 'importe', 'monto']
  },
  optional: {
    estado: ['estado', 'status'],
    saldo: ['saldo', 'balance', 'pending'],
    orden: ['numero de orden', 'número de orden']
  }
};

const paymentMapping: ColumnMapping = {
  required: {
    cliente: ['nombre del cliente', 'cliente', 'client', 'customer'],
    factura: ['n.º de factura', 'numero de factura', 'factura', 'invoice', 'n. de factura'],
    fechaPago: ['fecha', 'fecha pago', 'payment date'],
    monto: ['importe (bcy)', 'monto pago', 'pago', 'amount', 'payment amount', 'importe']
  },
  optional: {
    pagoId: ['numero de pago', 'número de pago', 'pago', 'payment id'],
    montoFcy: ['cantidad (fcy)'],
    unusedFcy: ['importe no usado (fcy)'],
    unusedBcy: ['importe no usado (bcy)']
  }
};

function isAmbientalia(name: string): boolean {
  const norm = normalizeClientName(name);
  return norm.includes('ambientalia');
}

export async function parseSales(file: File): Promise<SalesRecord[]> {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<Array<unknown>>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  if (!raw.length) throw new Error('Archivo de ventas vacío');

  // Intenta primero formato estándar con encabezados
  let headerIndex = findHeaderRow(raw, salesMapping);
  
  if (headerIndex >= 0) {
    // Tiene encabezados normales
    const headerRow = raw[headerIndex].map((h, idx) => safeString(h) || `__col${idx}`);
    const dataRows = raw.slice(headerIndex + 1).filter((r) => r.some((c) => safeString(c) !== ''));
    
    console.log('=== Attempting STANDARD MODE ===');
    console.log('Header row:', headerRow);
    
    try {
      const columns = inferColumns(headerRow, salesMapping);
      console.log('✓ Inferred columns:', columns);
      console.log('  Cliente column:', columns.cliente);
      console.log('  SKU column:', columns.sku);
      console.log('  Descripción column:', columns.descripcion);
      
      const standardParsed = dataRows
        .map((row) => {
          const clienteIdx = headerRow.indexOf(columns.cliente);
          const skuIdx = headerRow.indexOf(columns.sku);
          const cantidadIdx = headerRow.indexOf(columns.cantidad);
          const ventasNetasIdx = headerRow.indexOf(columns.ventasNetas);
          const descIdx = columns.descripcion ? headerRow.indexOf(columns.descripcion) : -1;
          const ordenIdIdx = columns.ordenId ? headerRow.indexOf(columns.ordenId) : -1;
          const fechaOrdenIdx = columns.fechaOrden ? headerRow.indexOf(columns.fechaOrden) : -1;
          const añoIdx = columns.año ? headerRow.indexOf(columns.año) : -1;
          const lineaIdx = columns.linea ? headerRow.indexOf(columns.linea) : -1;
          const familiaIdx = columns.familia ? headerRow.indexOf(columns.familia) : -1;
          const cogsIdx = columns.cogs ? headerRow.indexOf(columns.cogs) : -1;
          
          const rawClient = safeString(row[clienteIdx]);
          if (!rawClient || isAmbientalia(rawClient)) return null;
          const sku = safeString(row[skuIdx]);
          if (!sku) return null;
          
          const cantidad = Number(row[cantidadIdx]) || 0;
          const ventasNetas = parseCurrency(row[ventasNetasIdx]);
          
          if (cantidad <= 0 || ventasNetas <= 0) return null;
          
          // Parse fecha
          let fechaOrden = new Date();
          if (fechaOrdenIdx >= 0 && row[fechaOrdenIdx]) {
            fechaOrden = parseExcelDate(row[fechaOrdenIdx]);
          }
          
          // Parse año (usar de fecha si no está disponible)
          let año = fechaOrden.getFullYear();
          if (añoIdx >= 0 && row[añoIdx]) {
            const añoParsed = Number(row[añoIdx]);
            if (añoParsed > 2000 && añoParsed < 2100) año = añoParsed;
          }
          
          // Parse COGS (default 0 si no hay)
          const cogs = cogsIdx >= 0 ? parseCurrency(row[cogsIdx]) : 0;
          
          return {
            cliente: rawClient,
            clientKey: normalizeClientName(rawClient),
            ordenId: ordenIdIdx >= 0 ? safeString(row[ordenIdIdx]) : `ORD-${fechaOrden.getTime()}-${sku}`,
            fechaOrden,
            año,
            linea: lineaIdx >= 0 ? safeString(row[lineaIdx]) : 'general',
            sku,
            familia: familiaIdx >= 0 ? safeString(row[familiaIdx]) : undefined,
            descripcion: descIdx >= 0 ? safeString(row[descIdx]) : '',
            cantidad,
            ventasNetas,
            cogs
          } as SalesRecord;
        })
        .filter((r): r is SalesRecord => !!r);
      
      if (standardParsed.length > 0) {
        return standardParsed;
      }
    } catch (e) {
      console.log('✗ Standard parsing failed:', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  // Fallback: modo jerárquico (cliente en fila, items debajo)
  console.log('=== Falling back to HIERARCHICAL MODE ===');
  const simpleMapping: ColumnMapping = {
    required: { sku: salesMapping.required.sku, cantidad: salesMapping.required.cantidad, importe: salesMapping.required.importe },
    optional: { descripcion: salesMapping.optional?.descripcion ?? [] }
  };

  headerIndex = findHeaderRow(raw, simpleMapping);
  if (headerIndex === -1) headerIndex = 2;

  const headerRow = raw[headerIndex].map((h, i) => safeString(h) || `__col${i}`);
  
  const findColumnIndex = (synonyms: string[]): number => {
    const normalize = (s: string) => s.toLowerCase().replace(/[º°ª#\-_\.\(\)]/g, '').replace(/\s+/g, ' ').trim();
    const normalized = synonyms.map(normalize);
    
    let idx = headerRow.findIndex((h) => {
      const hn = normalize(h);
      return normalized.some((n) => hn.includes(n) || n.includes(hn));
    });
    
    if (idx === -1) {
      idx = headerRow.findIndex((h) => {
        const hWords = normalize(h).split(/\s+/);
        return normalized.some((n) => {
          const nWords = n.split(/\s+/);
          return nWords.some((nw) => hWords.includes(nw));
        });
      });
    }
    
    return idx;
  };
  
  const skuIdx = findColumnIndex(simpleMapping.required.sku);
  const qtyIdx = findColumnIndex(simpleMapping.required.cantidad);
  const amtIdx = findColumnIndex(simpleMapping.required.importe);
  const marcaIdx = findColumnIndex(['marca', 'brand']);
  const nombreArticuloIdx = findColumnIndex(['nombre del artículo', 'nombre articulo', 'nombre del articulo', 'descripcion', 'descripción']);

  if (skuIdx === -1 || qtyIdx === -1 || amtIdx === -1) {
    throw new Error(`No se encontraron columnas de SKU/Cantidad/Importe. Encabezados: ${headerRow.join(', ')}`);
  }

  if (marcaIdx === -1 || nombreArticuloIdx === -1) {
    throw new Error(`No se encontraron columnas de Marca o Nombre del artículo. Encabezados: ${headerRow.join(', ')}`);
  }

  let currentClient = '';
  const records: SalesRecord[] = [];
  
  raw.slice(headerIndex + 1).forEach((row, idx) => {
    const skuCell = safeString(row[skuIdx]);
    const marcaCell = marcaIdx >= 0 ? safeString(row[marcaIdx]) : '';
    const nombreArticuloCell = nombreArticuloIdx >= 0 ? safeString(row[nombreArticuloIdx]) : '';
    const qtyCell = qtyIdx >= 0 ? safeString(row[qtyIdx]) : '';
    const amtCell = amtIdx >= 0 ? safeString(row[amtIdx]) : '';

    if (!skuCell && !marcaCell && !nombreArticuloCell && !qtyCell && !amtCell) return;

    if (skuCell && !marcaCell && !nombreArticuloCell) {
      currentClient = skuCell.trim();
      return;
    }

    if (!currentClient) return;
    if (!marcaCell || !nombreArticuloCell) return;
    if (isAmbientalia(currentClient)) return;
    if (!skuCell || !qtyCell || !amtCell) return;

    const cantidad = Number(qtyCell) || 0;
    const importe = parseCurrency(amtCell);
    if (cantidad <= 0 || importe <= 0) return;

    const fechaOrden = new Date();
    records.push({
      cliente: currentClient,
      clientKey: normalizeClientName(currentClient),
      ordenId: `ORD-${fechaOrden.getTime()}-${skuCell}`,
      fechaOrden,
      año: fechaOrden.getFullYear(),
      linea: 'general',
      sku: skuCell,
      descripcion: nombreArticuloCell,
      cantidad,
      ventasNetas: importe,
      cogs: 0
    });
  });

  if (records.length === 0) throw new Error('No se extrajeron registros de ventas');
  return records;
}


export async function parseMaster(file: File): Promise<MasterCostRecord[]> {
  const workbook = await readWorkbook(file);
  const [columns, rows] = sheetObjects(workbook, masterMapping);

  return rows.map((row) => ({
    sku: safeString(row[columns.sku]),
    costoUnitario: parseCurrency(row[columns.costoUnitario]),
    fabricante: safeString(row[columns.fabricante]),
    categoria: safeString(row[columns.categoria])
  }));
}

export async function parseInvoices(file: File): Promise<InvoiceRecord[]> {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<Array<unknown>>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  if (!raw.length) throw new Error('Archivo de facturas vacío');

  let headerIndex = findHeaderRow(raw, invoiceMapping);
  if (headerIndex === -1) headerIndex = 1; // Asume fila 1 si no se detecta

  const headerRow = raw[headerIndex].map((h, idx) => safeString(h) || `__col${idx}`);
  
  try {
    const columns = inferColumns(headerRow, invoiceMapping);
    const dataRows = raw.slice(headerIndex + 1).filter((r) => r.some((c) => safeString(c) !== ''));

    return dataRows
      .map((row) => {
        const rawClient = safeString(row[headerRow.indexOf(columns.cliente)]);
        if (!rawClient || isAmbientalia(rawClient)) return null;
        const factura = safeString(row[headerRow.indexOf(columns.factura)])
          .toUpperCase()
          .replace(/\s+/g, '');
        if (!factura) return null;
        
        const estado = safeString(row[headerRow.indexOf(columns.estado)] ?? '') || 'Pendiente';
        const saldo = parseCurrency(row[headerRow.indexOf(columns.saldo)] ?? row[headerRow.indexOf(columns.total)] ?? '0');
        
        return {
          factura,
          cliente: rawClient,
          clientKey: normalizeClientName(rawClient),
          fechaFactura: parseExcelDate(row[headerRow.indexOf(columns.fechaFactura)]),
          fechaVencimiento: parseExcelDate(row[headerRow.indexOf(columns.fechaVencimiento)]),
          estado,
          total: parseCurrency(row[headerRow.indexOf(columns.total)] ?? '0'),
          saldo
        };
      })
      .filter((r): r is InvoiceRecord => !!r);
  } catch (err) {
    throw new Error(`Error parseando facturas: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function parsePayments(file: File): Promise<PaymentRecord[]> {
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<Array<unknown>>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  if (!raw.length) throw new Error('Archivo de pagos vacío');

  let headerIndex = findHeaderRow(raw, paymentMapping);
  if (headerIndex === -1) headerIndex = 1; // Asume fila 1 si no se detecta

  const headerRow = raw[headerIndex].map((h, idx) => safeString(h) || `__col${idx}`);

  try {
    const columns = inferColumns(headerRow, paymentMapping);
    const dataRows = raw.slice(headerIndex + 1).filter((r) => r.some((c) => safeString(c) !== ''));

    return dataRows
      .map((row) => {
        const rawClient = safeString(row[headerRow.indexOf(columns.cliente)]);
        if (!rawClient || isAmbientalia(rawClient)) return null;
        const factura = safeString(row[headerRow.indexOf(columns.factura)])
          .toUpperCase()
          .replace(/\s+/g, '');
        if (!factura) return null;
        const pagoId = safeString(row[headerRow.indexOf(columns.pagoId)]) || `PAG-${Math.random().toString(36).substr(2, 9)}`;
        return {
          pagoId,
          cliente: rawClient,
          clientKey: normalizeClientName(rawClient),
          factura,
          fechaPago: parseExcelDate(row[headerRow.indexOf(columns.fechaPago)]),
          monto: parseCurrency(row[headerRow.indexOf(columns.monto)] ?? '0')
        };
      })
      .filter((r): r is PaymentRecord => !!r);
  } catch (err) {
    throw new Error(`Error parseando pagos: ${err instanceof Error ? err.message : String(err)}`);
  }
}
