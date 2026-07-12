
import React from 'react';
import { ProcessedItem } from '../types';

interface PreviewTableProps {
  data: ProcessedItem[];
  maxRows?: number;
}

const PreviewTable: React.FC<PreviewTableProps> = ({ data, maxRows = 10 }) => {
  if (!data || data.length === 0) {
    return null;
  }

  const headers = Object.keys(data[0]);
  const displayData = data.slice(0, maxRows);

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-800 mb-4">Vista Previa de Resultados ({displayData.length} de {data.length} filas)</h2>
      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-96 shadow">
        <table className="min-w-full text-sm text-left text-slate-500">
          <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0 z-10">
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col" className="py-3 px-6 whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {displayData.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-slate-50 transition-colors">
                {headers.map((header) => (
                  <td key={`${rowIndex}-${header}`} className="py-4 px-6 whitespace-nowrap">
                    {String(row[header as keyof ProcessedItem])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PreviewTable;
    