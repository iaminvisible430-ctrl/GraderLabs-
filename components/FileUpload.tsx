
import React, { useState, useRef, useEffect } from 'react';
import { UploadIcon, CheckCircleIcon, CameraIcon } from './Icons';
import { CameraScanner } from './CameraScanner';

interface FileUploadProps {
  onAnswerSheetChange: (file: File | null) => void;
  onReferenceDocChange: (file: File | null) => void;
  onQuestionPaperChange: (file: File | null) => void;
  isReferenceDocDisabled?: boolean;
  questionPaperFile?: File | null;
  referenceDocFile?: File | null;
  answerSheetFile?: File | null;
}

const FileInput: React.FC<{
  id: string;
  label: string;
  description: string;
  file: File | null;
  required?: boolean;
  onFileChange: (file: File | null) => void;
  onScanClick?: () => void; // Make optional for reuse
  accept?: string;
  disabled?: boolean;
  disabledTooltip?: string;
}> = ({ id, label, description, file, required = false, onFileChange, onScanClick, accept = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.md", disabled = false, disabledTooltip }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    onFileChange(selectedFile);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    if(disabled) return;
    const droppedFile = e.dataTransfer.files?.[0] || null;
    if (droppedFile) {
        onFileChange(droppedFile);
        if (inputRef.current) {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(droppedFile);
            inputRef.current.files = dataTransfer.files;
        }
    }
  };

  return (
    <div className={`${disabled ? 'opacity-50' : ''}`} title={disabled ? disabledTooltip : undefined}>
      <label htmlFor={id} className="text-sm font-medium text-slate-900 dark:text-white">
        {label} {required && !disabled && <span className="text-red-400">*</span>}
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 mb-2">{description}</p>
      <div className="flex items-center gap-2">
        <label
          htmlFor={disabled ? undefined : id}
          onDragOver={disabled ? undefined : handleDragOver}
          onDrop={disabled ? undefined : handleDrop}
          className="flex-grow flex items-center gap-2 text-xs md:text-sm p-2 md:p-3 rounded-md border border-white/30 bg-black/20 cursor-pointer hover:bg-black/30"
        >
          {file ? <CheckCircleIcon className="w-5 h-5 text-green-400 flex-shrink-0"/> : <UploadIcon className="w-5 h-5 text-slate-300 flex-shrink-0" />}
          <span className="truncate text-slate-200">{file?.name || 'Drag & drop or click...'}</span>
        </label>
        <input ref={inputRef} id={id} type="file" className="sr-only" onChange={handleFileChange} accept={accept} disabled={disabled} />
        {onScanClick && (
          <button
            type="button"
            onClick={onScanClick}
            disabled={disabled}
            className="flex-shrink-0 p-2 md:p-3 rounded-md bg-blue-500/80 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label={`Scan ${label}`}
          >
            <CameraIcon className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export const FileUpload: React.FC<FileUploadProps> = ({
  onAnswerSheetChange,
  onReferenceDocChange,
  onQuestionPaperChange,
  isReferenceDocDisabled = false,
  questionPaperFile,
  referenceDocFile,
  answerSheetFile
}) => {
    const [answerSheet, setAnswerSheet] = useState<File | null>(answerSheetFile || null);
    const [referenceDoc, setReferenceDoc] = useState<File | null>(referenceDocFile || null);
    const [questionPaper, setQuestionPaper] = useState<File | null>(questionPaperFile || null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    useEffect(() => setAnswerSheet(answerSheetFile || null), [answerSheetFile]);
    useEffect(() => setReferenceDoc(referenceDocFile || null), [referenceDocFile]);
    useEffect(() => setQuestionPaper(questionPaperFile || null), [questionPaperFile]);

    const handleFileChange = (setter: (file: File | null) => void, callback: (file: File | null) => void) => (file: File | null) => {
        setter(file);
        callback(file);
    };

    const handleScanCapture = (file: File) => {
        setAnswerSheet(file);
        onAnswerSheetChange(file);
        setIsScannerOpen(false);
    };

    return (
        <>
            {isScannerOpen && <CameraScanner onCapture={handleScanCapture} onClose={() => setIsScannerOpen(false)} />}
            <div className="space-y-4 md:space-y-6">
                <FileInput 
                    id="question-paper"
                    label="Question Paper"
                    description="The main question sheet."
                    required
                    file={questionPaper}
                    onFileChange={handleFileChange(setQuestionPaper, onQuestionPaperChange)}
                />
                 <FileInput 
                    id="reference-doc"
                    label="Answer Key / Marking Scheme"
                    description="The correct answers."
                    required={!isReferenceDocDisabled}
                    file={referenceDoc}
                    onFileChange={handleFileChange(setReferenceDoc, onReferenceDocChange)}
                    disabled={isReferenceDocDisabled}
                    disabledTooltip="The Answer Key is not needed for AI Knowledge mode."
                    accept=".txt,.pdf"
                />
                <FileInput 
                    id="answer-sheet"
                    label="Answer Sheet"
                    description="The student's answer sheet to grade."
                    required
                    file={answerSheet}
                    onFileChange={handleFileChange(setAnswerSheet, onAnswerSheetChange)}
                    onScanClick={() => setIsScannerOpen(true)}
                />
            </div>
        </>
    );
}
