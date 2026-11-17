import React, { useState, useRef, useEffect } from 'react';
import { UploadIcon, FileIcon, TrashIcon, CameraIcon } from './Icons';
import type { StudentData } from '../types';
import { CameraScanner } from './CameraScanner';
import { playSound } from '../utils/sound';
import { ACCEPTED_DOCUMENT_EXTENSIONS } from '../utils/fileUtils';

const FileInput: React.FC<{
  id: string;
  label: string;
  slotTag: string;
  description: string;
  required?: boolean;
  onFileChange: (file: File | null) => void;
  accept?: string;
  disabled?: boolean;
  disabledTooltip?: string;
  currentFile?: File | null;
}> = ({
  id,
  label,
  slotTag,
  description,
  required = false,
  onFileChange,
  accept,
  disabled = false,
  disabledTooltip,
  currentFile,
}) => {
  const [fileName, setFileName] = useState<string | null>(currentFile?.name || null);

  useEffect(() => {
    setFileName(currentFile?.name || null);
  }, [currentFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    if (selectedFile) playSound('upload');
    setFileName(selectedFile?.name || null);
    onFileChange(selectedFile);
  };

  return (
    <div
      className={`liquid-glass border-glow p-4 sm:p-5 rounded-2xl transition-all ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      title={disabled ? disabledTooltip : undefined}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-500/30 text-purple-300">
          {slotTag}
        </span>
        <span className="text-[11px] font-mono text-purple-300/70">
          {fileName ? '1 READY' : '0 UPLOADED'}
        </span>
      </div>

      <label htmlFor={id} className="block text-sm font-bold text-white">
        {label} {required && !disabled && <span className="text-rose-400">*</span>}
      </label>
      <p className="text-xs text-purple-200/60 mt-0.5 mb-3">{description}</p>

      <input
        id={id}
        name={id}
        type="file"
        onChange={handleFileChange}
        accept={accept}
        disabled={disabled}
        className="block w-full text-xs text-purple-200/80 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border file:border-purple-400/40 file:text-xs file:font-semibold file:bg-purple-600/25 file:text-white hover:file:bg-purple-600/45 file:cursor-pointer file:transition disabled:opacity-60"
      />

      {fileName && (
        <div className="mt-3 p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-400/40 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-emerald-200 truncate">{fileName}</span>
          <span className="text-xs font-mono text-emerald-400 font-bold">&#10003;</span>
        </div>
      )}
    </div>
  );
};

export const BatchUpload: React.FC<{
  onQuestionPaperChange: (file: File | null) => void;
  onReferenceDocChange: (file: File | null) => void;
  onStudentsChange: (students: StudentData[]) => void;
  isReferenceDocDisabled?: boolean;
  questionPaperFile?: File | null;
  referenceDocFile?: File | null;
}> = ({
  onQuestionPaperChange,
  onReferenceDocChange,
  onStudentsChange,
  isReferenceDocDisabled = false,
  questionPaperFile = null,
  referenceDocFile = null,
}) => {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const dropRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    onStudentsChange(students);
  }, [students, onStudentsChange]);

  const handleFilesAdd = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const validFiles = Array.from(files).filter((f) => f.size > 0);
    if (validFiles.length === 0) return;
    playSound('upload');
    const newStudents = validFiles.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      rollNumber: '',
      name: file.name.replace(/\.[^/.]+$/, '') || 'Student',
      studentClass: '',
      answerSheet: file,
    }));
    setStudents((prev) => [...prev, ...newStudents]);
  };

  const handleScanCapture = (file: File) => {
    playSound('upload');
    const newStudent: StudentData = {
      id: `scan-${Date.now()}`,
      rollNumber: '',
      name: `Scanned Sheet ${students.length + 1}`,
      studentClass: '',
      answerSheet: file,
    };
    setStudents((prev) => [...prev, newStudent]);
    setIsScannerOpen(false);
  };

  const handleStudentDataChange = (id: string, field: keyof StudentData, value: string) => {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const removeStudent = (id: string) => {
    playSound('click');
    setStudents((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => e.preventDefault();
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    handleFilesAdd(e.dataTransfer.files);
  };

  return (
    <>
      {isScannerOpen && (
        <CameraScanner onCapture={handleScanCapture} onClose={() => setIsScannerOpen(false)} />
      )}
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          <FileInput
            id="batch-question-paper"
            slotTag="SLOT 01 • MASTER QP"
            label="Question Paper"
            description="PDF, PNG, JPG, WebP, DOCX, or TXT"
            required={true}
            onFileChange={onQuestionPaperChange}
            accept={ACCEPTED_DOCUMENT_EXTENSIONS}
            currentFile={questionPaperFile}
          />
          <FileInput
            id="batch-reference-doc"
            slotTag="SLOT 02 • ANSWER KEY"
            label="Answer Key / Marking Scheme"
            description={
              isReferenceDocDisabled
                ? 'Bypassed in AI Knowledge mode'
                : 'Official rubric or key (.pdf, .png, .jpg, .docx, .txt)'
            }
            onFileChange={onReferenceDocChange}
            accept={ACCEPTED_DOCUMENT_EXTENSIONS}
            required={!isReferenceDocDisabled}
            disabled={isReferenceDocDisabled}
            disabledTooltip="The Answer Key is not needed for AI Knowledge mode."
            currentFile={referenceDocFile}
          />
        </div>

        <div className="liquid-glass border-glow p-4 sm:p-5 rounded-2xl">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <label className="block text-sm font-bold text-white">
                Student Answer Sheets <span className="text-rose-400">*</span>
              </label>
              <p className="text-xs text-purple-200/60 mt-0.5">
                Mount multiple student PDFs, scans, or camera captures for parallel batch scoring.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-purple-950 border border-purple-500/30 text-purple-200 shrink-0">
              {students.length} QUEUED
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <label
              ref={dropRef}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              htmlFor="student-sheets-upload"
              className="flex-1 flex flex-col items-center justify-center px-5 py-6 border-2 border-purple-500/35 border-dashed rounded-2xl cursor-pointer bg-[#0a0517]/75 hover:bg-purple-950/35 hover:border-purple-400/60 transition-colors text-center"
            >
              <UploadIcon className="h-9 w-9 text-purple-300 mb-2" />
              <p className="text-xs sm:text-sm text-purple-100 font-medium">
                Drag &amp; drop multiple sheets or{' '}
                <span className="text-purple-300 font-bold underline">browse</span>
              </p>
              <p className="text-[11px] text-purple-300/60 mt-1 font-mono">
                PDF • PNG • JPG • DOCX • TXT
              </p>
              <input
                id="student-sheets-upload"
                type="file"
                multiple
                accept={ACCEPTED_DOCUMENT_EXTENSIONS}
                className="sr-only"
                onChange={(e) => handleFilesAdd(e.target.files)}
              />
            </label>

            <button
              type="button"
              onClick={() => {
                playSound('click');
                setIsScannerOpen(true);
              }}
              className="btn-quantix flex sm:flex-col items-center justify-center gap-2 px-5 py-3.5 rounded-2xl text-white sm:w-32 min-h-[46px]"
              aria-label="Scan an answer sheet"
            >
              <CameraIcon className="w-6 h-6" />
              <span className="text-xs font-semibold">Scan Sheet</span>
            </button>
          </div>

          {students.length > 0 && (
            <div className="mt-4 space-y-2.5 max-h-64 overflow-y-auto custom-scrollbar pr-1">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="p-3.5 bg-[#0c061c] rounded-xl space-y-2.5 border border-purple-500/25"
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileIcon className="w-4 h-4 text-purple-300 shrink-0" />
                      <p className="text-xs font-semibold text-white truncate">
                        {student.answerSheet.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStudent(student.id)}
                      className="p-1.5 rounded-lg text-purple-300/70 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                      aria-label={`Remove ${student.answerSheet.name}`}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Roll Number"
                      value={student.rollNumber}
                      onChange={(e) => handleStudentDataChange(student.id, 'rollNumber', e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-[#070312] text-white border border-purple-500/30 focus:outline-none focus:border-purple-400 placeholder:text-purple-300/40"
                    />
                    <input
                      type="text"
                      placeholder="Student Name"
                      value={student.name}
                      onChange={(e) => handleStudentDataChange(student.id, 'name', e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-[#070312] text-white border border-purple-500/30 focus:outline-none focus:border-purple-400 placeholder:text-purple-300/40"
                    />
                    <input
                      type="text"
                      placeholder="Class / Section"
                      value={student.studentClass}
                      onChange={(e) => handleStudentDataChange(student.id, 'studentClass', e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-[#070312] text-white border border-purple-500/30 focus:outline-none focus:border-purple-400 placeholder:text-purple-300/40"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};