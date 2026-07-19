export interface ExcelColumn { header: string; width?: number; numFmt?: string }
export interface ExcelRow { cells: (string | number | null)[]; bold?: boolean }
export interface ExcelSheet { name: string; columns: ExcelColumn[]; rows: ExcelRow[] }
