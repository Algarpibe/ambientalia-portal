import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Upload, FileSpreadsheet, X, CheckCircle2 } from 'lucide-react';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Status Badge Component
interface StatusBadgeProps {
    status: 'Urgente' | 'EnCamino' | 'Pedir' | 'Overstock' | 'Optimized' | 'Ignored';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
    const styles = {
        Urgente: 'bg-red-100 text-red-700 border-red-200',
        EnCamino: 'bg-orange-100 text-orange-700 border-orange-200',
        Pedir: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        Overstock: 'bg-amber-100 text-amber-700 border-amber-200',
        Optimized: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        Ignored: 'bg-gray-100 text-gray-500 border-gray-200',
    };

    const labels = {
        Urgente: 'Urgente',
        EnCamino: 'En camino',
        Pedir: 'Pedir',
        Overstock: 'Sobrestock',
        Optimized: 'Optimizado',
        Ignored: 'Ignorado',
    };

    return (
        <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium border', styles[status])}>
            {labels[status]}
        </span>
    );
};

// Level Status Badge — recomendación de ajuste del nivel de reposición del ERP
// (pestaña Análisis Principal), en vez del estatus operativo de reposición.
interface LevelStatusBadgeProps {
    status: 'Subir' | 'Bajar' | 'OK' | 'SinConfigurar' | 'SinDatos' | 'NoStockear';
}

export const LevelStatusBadge: React.FC<LevelStatusBadgeProps> = ({ status }) => {
    const styles = {
        Subir: 'bg-red-100 text-red-700 border-red-200',
        Bajar: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        OK: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        // "No stockear" es una conclusión del análisis, no un aviso: va en verde como
        // el OK. "Sin configurar"/"Sin datos" sí piden acción o delatan un hueco.
        NoStockear: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        SinConfigurar: 'bg-blue-100 text-blue-700 border-blue-200',
        SinDatos: 'bg-gray-100 text-gray-500 border-gray-200',
    };
    const labels = {
        Subir: 'Subir nivel',
        Bajar: 'Bajar nivel',
        OK: 'Nivel OK',
        NoStockear: 'No stockear',
        SinConfigurar: 'Sin configurar',
        SinDatos: 'Sin datos',
    };
    return (
        <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium border', styles[status])}>
            {labels[status]}
        </span>
    );
};

// File Upload Component
interface FileUploadProps {
    label: string;
    accept?: string;
    onFileSelect: (file: File) => void;
    selectedFile?: File | null;
}

// Premium File Upload Component

export const FileUpload: React.FC<FileUploadProps> = ({ label, accept = '.xlsx,.xls,.csv', onFileSelect, selectedFile }) => {
    const isSelected = !!selectedFile;

    // Calculate size string if available
    const sizeStr = selectedFile && 'size' in selectedFile
        ? (selectedFile.size < 1024 * 1024
            ? `${(selectedFile.size / 1024).toFixed(0)} KB`
            : `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`)
        : '';

    return (
        <div className={`relative group transition-all duration-300 ease-out h-48
      ${isSelected
                ? 'bg-blue-50/50 border-2 border-blue-400/30'
                : 'bg-white border-2 border-slate-100 shadow-sm hover:border-blue-300 hover:shadow-md'} 
      rounded-[1.5rem] overflow-hidden`}
        >
            {isSelected && (
                <div className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full shadow-lg shadow-blue-500/20 animate-in zoom-in duration-300 z-10">
                    <CheckCircle2 size={14} strokeWidth={3} />
                </div>
            )}

            <label className="flex flex-col items-center justify-center h-full w-full cursor-pointer p-4 relative z-0">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 transition-all duration-300 shadow-md
          ${isSelected
                        ? 'bg-blue-500 text-white shadow-blue-500/30 rotate-3 scale-110'
                        : 'bg-slate-50 text-slate-400 group-hover:scale-110 group-hover:bg-blue-50 group-hover:text-blue-600'}`}>
                    {isSelected ? <FileSpreadsheet size={24} /> : <Upload size={24} />}
                </div>

                <h3 className={`text-sm font-bold text-center leading-tight mb-1 transition-colors px-2
          ${isSelected ? 'text-blue-900' : 'text-slate-700 group-hover:text-blue-700'}`}>
                    {label}
                </h3>

                <p className="text-xs text-slate-400 font-medium truncate w-full text-center px-4">
                    {isSelected ? (selectedFile.name || 'Archivo seleccionado') : 'Clic para subir .xlsx'}
                </p>

                {isSelected && sizeStr && (
                    <span className="mt-1 text-[10px] font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                        {sizeStr}
                    </span>
                )}

                <input
                    type="file"
                    accept={accept}
                    onChange={(e) => {
                        if (e.target.files?.[0]) {
                            onFileSelect(e.target.files[0]);
                        }
                    }}
                    className="hidden"
                />

                {isSelected && (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            onFileSelect(null as any);
                        }}
                        className="absolute top-3 left-3 text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-colors z-20"
                        title="Eliminar archivo"
                    >
                        <X size={14} />
                    </button>
                )}
            </label>
        </div>
    );
};

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        ✕
                    </button>
                </div>
                <div className="p-6 overflow-y-auto max-h-[80vh]">
                    {children}
                </div>
            </div>
        </div>
    );
};
