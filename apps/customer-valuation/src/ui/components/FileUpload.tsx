import { ChangeEvent } from 'react';

interface FileUploadProps {
  label: string;
  onFiles: (files: FileList) => void;
  helper?: string;
}

export function FileUpload({ label, onFiles, helper }: FileUploadProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) onFiles(e.target.files);
  };

  return (
    <div className="upload">
      <label className="upload__label">{label}</label>
      <input type="file" accept=".xlsx,.xls" onChange={handleChange} />
      {helper && <p className="upload__helper">{helper}</p>}
    </div>
  );
}
