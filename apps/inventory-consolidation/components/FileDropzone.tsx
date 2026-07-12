
import React, { useState, useCallback, useRef } from 'react';
import { FileInputConfig } from '../types';

interface FileDropzoneProps {
  config: FileInputConfig;
  fileName: string | null;
  fileError: string | null;
  onFileChange: (file: File | null) => void;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ config, fileName, fileError, onFileChange }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileChange(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  }, [onFileChange]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileChange(e.target.files[0]);
    } else {
      onFileChange(null);
    }
    // Reset the input value to allow selecting the same file again if needed
    if (e.target) {
        e.target.value = '';
    }
  };

  const baseBorderColor = fileError ? 'border-red-500 bg-red-50' : (fileName ? 'border-green-500 bg-green-50' : 'border-slate-300');
  const dragOverStyle = isDragOver ? 'bg-sky-50 border-sky-500' : '';

  return (
    <div
      className={`file-drop-area border-2 border-dashed rounded-lg p-6 text-center transition-colors duration-200 ${baseBorderColor} ${dragOverStyle} cursor-pointer`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // onClick={() => inputRef.current?.click()} // Removed this line
    >
      <input
        type="file"
        id={config.id}
        ref={inputRef}
        className="hidden"
        accept=".xlsx, .xls, .csv"
        onChange={handleFileSelect}
      />
      {/* The label will now handle the click to open the file dialog */}
      <label htmlFor={config.id} className="cursor-pointer flex flex-col items-center justify-center h-full">
        <svg className={`mx-auto h-12 w-12 ${config.colorClass}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M2.25 4.125a3.375 3.375 0 013.375-3.375h12A3.375 3.375 0 0121.75 4.125v15.75a3.375 3.375 0 01-3.375 3.375h-12A3.375 3.375 0 012.25 19.875V4.125zM4.5 4.875a.75.75 0 01.75-.75h13.5a.75.75 0 01.75.75v3.375H4.5V4.875zM4.5 9.75H9v4.5H4.5v-4.5zm5.25 0h4.5v4.5h-4.5v-4.5zm5.25 0h4.5v4.5h-4.5v-4.5zM4.5 15.75H9v3.375H4.5v-3.375zm5.25 0h4.5v3.375h-4.5v-3.375zm5.25 0h4.5v3.375h-4.5v-3.375z" clipRule="evenodd" />
        </svg>
        <p className={`mt-2 font-semibold ${config.colorClass}`}>{config.label}</p>
        {fileError ? (
          <p className="text-xs text-red-600 mt-1 break-words px-2">{fileError}</p>
        ) : (
          <p className={`text-xs mt-1 ${fileName ? 'text-slate-700 font-bold' : 'text-slate-500'} px-2 break-words`}>
            {fileName || config.description}
          </p>
        )}
      </label>
    </div>
  );
};

export default FileDropzone;
