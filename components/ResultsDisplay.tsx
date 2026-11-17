import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  GradingResult,
  QuestionResult,
  BatchResultItem,
  Annotation,
  LiveToolEvent,
} from '../types';
import {
  InfoIcon,
  CheckCircleIcon,
  BrainIcon,
  ClipboardIcon,
  XCircleIcon,
  FileIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from './Icons';
import { DocumentViewer, type ViewerAnnotationItem } from './DocumentViewer';
import { playSound } from '../utils/sound';
import { inferMimeType } from '../utils/fileUtils';

const calculateGradeDetails = (
  score: number,
  maxMarks: number,
  isLiveEvaluating = false
) => {
  if (maxMarks <= 0) {
    if (isLiveEvaluating) {
      return { pass_status: 'Evaluating', letter_grade: 'LIVE', special_award: null };
    }
    return { pass_status: 'Fail', letter_grade: 'F', special_award: null };
  }
  const percentage = (score / maxMarks) * 100;
  let letter_grade = 'F';
  if (percentage >= 90) letter_grade = 'A+';
  else if (percentage >= 80) letter_grade = 'A';
  else if (percentage >= 70) letter_grade = 'B';
  else if (percentage >= 60) letter_grade = 'C';
  else if (percentage >= 50) letter_grade = 'D';
  else if (percentage >= 33) letter_grade = 'E';
  return {
    pass_status: percentage >= 33 ? 'Pass' : 'Fail',
    letter_grade,
    special_award: percentage >= 90 ? 'Distinction' : null,
  };
};

const formatQLabel = (id: number | string) => {
  const raw = String(id).trim();
  if (!raw) return 'Q?';
  return /^q\s*/i.test(raw) ? `Q${raw.replace(/^q\s*/i, '')}` : `Q${raw}`;
};

// --- Themed Student Report Studio Analysis Card ---
const AnalysisView: React.FC<{
  result: GradingResult;
  compact?: boolean;
  isLiveEvaluating?: boolean;
}> = ({ result, compact = false, isLiveEvaluating = false }) => {
  const percentage = result.max_marks > 0 ? (result.total_score / result.max_marks) * 100 : 0;
  const avgConfidence =
    result.questions.length > 0
      ? result.questions.reduce((sum, q) => sum + q.confidence, 0) / result.questions.length
      : 0;
  const { letter_grade, pass_status, special_award } = calculateGradeDetails(
    result.total_score,
    result.max_marks,
    isLiveEvaluating
  );

  let confRingColor = '#ef4444';
  let confTextClass = 'text-rose-400';
  if (avgConfidence > 0.85) {
    confRingColor = '#a855f7';
    confTextClass = 'text-purple-300';
  } else if (avgConfidence > 0.7) {
    confRingColor = '#f59e0b';
    confTextClass = 'text-amber-300';
  }

  return (
    <div
      className={`mx-auto w-full ${
        compact ? 'p-0' : 'max-w-5xl p-4 sm:p-6 space-y-6'
      } animate-surface-enter`}
    >
      <div
        className={`liquid-glass border-glow specular-beam rounded-3xl ${
          compact ? 'p-4 sm:p-5' : 'p-5 sm:p-7'
        }`}
      >
        {!compact && (
          <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
            <h3 className="text-lg sm:text-2xl font-bold text-white glow-text flex items-center gap-2.5">
              <ShieldCheckIcon className="w-6 h-6 text-purple-400" />
              <span>Student Report Studio · Performance Audit</span>
            </h3>
            <span className="text-[11px] font-mono text-purple-300/75 uppercase tracking-wider">
              GraderLabs Telemetry
            </span>
          </div>
        )}

        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5`}>
          {/* Overall Score Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#23124c]/90 via-[#13092b]/95 to-[#2d105c]/90 border border-purple-400/35 flex flex-col items-center justify-center text-center relative overflow-hidden">
            {special_award && (
              <div className="absolute top-0 right-0 bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-bl-xl flex items-center gap-1">
                <SparklesIcon className="w-3 h-3" /> {special_award}
              </div>
            )}
            <p className="text-[11px] font-mono font-semibold text-purple-300/80 uppercase tracking-wider mb-1.5">
              Final Score
            </p>
            <p className="text-3xl sm:text-4xl font-extrabold text-white font-mono tabular-nums leading-none mb-2 glow-text">
              {result.total_score}{' '}
              <span className="text-lg sm:text-xl text-purple-300/60">/ {result.max_marks}</span>
            </p>
            <span
              className={`px-3 py-0.5 rounded-full text-xs font-mono font-semibold border ${
                pass_status === 'Evaluating'
                  ? 'bg-purple-500/20 text-purple-200 border-purple-400/40'
                  : pass_status === 'Pass'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                  : 'bg-rose-500/15 text-rose-300 border-rose-400/40'
              }`}
            >
              {pass_status === 'Evaluating' ? 'Live Registering...' : `${pass_status} (${letter_grade})`}
            </span>
          </div>

          {/* AI Confidence Ring Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#0e0720]/85 border border-purple-500/25 flex flex-col items-center justify-center text-center">
            <p className="text-[11px] font-mono font-semibold text-purple-300/75 uppercase tracking-wider mb-1.5">
              LLM Confidence
            </p>
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="rgba(168, 85, 247, 0.16)"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  strokeDasharray={`${avgConfidence * 100}, 100`}
                  stroke={confRingColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-xl sm:text-2xl font-extrabold font-mono tabular-nums ${confTextClass}`}>
                  {Math.round(avgConfidence * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Processing Stats Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#0e0720]/85 border border-purple-500/25 flex flex-col justify-center space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-purple-300/65 uppercase">Latency</span>
              <span className="text-sm font-bold font-mono text-white tabular-nums">
                {result.grading_duration ? `${result.grading_duration.toFixed(2)}s` : 'N/A'}
              </span>
            </div>
            <div className="h-px bg-purple-500/15" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-purple-300/65 uppercase">Questions</span>
              <span className="text-sm font-bold font-mono text-white tabular-nums">
                {result.questions.length}
              </span>
            </div>
            <div className="h-px bg-purple-500/15" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-purple-300/65 uppercase">Score %</span>
              <span className="text-sm font-bold font-mono text-purple-200 tabular-nums">
                {percentage.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Performance Bar */}
        <div className="mt-5">
          <div className="flex justify-between text-xs font-mono text-purple-200/80 mb-1.5 tabular-nums">
            <span>
              {isLiveEvaluating && result.questions.length === 0
                ? 'Awaiting first AI question tool call...'
                : 'Rubric Attainment Scale'}
            </span>
            <span>{percentage.toFixed(0)}% Achieved</span>
          </div>
          <div className="h-2.5 w-full bg-[#130a26] rounded-full overflow-hidden flex relative border border-purple-500/20">
            <div
              className="h-full bg-gradient-to-r from-purple-700 via-purple-500 to-fuchsia-400 shadow-[0_0_16px_rgba(168,85,247,0.75)] transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
            />
          </div>
          {result.speed_fixer_summary && (
            <p className="mt-3 text-xs font-mono text-amber-200/90 bg-amber-950/30 border border-amber-400/25 rounded-xl px-3 py-2">
              Speed Fixer: {result.speed_fixer_summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Question Breakdown Card ---
const QuestionDetail: React.FC<{
  question: QuestionResult;
  isActive: boolean;
  isRecent?: boolean;
  onClick: (id: number | string) => void;
}> = ({ question, isActive, isRecent = false, onClick }) => {
  const marksDeducted = question.full_marks - question.score;
  const isFull = marksDeducted === 0;
  const isPartial = question.score > 0 && marksDeducted > 0;
  const scoreColor = isFull ? 'text-emerald-300' : isPartial ? 'text-amber-300' : 'text-rose-300';

  return (
    <div
      id={`question-detail-${question.question_id}`}
      onClick={() => onClick(question.question_id)}
      className={`liquid-glass border-glow p-4 sm:p-5 rounded-2xl transition-all duration-200 cursor-pointer animate-fade-in ${
        isActive ? 'border-glow-active' : isRecent ? 'ring-1 ring-purple-400/60' : 'hover-lift'
      }`}
    >
      <div className="flex justify-between items-center mb-3 gap-2">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 min-w-[2.5rem] items-center justify-center px-2.5 rounded-xl font-mono font-bold text-xs border ${
              isFull
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                : isPartial
                ? 'bg-amber-500/15 text-amber-300 border-amber-400/40'
                : 'bg-rose-500/15 text-rose-300 border-rose-400/40'
            }`}
          >
            {formatQLabel(question.question_id)}
          </span>
          <div className="flex items-baseline gap-1 font-mono tabular-nums">
            <span className={`text-xl font-extrabold ${scoreColor}`}>{question.score}</span>
            <span className="text-xs font-semibold text-purple-300/55">/ {question.full_marks}</span>
          </div>
        </div>

        <span
          className={`text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full border tabular-nums ${
            question.confidence > 0.8
              ? 'bg-purple-950/90 text-purple-200 border-purple-400/35'
              : 'bg-amber-950/70 text-amber-200 border-amber-400/35'
          }`}
        >
          {Math.round(question.confidence * 100)}% Conf.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[10px] font-mono font-bold text-purple-300/70 mb-1 uppercase tracking-wider flex items-center gap-1.5">
            <BrainIcon className="w-3.5 h-3.5 text-purple-400" /> Question
          </p>
          <p className="text-xs sm:text-sm text-purple-100 line-clamp-2 font-medium leading-relaxed">
            {question.question_text}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-mono font-bold text-purple-300/70 mb-1 uppercase tracking-wider flex items-center gap-1.5">
            <ClipboardIcon className="w-3.5 h-3.5 text-purple-400" /> Student Answer (OCR)
          </p>
          <div className="text-xs font-mono bg-[#080412] p-2.5 rounded-xl border border-purple-500/20 text-purple-100 whitespace-pre-wrap break-words leading-relaxed max-h-24 overflow-y-auto custom-scrollbar">
            {question.student_answer || (
              <span className="text-purple-300/45 italic">(No answer detected)</span>
            )}
          </div>
        </div>
      </div>

      {(question.feedback || marksDeducted > 0) && (
        <div className="text-xs sm:text-sm flex items-start gap-2.5 text-purple-100/90 bg-[#120926]/80 p-3 rounded-xl border border-purple-500/20">
          <InfoIcon className="w-4 h-4 flex-shrink-0 text-purple-400 mt-0.5" />
          <div>
            <p className="font-mono font-bold text-[10px] text-purple-300 mb-0.5 uppercase tracking-wider">
              AI Feedback
            </p>
            <p className="leading-relaxed">{question.feedback || 'No specific feedback provided.'}</p>
          </div>
        </div>
      )}

      {question.fixer_note && (
        <div className="mt-2.5 text-xs font-mono text-amber-200 bg-amber-950/35 border border-amber-400/30 rounded-xl px-3 py-2">
          Speed Fixer: {question.fixer_note}
        </div>
      )}
    </div>
  );
};

type ViewTab = 'report' | 'student' | 'analysis' | 'breakdown' | 'qp' | 'key';

interface ResultsDisplayProps {
  result: GradingResult | null;
  isBatchMode?: boolean;
  batchResults?: BatchResultItem[];
  onClose: () => void;
  questionPaperFile: File | null;
  referenceDocFile: File | null;
  answerSheetFile: File | null;
  isLiveEvaluating?: boolean;
  liveStatus?: string;
  liveThinking?: string;
  liveToolEvents?: LiveToolEvent[];
  recentQuestionId?: number | string | null;
  isSpeedFixer?: boolean;
  liveError?: string | null;
  onStopLive?: () => void;
  batchLiveStates?: Record<string, 'queued' | 'evaluating' | 'done' | 'error'>;
  activeBatchStudentId?: string | null;
}

export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({
  result,
  isBatchMode = false,
  batchResults = [],
  onClose,
  questionPaperFile,
  referenceDocFile,
  answerSheetFile,
  isLiveEvaluating = false,
  liveStatus = '',
  liveThinking = '',
  liveToolEvents = [],
  recentQuestionId = null,
  isSpeedFixer = false,
  liveError = null,
  onStopLive,
  batchLiveStates = {},
  activeBatchStudentId = null,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(activeBatchStudentId);
  const [activeQuestionId, setActiveQuestionId] = useState<number | string | null>(null);
  const [localResult, setLocalResult] = useState<GradingResult | null>(result);
  const [activeTab, setActiveTab] = useState<ViewTab>('report');
  const [targetPage, setTargetPage] = useState<number>(1);
  const [isToolLogExpanded, setIsToolLogExpanded] = useState<boolean>(Boolean(isLiveEvaluating));
  const [followLivePage, setFollowLivePage] = useState<boolean>(true);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLiveEvaluating) {
      setIsToolLogExpanded(true);
    }
  }, [isLiveEvaluating]);

  useEffect(() => {
    if (thinkingScrollRef.current) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
    }
  }, [liveThinking]);

  useEffect(() => {
    if (isLiveEvaluating && activeBatchStudentId) {
      setSelectedStudentId(activeBatchStudentId);
    }
  }, [isLiveEvaluating, activeBatchStudentId]);

  useEffect(() => {
    if (!isBatchMode) {
      setLocalResult(result);
    } else if (selectedStudentId && batchResults.length > 0) {
      const item = batchResults.find((r) => r.student.id === selectedStudentId);
      setLocalResult(item?.result || null);
    } else if (batchResults.length > 0) {
      setLocalResult(batchResults[0].result);
      setSelectedStudentId(batchResults[0].student.id);
    }
  }, [result, isBatchMode, batchResults, selectedStudentId]);

  const activeResult = localResult;

  const handleQuestionClick = useCallback(
    (id: number | string | null) => {
      if (id !== null) playSound('click');
      setActiveQuestionId(id);
      if (id && activeResult) {
        if (['analysis', 'breakdown'].includes(activeTab)) {
          setActiveTab('student');
        }

        const question = activeResult.questions.find((q) => String(q.question_id) === String(id));
        if (question) {
          let annotation: Annotation | undefined;
          if (activeTab === 'qp') annotation = question.qp_annotation;
          else if (activeTab === 'key') annotation = question.ref_annotation;
          else annotation = question.annotation;

          if (annotation && annotation.page_number) {
            setTargetPage(annotation.page_number);
          }
        }
      }
    },
    [activeTab, activeResult]
  );

  const currentFile = useMemo(() => {
    if (activeTab === 'report') {
      return isBatchMode
        ? batchResults.find((r) => r.student.id === selectedStudentId)?.student.answerSheet || null
        : answerSheetFile;
    }
    switch (activeTab) {
      case 'student':
        return isBatchMode
          ? batchResults.find((r) => r.student.id === selectedStudentId)?.student.answerSheet || null
          : answerSheetFile;
      case 'qp':
        return questionPaperFile;
      case 'key':
        return referenceDocFile;
      default:
        return null;
    }
  }, [activeTab, isBatchMode, selectedStudentId, batchResults, answerSheetFile, questionPaperFile, referenceDocFile]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (currentFile) {
      const url = URL.createObjectURL(currentFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [currentFile]);

  const currentMimeType = useMemo(
    () => (currentFile ? inferMimeType(currentFile) : undefined),
    [currentFile]
  );

  // Auto-jump to page of newly registered question during Live Grading when Follow Page is enabled
  useEffect(() => {
    if (!isLiveEvaluating || !followLivePage || recentQuestionId === null || !activeResult) {
      return;
    }
    const q = activeResult.questions.find(
      (item) => String(item.question_id) === String(recentQuestionId)
    );
    if (!q) return;
    const box =
      activeTab === 'qp'
        ? q.qp_annotation
        : activeTab === 'key'
        ? q.ref_annotation
        : q.annotation;
    if (box?.page_number) {
      setTargetPage(box.page_number);
    }
  }, [isLiveEvaluating, followLivePage, recentQuestionId, activeResult, activeTab]);

  const currentAnnotations = useMemo<ViewerAnnotationItem[]>(() => {
    if (!activeResult || !Array.isArray(activeResult.questions)) return [];

    return activeResult.questions
      .map((q) => {
        let box: Annotation | undefined;
        if (activeTab === 'qp') box = q.qp_annotation;
        else if (activeTab === 'key') box = q.ref_annotation;
        else box = q.annotation;

        if (!box) return null;
        return {
          id: q.question_id,
          box,
          score: q.score,
          full_marks: q.full_marks,
          question_text: q.question_text,
          student_answer: q.student_answer,
          feedback: q.feedback,
          confidence: q.confidence,
          fixer_note: q.fixer_note,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }, [activeTab, activeResult]);

  if (
    !isLiveEvaluating &&
    ((isBatchMode && batchResults.length === 0) || (!isBatchMode && !result))
  ) {
    return null;
  }

  const TabButton: React.FC<{
    tab: ViewTab;
    label: string;
    shortLabel?: string;
    icon: React.FC<React.SVGProps<SVGSVGElement>>;
  }> = ({ tab, label, shortLabel, icon: Icon }) => (
    <button
      type="button"
      onClick={() => {
        playSound('click');
        setActiveTab(tab);
      }}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all flex-shrink-0 whitespace-nowrap min-h-[36px] ${
        activeTab === tab
          ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_16px_rgba(147,51,234,0.6)]'
          : 'text-purple-200/75 hover:text-white hover:bg-purple-900/35'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${activeTab === tab ? 'text-white' : 'text-purple-400'}`} />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{shortLabel || label}</span>
    </button>
  );

  const activeDetails = activeResult
    ? calculateGradeDetails(activeResult.total_score, activeResult.max_marks, isLiveEvaluating)
    : null;

  return (
    <div className="fixed inset-0 z-50 w-full h-full flex flex-col bg-[#070510] text-[#f5f3ff] overflow-hidden animate-fade-in">
      {/* Top Bar */}
      <div className="flex-shrink-0 bg-[#0a0516]/95 backdrop-blur-xl border-b border-purple-500/25 flex flex-col z-30">
        <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 gap-2 border-b border-purple-500/15">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                playSound('click');
                onClose();
              }}
              className="flex-shrink-0 px-3 py-1.5 rounded-full bg-[#150c2b] hover:bg-purple-800/40 border border-purple-500/30 text-xs font-semibold text-purple-100 flex items-center gap-1.5 transition-colors min-h-[36px]"
              title="Back to GraderLabs Studio"
            >
              <XCircleIcon className="w-4 h-4 text-purple-300" />
              <span className="hidden sm:inline">Back to Studio</span>
            </button>

            {isBatchMode ? (
              <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x py-0.5 flex-1">
                {batchResults.map((item) => {
                  const state = batchLiveStates[item.student.id];
                  const hasScore = Boolean(item.result && item.result.max_marks > 0);
                  return (
                    <button
                      key={item.student.id}
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setSelectedStudentId(item.student.id);
                      }}
                      className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-all snap-start whitespace-nowrap ${
                        selectedStudentId === item.student.id
                          ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_14px_rgba(147,51,234,0.55)]'
                          : 'bg-[#140b29] text-purple-200 border-purple-500/25 hover:border-purple-400/50'
                      }`}
                    >
                      {state === 'evaluating' && (
                        <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-ping shrink-0" />
                      )}
                      <span className="font-medium truncate max-w-[110px] sm:max-w-[160px]">
                        {item.student.name}
                      </span>
                      {hasScore && item.result ? (
                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full ${
                            calculateGradeDetails(item.result.total_score, item.result.max_marks).pass_status === 'Pass'
                              ? 'bg-emerald-500/25 text-emerald-200'
                              : 'bg-rose-500/25 text-rose-200'
                          }`}
                        >
                          {calculateGradeDetails(item.result.total_score, item.result.max_marks).letter_grade}
                        </span>
                      ) : state === 'evaluating' ? (
                        <span className="text-[10px] font-mono text-purple-200">Live</span>
                      ) : state === 'queued' ? (
                        <span className="text-[10px] font-mono text-purple-300/60">Queued</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircleIcon className="w-5 h-5 text-purple-400 flex-shrink-0" />
                <div className="truncate">
                  <span className="font-bold text-sm sm:text-base shimmer-text truncate">
                    Student Report Studio
                  </span>
                </div>
              </div>
            )}
          </div>

          {activeResult && activeDetails && (
            <div className="flex-shrink-0 flex items-center gap-2.5 px-3 py-1 bg-[#130a26] rounded-2xl border border-purple-500/30">
              <div className="text-right hidden sm:block">
                <p className="text-[9px] font-mono font-bold text-purple-300/65 uppercase tracking-wider leading-tight">
                  {isLiveEvaluating ? 'Live Score' : 'Total Score'}
                </p>
                <p className="text-base font-extrabold text-white font-mono tabular-nums leading-none">
                  {activeResult.total_score}{' '}
                  <span className="text-xs text-purple-300/60 font-semibold">/ {activeResult.max_marks}</span>
                </p>
              </div>
              <div
                className={`h-8 px-2.5 flex items-center justify-center rounded-xl text-sm font-mono font-extrabold border tabular-nums ${
                  activeDetails.pass_status === 'Evaluating'
                    ? 'bg-purple-500/20 text-purple-200 border-purple-400/45'
                    : activeDetails.pass_status === 'Pass'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                    : 'bg-rose-500/15 text-rose-300 border-rose-400/40'
                }`}
              >
                {activeDetails.letter_grade}
              </div>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center justify-start px-3 sm:px-5 py-1.5 gap-1.5 overflow-x-auto no-scrollbar bg-[#070310]">
          <TabButton tab="report" label="Full Report" shortLabel="Report" icon={SparklesIcon} />
          <TabButton tab="student" label="Student Sheet" shortLabel="Sheet" icon={FileIcon} />
          <TabButton tab="qp" label="Question Paper" shortLabel="QP" icon={FileIcon} />
          <TabButton tab="key" label="Answer Key" shortLabel="Key" icon={CheckCircleIcon} />
          <TabButton tab="breakdown" label="Detailed Breakdown" shortLabel="Questions" icon={ClipboardIcon} />
          <TabButton tab="analysis" label="Analysis Studio" shortLabel="Analysis" icon={ShieldCheckIcon} />
        </div>

        {/* Live AI Evaluation, Thinking & Tool-Call Telemetry Strip */}
        {(isLiveEvaluating || liveToolEvents.length > 0 || liveThinking.length > 0 || liveError) && (
          <div className="border-t border-purple-500/20 bg-[#0d061f]/95 px-3 sm:px-5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {isLiveEvaluating ? (
                  <span className="inline-flex items-center gap-1.5 text-fuchsia-300 font-mono font-semibold shrink-0">
                    <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-ping" />
                    <span>LIVE GRADING</span>
                  </span>
                ) : liveError ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-300 font-mono font-semibold shrink-0">
                    <span>LIVE HALTED</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-emerald-300 font-mono font-semibold shrink-0">
                    <span>EVALUATION COMPLETE</span>
                  </span>
                )}

                {isSpeedFixer && (
                  <span className="text-[11px] font-mono text-amber-300 shrink-0">
                    · Speed Fixer
                  </span>
                )}

                <span className="text-purple-200/80 truncate">
                  {liveError
                    ? liveError
                    : isLiveEvaluating
                    ? liveStatus || 'Streaming AI thinking & tool calls...'
                    : `${activeResult?.questions.length || 0} question(s) registered · ${
                        activeResult?.total_score ?? 0
                      }/${activeResult?.max_marks ?? 0} marks`}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isLiveEvaluating && (
                  <button
                    type="button"
                    onClick={() => setFollowLivePage((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition whitespace-nowrap ${
                      followLivePage
                        ? 'bg-purple-600/30 border-purple-400/50 text-purple-100'
                        : 'bg-[#150c2b] border-purple-500/25 text-purple-300/70'
                    }`}
                    title="Automatically follow newly annotated pages"
                  >
                    {followLivePage ? 'Auto-Follow Page' : 'Manual Page'}
                  </button>
                )}

                {(isLiveEvaluating || liveToolEvents.length > 0 || liveThinking.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setIsToolLogExpanded((v) => !v)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-[#150c2b] border border-purple-500/30 text-purple-200 hover:text-white transition whitespace-nowrap tabular-nums"
                  >
                    Thinking &amp; Tools ({liveToolEvents.length}) {isToolLogExpanded ? '▲' : '▼'}
                  </button>
                )}

                {isLiveEvaluating && onStopLive && (
                  <button
                    type="button"
                    onClick={onStopLive}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-rose-950/60 border border-rose-400/40 text-rose-200 hover:bg-rose-900/60 transition whitespace-nowrap"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>

            {isToolLogExpanded &&
              (isLiveEvaluating || liveThinking.length > 0 || liveToolEvents.length > 0) && (
                <div className="mt-2 pt-2 border-t border-purple-500/15 grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {/* Live Model Thinking Stream */}
                  <div className="bg-[#080414]/90 border border-purple-500/25 rounded-xl p-2.5 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-purple-300">
                        <BrainIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                        <span>Model Thinking Stream</span>
                      </span>
                      {isLiveEvaluating && (
                        <span className="text-[10px] font-mono text-fuchsia-300/85">
                          Streaming...
                        </span>
                      )}
                    </div>
                    <div
                      ref={thinkingScrollRef}
                      className="max-h-28 overflow-y-auto custom-scrollbar text-[11px] font-mono text-purple-100/85 whitespace-pre-wrap break-words leading-relaxed"
                    >
                      {liveThinking ? (
                        liveThinking
                      ) : (
                        <span className="text-purple-300/50 italic">
                          {isLiveEvaluating
                            ? 'Awaiting model thinking tokens...'
                            : 'No model reasoning captured for this run.'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Live AI Tool Calls */}
                  <div className="bg-[#080414]/90 border border-purple-500/25 rounded-xl p-2.5 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-purple-300">
                        AI Tool Calls ({liveToolEvents.length})
                      </span>
                      {liveToolEvents.length > 0 && (
                        <span className="text-[10px] font-mono text-purple-300/65">
                          Click a question to inspect
                        </span>
                      )}
                    </div>
                    <div className="max-h-28 overflow-y-auto custom-scrollbar space-y-1.5">
                      {liveToolEvents.length === 0 ? (
                        <p className="text-[11px] font-mono text-purple-300/50 italic">
                          {isLiveEvaluating
                            ? 'Waiting for first question evaluation tool call...'
                            : 'No tool calls recorded.'}
                        </p>
                      ) : (
                        [...liveToolEvents].reverse().map((evt) => (
                          <div
                            key={evt.id}
                            onClick={() => {
                              if (evt.questionId !== undefined) {
                                handleQuestionClick(evt.questionId);
                              }
                            }}
                            className={`flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-[11px] font-mono border transition ${
                              evt.questionId !== undefined
                                ? 'cursor-pointer hover:bg-purple-900/35'
                                : ''
                            } ${
                              evt.status === 'fixed'
                                ? 'bg-amber-950/25 border-amber-400/30 text-amber-200'
                                : 'bg-[#120a24] border-purple-500/20 text-purple-100'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-purple-400 shrink-0">{evt.toolName}</span>
                              <span className="truncate">{evt.summary}</span>
                            </div>
                            <span className="text-purple-300/60 shrink-0 tabular-nums">
                              {evt.timestamp}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-grow relative overflow-y-auto custom-scrollbar bg-[#05030b]">
        {activeTab === 'report' && activeResult && (
          <div className="w-full h-full flex flex-col">
            <div className="flex-grow relative">
              <DocumentViewer
                file={currentFile}
                previewUrl={previewUrl}
                mimeType={currentMimeType}
                annotations={currentAnnotations}
                activeQuestionId={activeQuestionId}
                recentQuestionId={recentQuestionId}
                isLiveEvaluating={isLiveEvaluating}
                onQuestionClick={handleQuestionClick}
                showAnnotations={true}
                targetPage={targetPage}
                scrollMode={true}
                emptyMessage="Student sheet not available."
                header={
                  <AnalysisView
                    result={activeResult}
                    compact={true}
                    isLiveEvaluating={isLiveEvaluating}
                  />
                }
              />
            </div>
          </div>
        )}

        {activeTab === 'analysis' && activeResult && (
          <AnalysisView result={activeResult} isLiveEvaluating={isLiveEvaluating} />
        )}

        {activeTab === 'breakdown' && activeResult && (
          <div className="max-w-5xl mx-auto w-full space-y-4 p-4 sm:p-6 animate-surface-enter">
            {activeResult.teacher_overall_comments && (
              <div className="liquid-glass border-glow specular-beam p-5 rounded-2xl mb-4">
                <p className="font-bold text-sm sm:text-base text-purple-200 mb-1.5 flex items-center gap-2">
                  <InfoIcon className="w-5 h-5 text-purple-400" /> Overall AI Feedback
                </p>
                <p className="text-purple-100/85 italic leading-relaxed text-xs sm:text-sm">
                  &ldquo;{activeResult.teacher_overall_comments}&rdquo;
                </p>
              </div>
            )}
            {activeResult.questions.length === 0 && isLiveEvaluating && (
              <div className="liquid-glass border-glow p-6 rounded-2xl text-center text-xs font-mono text-purple-200/80">
                Waiting for AI question tool calls to register answers &amp; marks live...
              </div>
            )}
            <div className="space-y-3.5">
              {activeResult.questions.map((q, index) => (
                <QuestionDetail
                  key={`${q.question_id}-${index}`}
                  question={q}
                  isActive={activeQuestionId !== null && String(activeQuestionId) === String(q.question_id)}
                  isRecent={recentQuestionId !== null && String(recentQuestionId) === String(q.question_id)}
                  onClick={handleQuestionClick}
                />
              ))}
            </div>
          </div>
        )}

        {['student', 'qp', 'key'].includes(activeTab) && (
          <div className="absolute inset-0">
            <DocumentViewer
              file={currentFile}
              previewUrl={previewUrl}
              mimeType={currentMimeType}
              annotations={currentAnnotations}
              activeQuestionId={activeQuestionId}
              recentQuestionId={recentQuestionId}
              isLiveEvaluating={isLiveEvaluating}
              onQuestionClick={handleQuestionClick}
              showAnnotations={true}
              targetPage={targetPage}
              scrollMode={false}
              emptyMessage={
                activeTab === 'key'
                  ? 'No Answer Key provided for this grading mode.'
                  : 'Document not available.'
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};
