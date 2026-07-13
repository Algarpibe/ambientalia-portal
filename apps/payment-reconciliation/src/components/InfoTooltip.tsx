import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface TooltipProps {
  title: string;
  description: string;
  formula?: string;
}

// Tooltip informativo reutilizable (ARQ-001 F): se usa junto a cada KPI para
// explicar su fórmula. Se extrajo de GeneralAnalysis (se usaba 9 veces).
export const InfoTooltip: React.FC<TooltipProps> = ({ title, description, formula }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="p-1 hover:bg-white/50 rounded-full transition-colors"
        type="button"
      >
        <Info size={16} className="text-slate-400 hover:text-slate-600" />
      </button>
      {isVisible && (
        <div className="absolute z-50 w-72 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl -left-32 top-8">
          <div className="font-bold mb-1">{title}</div>
          <div className="text-slate-200 mb-2">{description}</div>
          {formula && (
            <div className="bg-slate-700 p-2 rounded mt-2 font-mono text-xs">
              {formula}
            </div>
          )}
          <div className="absolute -top-2 left-36 w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-slate-800"></div>
        </div>
      )}
    </div>
  );
};
