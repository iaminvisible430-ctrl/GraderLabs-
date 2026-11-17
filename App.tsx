import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import './utils/pdfUtils';
import {
  isPdfFile,
  inferMimeType,
  resolveEffectiveMimeType,
  isImageMime,
  optimizeImageForApi,
  readDocumentAsText,
  ACCEPTED_DOCUMENT_EXTENSIONS,
} from './utils/fileUtils';

import { LandingPage } from './components/LandingPage';
import { BatchUpload } from './components/BatchUpload';
import { GradingProgress } from './components/GradingProgress';
import { ResultsDisplay } from './components/ResultsDisplay';
import { OMRTemplateEditor } from './components/OMRTemplateEditor';
import { ReferenceLibrary } from './components/ReferenceLibrary';
import { CameraScanner } from './components/CameraScanner';
import { McpConnectModal } from './components/McpConnectModal';
import {
  LogoIcon,
  BookOpenIcon,
  PencilIcon,
  CameraIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from './components/Icons';
import {
  gradeAnswers,
  gradeAnswersLive,
  extractTextAndLayoutFromFile,
  performHandwrittenOCR,
  renderPdfFallbackPages,
} from './services/geminiService';
import { DEMO_QUESTION_PAPER } from './demo/question_paper';
import { DEMO_ANSWER_KEY } from './demo/answer_key';
import { DEMO_STUDENT_SHEET } from './demo/student_sheet';
import { GradingMode } from './types';
import type {
  GradingResult,
  StudentData,
  BatchResultItem,
  BoundingBox,
  QuestionResult,
  LiveToolEvent,
} from './types';
import { playSound, isSoundEnabled, setSoundEnabled } from './utils/sound';

type BaseEvalMode = 'omr' | 'written' | 'hybrid';
type PrecisionTier = 'pro' | 'fast';
type SpecialMode = 'none' | 'forensic' | 'ai_knowledge' | 'speed_fixer';
type WorkspaceTab = 'dashboard' | 'studio';
type SlotKey = 'qp' | 'ak' | 'ss';

interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface EvaluationRunRecord {
  id: string;
  label: string;
  timestamp: string;
  createdAt?: string;
  modeLabel: string;
  baseMode: BaseEvalMode;
  isBatch: boolean;
  sheetsCount: number;
  questionsCount: number;
  omrCount: number;
  writtenCount: number;
  avgPercentage: number;
  totalScore: number;
  maxMarks: number;
  source?: 'app' | 'mcp';
  agentName?: string;
  singleResult: GradingResult | null;
  batchResults: BatchResultItem[];
  questionPaper: File | null;
  referenceDoc: File | null;
  answerSheet: File | null;
}

const formatFileSize = (file: File | null): string => {
  if (!file) return '0 MB';
  const kb = file.size / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
};

function App() {
  // Auth & Navigation State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('evaluator@graderlabs.ai');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('dashboard');
  const [portalState, setPortalState] = useState<{
    visible: boolean;
    title: string;
    subtitle: string;
  }>({ visible: false, title: '', subtitle: '' });

  // Sound & Toast State
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Studio Mode State
  const [baseMode, setBaseMode] = useState<BaseEvalMode>('hybrid');
  const [precisionTier, setPrecisionTier] = useState<PrecisionTier>('pro');
  const [specialMode, setSpecialMode] = useState<SpecialMode>('none');
  const [liveGradingEnabled, setLiveGradingEnabled] = useState<boolean>(true);
  const [isBatchMode, setIsBatchMode] = useState(false);

  // Document Files State (Starts strictly at 0/empty)
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [referenceDoc, setReferenceDoc] = useState<File | null>(null);
  const [answerSheet, setAnswerSheet] = useState<File | null>(null);
  const [batchStudents, setBatchStudents] = useState<StudentData[]>([]);
  const [slotSkeletons, setSlotSkeletons] = useState<Record<SlotKey, boolean>>({
    qp: false,
    ak: false,
    ss: false,
  });

  // OMR ROI & Auxiliary Modals
  const [omrBoundingBoxes, setOmrBoundingBoxes] = useState<BoundingBox[]>([]);
  const [isOmrEditorOpen, setIsOmrEditorOpen] = useState(false);
  const [omrTemplate, setOmrTemplate] = useState<File | null>(null);
  const [showReferenceLibrary, setShowReferenceLibrary] = useState(false);
  const [isSingleScannerOpen, setIsSingleScannerOpen] = useState(false);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);

  // Evaluation Execution & Results State
  const [isLoading, setIsLoading] = useState(false);
  const [gradingSteps, setGradingSteps] = useState<string[]>([]);
  const [gradingPercentage, setGradingPercentage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResultItem[]>([]);
  const [isReportStudioOpen, setIsReportStudioOpen] = useState(false);

  // Live Grading Stream State
  const [isLiveEvaluating, setIsLiveEvaluating] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [liveThinking, setLiveThinking] = useState('');
  const [liveToolEvents, setLiveToolEvents] = useState<LiveToolEvent[]>([]);
  const [recentQuestionId, setRecentQuestionId] = useState<number | string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [batchLiveStates, setBatchLiveStates] = useState<
    Record<string, 'queued' | 'evaluating' | 'done' | 'error'>
  >({});
  const [activeBatchStudentId, setActiveBatchStudentId] = useState<string | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const recentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real Session Telemetry History (Starts strictly at 0 unless persisted history exists)
  const [evalHistory, setEvalHistory] = useState<EvaluationRunRecord[]>([]);
  const syncedFileCacheRef = useRef<
    Map<
      string,
      {
        name: string;
        mimeType: string;
        size: number;
        textContent: string;
        pageCount: number;
        pages: string[];
      }
    >
  >(new Map());

  // Native File Pickers
  const qpInputRef = useRef<HTMLInputElement>(null);
  const akInputRef = useRef<HTMLInputElement>(null);
  const ssInputRef = useRef<HTMLInputElement>(null);

  const gradingMode: GradingMode = useMemo(() => {
    if (specialMode === 'speed_fixer') return GradingMode.SPEED_FIXER;
    if (specialMode === 'forensic') return GradingMode.GEMINI_3_FORENSIC;
    if (specialMode === 'ai_knowledge') return GradingMode.AI_KNOWLEDGE;
    if (precisionTier === 'pro') {
      if (baseMode === 'omr') return GradingMode.GEMINI_3_OMR;
      if (baseMode === 'written') return GradingMode.GEMINI_3_HANDWRITTEN;
      return GradingMode.GEMINI_3_HYBRID;
    } else {
      if (baseMode === 'omr') return GradingMode.FAST_OMR;
      if (baseMode === 'written') return GradingMode.FAST_HANDWRITTEN;
      return GradingMode.FAST_HYBRID;
    }
  }, [baseMode, precisionTier, specialMode]);

  const activeModeLabel = useMemo(() => {
    if (specialMode === 'speed_fixer') return 'Speed Fixer Mode (Rapid Auto-Repair)';
    if (specialMode === 'forensic') return 'Forensic Audit (VIP Deep Inspection)';
    if (specialMode === 'ai_knowledge') return 'AI Knowledge Evaluation (No Key)';
    if (baseMode === 'omr') return 'OMR Evaluation (Optical Matrix)';
    if (baseMode === 'written') return 'Written Evaluation (Handwriting LLM)';
    return 'OMR + Written (Auto Detection)';
  }, [baseMode, specialMode]);

  const pushToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const persistRunRecordToServer = useCallback((record: EvaluationRunRecord) => {
    fetch('/api/studio/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: record.id,
        label: record.label,
        timestamp: record.timestamp,
        createdAt: record.createdAt || new Date().toISOString(),
        modeLabel: record.modeLabel,
        baseMode: record.baseMode,
        isBatch: record.isBatch,
        sheetsCount: record.sheetsCount,
        questionsCount: record.questionsCount,
        omrCount: record.omrCount,
        writtenCount: record.writtenCount,
        avgPercentage: record.avgPercentage,
        totalScore: record.totalScore,
        maxMarks: record.maxMarks,
        source: record.source || 'app',
        agentName: record.agentName,
        documentNames: {
          questionPaper: record.questionPaper?.name,
          answerKey: record.referenceDoc?.name,
          answerSheet: record.answerSheet?.name,
        },
        singleResult: record.singleResult,
      }),
    }).catch(() => {});
  }, []);

  const serializeFileForWorkspaceSync = useCallback(async (file: File) => {
    const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
    const cached = syncedFileCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const mimeType = await resolveEffectiveMimeType(file);
    let textContent = '';
    let pages: string[] = [];

    if (isPdfFile(file, mimeType)) {
      const [extractedText, renderedPages] = await Promise.all([
        extractTextAndLayoutFromFile(file).catch(() => undefined),
        renderPdfFallbackPages(file, 8, 2500).catch(() => []),
      ]);
      textContent = extractedText || '';
      pages = renderedPages
        .map((p) => p.inlineData?.data || '')
        .filter((d) => d.length > 0);
    } else if (isImageMime(mimeType)) {
      const optimized = await optimizeImageForApi(file, mimeType).catch(() => null);
      if (optimized?.data) pages = [optimized.data];
    } else {
      textContent = await readDocumentAsText(file, mimeType).catch(() => '');
    }

    const payload = {
      name: file.name,
      mimeType,
      size: file.size,
      textContent,
      pageCount: Math.max(1, pages.length),
      pages,
    };
    syncedFileCacheRef.current.set(cacheKey, payload);
    return payload;
  }, []);

  // Load persisted Studio Evaluation History on startup
  useEffect(() => {
    let active = true;
    fetch('/api/studio/history')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data || !Array.isArray(data.history) || data.history.length === 0) return;
        setEvalHistory((prev) => {
          const existingMap = new Map<string, EvaluationRunRecord>(prev.map((r) => [r.id, r]));
          return data.history.map((srv: any) => {
            const local = existingMap.get(srv.id);
            return {
              id: srv.id,
              label: srv.label,
              timestamp: srv.timestamp,
              createdAt: srv.createdAt,
              modeLabel: srv.modeLabel,
              baseMode: srv.baseMode || 'hybrid',
              isBatch: Boolean(srv.isBatch),
              sheetsCount: Number(srv.sheetsCount) || 1,
              questionsCount: Number(srv.questionsCount) || 0,
              omrCount: Number(srv.omrCount) || 0,
              writtenCount: Number(srv.writtenCount) || 0,
              avgPercentage: Number(srv.avgPercentage) || 0,
              totalScore: Number(srv.totalScore) || 0,
              maxMarks: Number(srv.maxMarks) || 0,
              source: srv.source || 'app',
              agentName: srv.agentName,
              singleResult: srv.singleResult || local?.singleResult || null,
              batchResults: local?.batchResults || [],
              questionPaper: local?.questionPaper || null,
              referenceDoc: local?.referenceDoc || null,
              answerSheet: local?.answerSheet || null,
            } as EvaluationRunRecord;
          });
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Auto-sync mounted Studio documents to backend so external MCP AI agents can inspect them directly
  useEffect(() => {
    let cancelled = false;
    const syncNow = async () => {
      try {
        const [qpSlot, akSlot, ssSlots] = await Promise.all([
          questionPaper ? serializeFileForWorkspaceSync(questionPaper) : Promise.resolve(null),
          referenceDoc ? serializeFileForWorkspaceSync(referenceDoc) : Promise.resolve(null),
          isBatchMode
            ? Promise.all(
                batchStudents.map(async (s) => ({
                  ...(await serializeFileForWorkspaceSync(s.answerSheet)),
                  studentId: s.id,
                  rollNumber: s.rollNumber,
                  studentClass: s.studentClass,
                }))
              )
            : answerSheet
            ? serializeFileForWorkspaceSync(answerSheet).then((doc) => [
                { ...doc, studentId: 'single-student' },
              ])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        await fetch('/api/studio/sync-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionPaper: qpSlot,
            answerKey: akSlot,
            studentSheets: ssSlots,
            modeLabel: activeModeLabel,
            baseMode,
            specialMode,
            omrBoundingBoxes,
          }),
        });
      } catch {
        // Ignore transient sync errors
      }
    };
    syncNow();
    return () => {
      cancelled = true;
    };
  }, [
    questionPaper,
    referenceDoc,
    answerSheet,
    batchStudents,
    isBatchMode,
    activeModeLabel,
    baseMode,
    specialMode,
    omrBoundingBoxes,
    serializeFileForWorkspaceSync,
  ]);

  // Subscribe to real-time MCP live studio events (/api/studio/events)
  useEffect(() => {
    const source = new EventSource('/api/studio/events');

    source.addEventListener('mcp_session_started', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setError(null);
        setLiveError(null);
        setIsBatchMode(false);
        setBatchResults([]);
        setIsLiveEvaluating(true);
        setLiveThinking(data.thinking || `Connected MCP AI (${data.agentName || 'External AI'}) evaluating...`);
        setLiveToolEvents(data.toolEvent ? [data.toolEvent] : []);
        setLiveStatus(`MCP Live · ${data.agentName || 'Connected AI'} evaluating ${data.studentName || 'Exam'}...`);
        setResult({
          total_score: 0,
          max_marks: 0,
          pass_status: 'Evaluating',
          letter_grade: 'LIVE',
          special_award: null,
          questions: [],
        });
        setIsReportStudioOpen(true);
        pushToast(`MCP Agent (${data.agentName || 'External AI'}) opened Live Studio.`, 'info');
      } catch {
        // Ignore parse error
      }
    });

    source.addEventListener('mcp_tool_call', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.toolEvent) {
          setLiveToolEvents((prev) => [...prev, data.toolEvent]);
        }
      } catch {
        // Ignore parse error
      }
    });

    source.addEventListener('mcp_question_graded', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        const q = data.question as QuestionResult | undefined;
        if (!q) return;
        if (data.toolEvent) {
          setLiveToolEvents((prev) => [...prev, data.toolEvent]);
        }
        setRecentQuestionId(q.question_id);
        if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
        recentTimerRef.current = setTimeout(() => setRecentQuestionId(null), 1800);

        setLiveStatus(
          `MCP (${data.agentName || 'AI'}) registered Q${q.question_id} · Running total: ${data.total_score}/${data.max_marks}`
        );
        setResult((prev) => {
          const base: GradingResult = prev || {
            total_score: 0,
            max_marks: 0,
            pass_status: 'Evaluating',
            letter_grade: 'LIVE',
            special_award: null,
            questions: [],
          };
          const idx = base.questions.findIndex(
            (item) => String(item.question_id).toLowerCase() === String(q.question_id).toLowerCase()
          );
          const nextQuestions =
            idx >= 0 ? base.questions.map((item, i) => (i === idx ? q : item)) : [...base.questions, q];
          return {
            ...base,
            total_score: Number(data.total_score) || 0,
            max_marks: Number(data.max_marks) || 0,
            questions: nextQuestions,
          };
        });
        setIsReportStudioOpen(true);
      } catch {
        // Ignore parse error
      }
    });

    source.addEventListener('mcp_session_completed', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.toolEvent) {
          setLiveToolEvents((prev) => [...prev, data.toolEvent]);
        }
        if (data.result) {
          setResult(data.result as GradingResult);
        }
        setIsLiveEvaluating(false);
        setLiveStatus(`MCP Evaluation Complete (${data.agentName || 'External AI'})`);
        if (data.record) {
          const rec = data.record as any;
          setEvalHistory((prev) => {
            if (prev.some((r) => r.id === rec.id)) return prev;
            return [
              ...prev,
              {
                ...rec,
                batchResults: [],
                questionPaper: null,
                referenceDoc: null,
                answerSheet: null,
              } as EvaluationRunRecord,
            ];
          });
          playSound('success');
          pushToast(
            `MCP Evaluation saved: ${rec.totalScore}/${rec.maxMarks} (${rec.avgPercentage}%).`,
            'success'
          );
        }
      } catch {
        // Ignore parse error
      }
    });

    return () => {
      source.close();
    };
  }, [pushToast]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) playSound('click');
    pushToast(next ? 'UI Sound Effects enabled.' : 'UI Sound Effects muted.', 'info');
  };

  const showPortalTransition = (
    title: string,
    subtitle: string,
    durationMs: number,
    callback: () => void
  ) => {
    setPortalState({ visible: true, title, subtitle });
    setTimeout(() => {
      callback();
      setPortalState({ visible: false, title: '', subtitle: '' });
    }, durationMs);
  };

  const handleSignIn = (email: string) => {
    setUserEmail(email);
    showPortalTransition(
      'Initializing GraderLabs Workspace...',
      'Authenticating Session • All Dashboard Metrics at 0',
      800,
      () => {
        setIsAuthenticated(true);
        setWorkspaceTab('dashboard');
        playSound('success');
        pushToast(`Signed in as ${email}. Clean workspace at 0 ready.`, 'success');
      }
    );
  };

  const handleSignOut = () => {
    playSound('click');
    setIsAuthenticated(false);
    setIsReportStudioOpen(false);
    pushToast('Signed out to landing page.', 'info');
  };

  const enterStudioWithAnimation = () => {
    playSound('portal');
    if (workspaceTab === 'studio') return;
    showPortalTransition(
      'Launching GraderLabs Evaluation Studio...',
      'Mounting OMR + Written Auto-Detection Pipelines',
      650,
      () => {
        setWorkspaceTab('studio');
      }
    );
  };

  const mountFileWithSkeleton = (slot: SlotKey, file: File, silentToast = false) => {
    if (file.size === 0) {
      pushToast(`Cannot mount "${file.name}" because the file is empty (0 bytes).`, 'error');
      return;
    }
    playSound('upload');
    setSlotSkeletons((prev) => ({ ...prev, [slot]: true }));
    setTimeout(() => {
      setSlotSkeletons((prev) => ({ ...prev, [slot]: false }));
      if (slot === 'qp') setQuestionPaper(file);
      if (slot === 'ak') setReferenceDoc(file);
      if (slot === 'ss') setAnswerSheet(file);
      if (!silentToast) {
        pushToast(`Mounted "${file.name}" (${formatFileSize(file)}).`, 'success');
      }
    }, 360);
  };

  const handleSlotFileChange = (slot: SlotKey, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      mountFileWithSkeleton(slot, file);
    }
    e.target.value = '';
  };

  const handleSlotDrop = (slot: SlotKey, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      mountFileWithSkeleton(slot, file);
    }
  };

  const handleQuickDemoSlot = (slot: SlotKey) => {
    if (slot === 'qp') {
      mountFileWithSkeleton('qp', new File([DEMO_QUESTION_PAPER], 'Demo_Question_Paper.txt', { type: 'text/plain' }));
    } else if (slot === 'ak') {
      mountFileWithSkeleton('ak', new File([DEMO_ANSWER_KEY], 'Demo_Answer_Key.txt', { type: 'text/plain' }));
    } else {
      mountFileWithSkeleton('ss', new File([DEMO_STUDENT_SHEET], 'Demo_Student_Sheet.txt', { type: 'text/plain' }));
    }
  };

  const handleLoadAllDemo = () => {
    handleQuickDemoSlot('qp');
    if (specialMode !== 'ai_knowledge') {
      handleQuickDemoSlot('ak');
    }
    handleQuickDemoSlot('ss');
    setBaseMode('written');
    setSpecialMode('none');
    pushToast('Sample demo exam assets mounted into Studio slots.', 'info');
  };

  const resetStudioToZero = () => {
    playSound('click');
    setQuestionPaper(null);
    setReferenceDoc(null);
    setAnswerSheet(null);
    setBatchStudents([]);
    setOmrBoundingBoxes([]);
    setResult(null);
    setBatchResults([]);
    setGradingSteps([]);
    setGradingPercentage(0);
    setError(null);
    setIsReportStudioOpen(false);
    pushToast('Evaluation Studio reset to 0 uploaded documents.', 'info');
  };

  const openOmrEditor = () => {
    playSound('click');
    if (answerSheet) {
      setOmrTemplate(answerSheet);
      setIsOmrEditorOpen(true);
    } else if (questionPaper) {
      setOmrTemplate(questionPaper);
      setIsOmrEditorOpen(true);
    } else if (batchStudents.length > 0) {
      setOmrTemplate(batchStudents[0].answerSheet);
      setIsOmrEditorOpen(true);
    } else {
      pushToast('Mount a Question Paper or Student Sheet first to calibrate OMR zones.', 'error');
    }
  };

  const flashRecentQuestion = (qid: number | string) => {
    setRecentQuestionId(qid);
    if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
    recentTimerRef.current = setTimeout(() => {
      setRecentQuestionId(null);
    }, 2400);
  };

  const handleStopLive = () => {
    if (liveAbortRef.current) {
      liveAbortRef.current.abort();
      liveAbortRef.current = null;
    }
    setIsLiveEvaluating(false);
    setIsLoading(false);
    setLiveStatus('Live grading stopped by user.');
    pushToast('Live grading stream stopped.', 'info');
  };

  const handleGrade = async () => {
    if (liveAbortRef.current) {
      liveAbortRef.current.abort();
      liveAbortRef.current = null;
    }

    setIsLoading(true);
    setError(null);
    setLiveError(null);
    setResult(null);
    setBatchResults([]);
    setGradingSteps([]);
    setGradingPercentage(0);
    setLiveThinking('');
    setLiveToolEvents([]);
    setRecentQuestionId(null);
    setBatchLiveStates({});
    setActiveBatchStudentId(null);

    const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        promise.catch(() => fallback),
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    const abortController = new AbortController();
    liveAbortRef.current = abortController;
    const activeBoxes =
      baseMode === 'omr' || baseMode === 'hybrid' ? omrBoundingBoxes : undefined;
    const isSpeedFixer = specialMode === 'speed_fixer';

    try {
      if (!questionPaper) throw new Error('Please upload a Question Paper in Slot 01.');
      if (gradingMode !== GradingMode.AI_KNOWLEDGE && !referenceDoc) {
        throw new Error('Please upload an Answer Key in Slot 02 (or enable AI Knowledge mode).');
      }

      if (isBatchMode) {
        if (batchStudents.length === 0) {
          throw new Error('Please upload at least one student answer sheet for batch grading.');
        }

        if (liveGradingEnabled) {
          const initialBatch: BatchResultItem[] = batchStudents.map((student) => ({
            student,
            result: {
              total_score: 0,
              max_marks: 0,
              pass_status: 'Evaluating',
              letter_grade: 'LIVE',
              special_award: null,
              questions: [],
            },
            previewUrl: '',
            answerSheetMimeType: inferMimeType(student.answerSheet),
          }));
          const initialStates: Record<string, 'queued' | 'evaluating' | 'done' | 'error'> = {};
          for (const s of batchStudents) initialStates[s.id] = 'queued';

          setBatchResults(initialBatch);
          setBatchLiveStates(initialStates);
          setActiveBatchStudentId(batchStudents[0].id);
          setIsLiveEvaluating(true);
          setLiveStatus(`Studio opened · Preparing ${batchStudents.length} sheet(s)...`);
          setIsReportStudioOpen(true);

          const [qpOcrData, refOcrData] = await Promise.all([
            isPdfFile(questionPaper)
              ? withTimeout(extractTextAndLayoutFromFile(questionPaper), 900, undefined)
              : Promise.resolve(undefined),
            referenceDoc && isPdfFile(referenceDoc)
              ? withTimeout(extractTextAndLayoutFromFile(referenceDoc), 900, undefined)
              : Promise.resolve(undefined),
          ]);

          let completed = 0;
          const total = batchStudents.length;
          const workingBatch = [...initialBatch];

          for (let i = 0; i < batchStudents.length; i++) {
            if (abortController.signal.aborted) break;
            const student = batchStudents[i];
            setActiveBatchStudentId(student.id);
            setBatchLiveStates((prev) => ({ ...prev, [student.id]: 'evaluating' }));
            if (i > 0) {
              setLiveThinking((prev) =>
                prev ? `${prev}\n\n── ${student.name || student.answerSheet.name} ──\n` : ''
              );
            }
            setLiveStatus(
              `Live grading ${student.name || student.answerSheet.name} (${i + 1}/${total})...`
            );

            try {
              const startTime = Date.now();
              const studentOcrData = isPdfFile(student.answerSheet)
                ? await withTimeout(extractTextAndLayoutFromFile(student.answerSheet), 900, undefined)
                : undefined;

              const studentLiveRes = await gradeAnswersLive(
                student.answerSheet,
                referenceDoc,
                questionPaper,
                gradingMode,
                {
                  onStatus: (msg) => setLiveStatus(`${student.name}: ${msg}`),
                  onThinking: (delta) => setLiveThinking((prev) => prev + delta),
                  onToolCall: (evt) => {
                    setLiveToolEvents((prev) => [
                      ...prev,
                      { ...evt, summary: `[${student.name}] ${evt.summary}` },
                    ]);
                  },
                  onQuestionGraded: (question, runningScore, runningMax) => {
                    flashRecentQuestion(question.question_id);
                    playSound('upload');
                    setBatchResults((prev) =>
                      prev.map((item) => {
                        if (item.student.id !== student.id) return item;
                        const existingQs = item.result?.questions || [];
                        const idx = existingQs.findIndex(
                          (q) =>
                            String(q.question_id).toLowerCase() ===
                            String(question.question_id).toLowerCase()
                        );
                        const nextQs =
                          idx >= 0
                            ? existingQs.map((q, j) => (j === idx ? question : q))
                            : [...existingQs, question];
                        return {
                          ...item,
                          result: {
                            total_score: runningScore,
                            max_marks: runningMax,
                            pass_status: 'Evaluating',
                            letter_grade: 'LIVE',
                            special_award: null,
                            questions: nextQs,
                          },
                        };
                      })
                    );
                  },
                },
                {
                  boundingBoxes: activeBoxes,
                  studentOcrData,
                  qpOcrData,
                  refOcrData,
                  baseHint: baseMode,
                  signal: abortController.signal,
                }
              );

              studentLiveRes.grading_duration = (Date.now() - startTime) / 1000;
              workingBatch[i] = {
                ...workingBatch[i],
                result: studentLiveRes,
              };
              setBatchResults((prev) =>
                prev.map((item) =>
                  item.student.id === student.id ? { ...item, result: studentLiveRes } : item
                )
              );
              setBatchLiveStates((prev) => ({ ...prev, [student.id]: 'done' }));
            } catch (err: any) {
              if (err?.name === 'AbortError') throw err;
              workingBatch[i] = {
                ...workingBatch[i],
                result: null,
                error: err?.message || 'Grading failed',
              };
              setBatchResults((prev) =>
                prev.map((item) =>
                  item.student.id === student.id
                    ? { ...item, result: null, error: err?.message || 'Grading failed' }
                    : item
                )
              );
              setBatchLiveStates((prev) => ({ ...prev, [student.id]: 'error' }));
            }

            completed++;
            setGradingPercentage((completed / total) * 100);
          }

          if (!abortController.signal.aborted) {
            setIsLiveEvaluating(false);
            setLiveStatus('Batch evaluation complete.');

            const validRuns = workingBatch.filter((b) => b.result !== null);
            const totalScoreSum = validRuns.reduce((s, b) => s + (b.result?.total_score || 0), 0);
            const maxMarksSum = validRuns.reduce((s, b) => s + (b.result?.max_marks || 0), 0);
            const avgPct = maxMarksSum > 0 ? Math.round((totalScoreSum / maxMarksSum) * 100) : 0;
            const totalQ = validRuns.reduce((s, b) => s + (b.result?.questions.length || 0), 0);

            const runRecord: EvaluationRunRecord = {
              id: `run-${Date.now()}`,
              label: `Batch (${validRuns.length})`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              modeLabel: activeModeLabel,
              baseMode,
              isBatch: true,
              sheetsCount: validRuns.length,
              questionsCount: totalQ,
              omrCount: baseMode === 'omr' || baseMode === 'hybrid' ? validRuns.length : 0,
              writtenCount: baseMode === 'written' || baseMode === 'hybrid' ? validRuns.length : 0,
              avgPercentage: avgPct,
              totalScore: totalScoreSum,
              maxMarks: maxMarksSum,
              singleResult: null,
              batchResults: workingBatch,
              questionPaper,
              referenceDoc,
              answerSheet: null,
            };
            setEvalHistory((prev) => [...prev, runRecord]);
            persistRunRecordToServer(runRecord);
            playSound('success');
            pushToast(`Batch live grading complete: ${validRuns.length} sheet(s) (${avgPct}% avg).`, 'success');
          }
        } else {
          let completed = 0;
          const total = batchStudents.length;
          const newBatchResults: BatchResultItem[] = [];

          setGradingSteps(['Preprocessing Question Paper & Answer Key layout...']);
          const [qpOcrData, refOcrData] = await Promise.all([
            isPdfFile(questionPaper)
              ? extractTextAndLayoutFromFile(questionPaper)
              : Promise.resolve(undefined),
            referenceDoc && isPdfFile(referenceDoc)
              ? extractTextAndLayoutFromFile(referenceDoc)
              : Promise.resolve(undefined),
          ]);

          for (const student of batchStudents) {
            setGradingSteps((prev) => [
              ...prev,
              `Evaluating ${student.name || student.answerSheet.name} (${completed + 1}/${total})...`,
            ]);
            const stepSize = 100 / total;
            setGradingPercentage((completed / total) * 100);

            try {
              const startTime = Date.now();
              let studentProgress = 0;
              const progressInterval = setInterval(() => {
                studentProgress += (98 - studentProgress) * 0.1;
                setGradingPercentage((completed / total) * 100 + (studentProgress * stepSize) / 100);
              }, 500);

              const studentOcrData = isPdfFile(student.answerSheet)
                ? await extractTextAndLayoutFromFile(student.answerSheet)
                : undefined;

              let rawStudentOCR = undefined;
              if (
                !isSpeedFixer &&
                (gradingMode.includes('Gemini 3') || gradingMode === GradingMode.AI_KNOWLEDGE)
              ) {
                rawStudentOCR = await performHandwrittenOCR(student.answerSheet);
              }

              const gradingResult = await gradeAnswers(
                student.answerSheet,
                referenceDoc,
                questionPaper,
                gradingMode,
                activeBoxes,
                studentOcrData,
                qpOcrData,
                refOcrData,
                rawStudentOCR,
                baseMode
              );
              clearInterval(progressInterval);
              gradingResult.grading_duration = (Date.now() - startTime) / 1000;

              newBatchResults.push({
                student,
                result: gradingResult,
                previewUrl: '',
                answerSheetMimeType: inferMimeType(student.answerSheet),
              });
            } catch (e: any) {
              console.error(`Error grading student ${student.name}:`, e);
              newBatchResults.push({
                student,
                result: null,
                error: e.message || 'Grading failed',
                previewUrl: '',
                answerSheetMimeType: inferMimeType(student.answerSheet),
              });
            }
            completed++;
            setGradingPercentage((completed / total) * 100);
          }

          setBatchResults(newBatchResults);
          setGradingSteps((prev) => [...prev, 'Batch LLM evaluation complete!']);

          const validRuns = newBatchResults.filter((b) => b.result !== null);
          const totalScoreSum = validRuns.reduce((s, b) => s + (b.result?.total_score || 0), 0);
          const maxMarksSum = validRuns.reduce((s, b) => s + (b.result?.max_marks || 0), 0);
          const avgPct = maxMarksSum > 0 ? Math.round((totalScoreSum / maxMarksSum) * 100) : 0;
          const totalQ = validRuns.reduce((s, b) => s + (b.result?.questions.length || 0), 0);

          const runRecord: EvaluationRunRecord = {
            id: `run-${Date.now()}`,
            label: `Batch (${validRuns.length})`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            modeLabel: activeModeLabel,
            baseMode,
            isBatch: true,
            sheetsCount: validRuns.length,
            questionsCount: totalQ,
            omrCount: baseMode === 'omr' || baseMode === 'hybrid' ? validRuns.length : 0,
            writtenCount: baseMode === 'written' || baseMode === 'hybrid' ? validRuns.length : 0,
            avgPercentage: avgPct,
            totalScore: totalScoreSum,
            maxMarks: maxMarksSum,
            singleResult: null,
            batchResults: newBatchResults,
            questionPaper,
            referenceDoc,
            answerSheet: null,
          };
          setEvalHistory((prev) => [...prev, runRecord]);
          persistRunRecordToServer(runRecord);
          playSound('success');
          pushToast(`Batch complete: ${validRuns.length} sheet(s) evaluated (${avgPct}% avg).`, 'success');
          setIsReportStudioOpen(true);
        }
      } else {
        if (!answerSheet) throw new Error('Please upload a Student Answer Sheet in Slot 03.');
        const startTime = Date.now();

        if (liveGradingEnabled) {
          // 1) Open Student Report Studio IMMEDIATELY!
          const initialLiveShell: GradingResult = {
            total_score: 0,
            max_marks: 0,
            pass_status: 'Evaluating',
            letter_grade: 'LIVE',
            special_award: null,
            questions: [],
          };
          setResult(initialLiveShell);
          setIsLiveEvaluating(true);
          setLiveStatus(
            isSpeedFixer
              ? 'Speed Fixer Studio opened · Extracting & streaming rapid tool calls...'
              : 'Studio opened · Indexing documents for live AI evaluation...'
          );
          setGradingSteps([
            isSpeedFixer
              ? 'Opened Live Studio in Speed Fixer Mode (single-pass auto-repair)...'
              : 'Opened Live Student Report Studio · Streaming AI tool calls...',
          ]);
          setGradingPercentage(10);
          setIsReportStudioOpen(true);

          const [studentPdfData, qpOcrData, refOcrData] = await Promise.all([
            isPdfFile(answerSheet)
              ? withTimeout(extractTextAndLayoutFromFile(answerSheet), 900, undefined)
              : Promise.resolve(undefined),
            isPdfFile(questionPaper)
              ? withTimeout(extractTextAndLayoutFromFile(questionPaper), 900, undefined)
              : Promise.resolve(undefined),
            referenceDoc && isPdfFile(referenceDoc)
              ? withTimeout(extractTextAndLayoutFromFile(referenceDoc), 900, undefined)
              : Promise.resolve(undefined),
          ]);

          setGradingPercentage(25);
          const finalLiveResult = await gradeAnswersLive(
            answerSheet,
            referenceDoc,
            questionPaper,
            gradingMode,
            {
              onStatus: (msg) => {
                setLiveStatus(msg);
                setGradingSteps((prev) => [...prev, msg]);
              },
              onThinking: (delta) => {
                setLiveThinking((prev) => prev + delta);
              },
              onToolCall: (evt) => {
                setLiveToolEvents((prev) => [...prev, evt]);
              },
              onQuestionGraded: (question: QuestionResult, runningScore: number, runningMax: number) => {
                flashRecentQuestion(question.question_id);
                playSound('upload');
                setLiveStatus(
                  `Registered Q${question.question_id} (${question.score}/${question.full_marks} marks) · Running total: ${runningScore}/${runningMax}`
                );
                setGradingPercentage((prev) => Math.min(92, prev + 9));
                setResult((prev) => {
                  const base: GradingResult = prev || { ...initialLiveShell };
                  const idx = base.questions.findIndex(
                    (q) =>
                      String(q.question_id).toLowerCase() ===
                      String(question.question_id).toLowerCase()
                  );
                  const nextQuestions =
                    idx >= 0
                      ? base.questions.map((q, i) => (i === idx ? question : q))
                      : [...base.questions, question];
                  return {
                    ...base,
                    total_score: runningScore,
                    max_marks: runningMax,
                    questions: nextQuestions,
                  };
                });
              },
            },
            {
              boundingBoxes: activeBoxes,
              studentOcrData: studentPdfData,
              qpOcrData,
              refOcrData,
              baseHint: baseMode,
              signal: abortController.signal,
            }
          );

          finalLiveResult.grading_duration = (Date.now() - startTime) / 1000;
          setResult(finalLiveResult);
          setIsLiveEvaluating(false);
          setGradingPercentage(100);
          setLiveStatus(
            `Evaluation complete · ${finalLiveResult.questions.length} question(s) audited`
          );
          setGradingSteps((prev) => [
            ...prev,
            `Live evaluation complete: ${finalLiveResult.total_score}/${finalLiveResult.max_marks}.`,
          ]);

          const pct =
            finalLiveResult.max_marks > 0
              ? Math.round((finalLiveResult.total_score / finalLiveResult.max_marks) * 100)
              : 0;

          const runRecord: EvaluationRunRecord = {
            id: `run-${Date.now()}`,
            label: answerSheet.name.replace(/\.[^/.]+$/, '').slice(0, 12) || 'Sheet',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            modeLabel: activeModeLabel,
            baseMode,
            isBatch: false,
            sheetsCount: 1,
            questionsCount: finalLiveResult.questions.length,
            omrCount: baseMode === 'omr' || baseMode === 'hybrid' ? 1 : 0,
            writtenCount: baseMode === 'written' || baseMode === 'hybrid' ? 1 : 0,
            avgPercentage: pct,
            totalScore: finalLiveResult.total_score,
            maxMarks: finalLiveResult.max_marks,
            singleResult: finalLiveResult,
            batchResults: [],
            questionPaper,
            referenceDoc,
            answerSheet,
          };
          setEvalHistory((prev) => [...prev, runRecord]);
          persistRunRecordToServer(runRecord);
          playSound('success');
          pushToast(
            `Live evaluation complete: ${finalLiveResult.total_score}/${finalLiveResult.max_marks} (${pct}%).`,
            'success'
          );
        } else {
          setGradingSteps([
            `Initializing GraderLabs ${
              isSpeedFixer
                ? 'Speed Fixer'
                : gradingMode.includes('Gemini 3')
                ? 'Pro Vision'
                : 'Fast'
            } Engine...`,
          ]);
          setGradingPercentage(8);

          const [studentPdfData, qpOcrData, refOcrData] = await Promise.all([
            isPdfFile(answerSheet)
              ? extractTextAndLayoutFromFile(answerSheet)
              : Promise.resolve(undefined),
            isPdfFile(questionPaper)
              ? extractTextAndLayoutFromFile(questionPaper)
              : Promise.resolve(undefined),
            referenceDoc && isPdfFile(referenceDoc)
              ? extractTextAndLayoutFromFile(referenceDoc)
              : Promise.resolve(undefined),
          ]);

          let rawStudentOCR = undefined;
          if (
            !isSpeedFixer &&
            (gradingMode.includes('Gemini 3') || gradingMode === GradingMode.AI_KNOWLEDGE)
          ) {
            setGradingSteps((prev) => [...prev, 'Performing Forensic OCR & Layout Grounding...']);
            setGradingPercentage(22);
            rawStudentOCR = await performHandwrittenOCR(answerSheet);
          } else {
            setGradingSteps((prev) => [
              ...prev,
              isSpeedFixer
                ? 'Running Speed Fixer Rapid Single-Pass Pipeline...'
                : 'Running Fast Stream Evaluation Pipeline...',
            ]);
            setGradingPercentage(22);
          }

          setGradingSteps((prev) => [
            ...prev,
            'Evaluating responses against rubric & computing spatial pins...',
          ]);
          setGradingPercentage(38);

          const progressInterval = setInterval(() => {
            setGradingPercentage((prev) => {
              if (prev >= 94) return prev;
              return prev + (94 - prev) * 0.03;
            });
          }, 900);

          const gradingResult = await gradeAnswers(
            answerSheet,
            referenceDoc,
            questionPaper,
            gradingMode,
            activeBoxes,
            studentPdfData,
            qpOcrData,
            refOcrData,
            rawStudentOCR,
            baseMode
          );

          clearInterval(progressInterval);
          gradingResult.grading_duration = (Date.now() - startTime) / 1000;

          setGradingPercentage(100);
          setGradingSteps((prev) => [
            ...prev,
            'AI evaluation complete! Opening Student Report Studio...',
          ]);
          setResult(gradingResult);

          const pct =
            gradingResult.max_marks > 0
              ? Math.round((gradingResult.total_score / gradingResult.max_marks) * 100)
              : 0;

          const runRecord: EvaluationRunRecord = {
            id: `run-${Date.now()}`,
            label: answerSheet.name.replace(/\.[^/.]+$/, '').slice(0, 12) || 'Sheet',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            modeLabel: activeModeLabel,
            baseMode,
            isBatch: false,
            sheetsCount: 1,
            questionsCount: gradingResult.questions.length,
            omrCount: baseMode === 'omr' || baseMode === 'hybrid' ? 1 : 0,
            writtenCount: baseMode === 'written' || baseMode === 'hybrid' ? 1 : 0,
            avgPercentage: pct,
            totalScore: gradingResult.total_score,
            maxMarks: gradingResult.max_marks,
            singleResult: gradingResult,
            batchResults: [],
            questionPaper,
            referenceDoc,
            answerSheet,
          };
          setEvalHistory((prev) => [...prev, runRecord]);
          persistRunRecordToServer(runRecord);
          playSound('success');
          pushToast(
            `Evaluation complete: ${gradingResult.total_score}/${gradingResult.max_marks} (${pct}%).`,
            'success'
          );
          setIsReportStudioOpen(true);
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setIsLiveEvaluating(false);
        return;
      }
      const msg = e?.message || 'Evaluation failed.';
      setError(msg);
      setLiveError(msg);
      setIsLiveEvaluating(false);
      setGradingSteps((prev) => [...prev, `Error: ${msg}`]);
      setGradingPercentage(0);
      pushToast(msg, 'error');
    } finally {
      setIsLoading(false);
      if (liveAbortRef.current === abortController) {
        liveAbortRef.current = null;
      }
    }
  };

  // --- Computed Dashboard KPIs (Strictly 0 when evalHistory & uploads are empty) ---
  const uploadedSlotsCount = useMemo(() => {
    let count = 0;
    if (questionPaper) count++;
    if (referenceDoc || specialMode === 'ai_knowledge') count++;
    if (isBatchMode ? batchStudents.length > 0 : answerSheet !== null) count++;
    return count;
  }, [questionPaper, referenceDoc, answerSheet, batchStudents.length, isBatchMode, specialMode]);

  const isReadyToGrade = useMemo(() => {
    if (!questionPaper) return false;
    if (gradingMode !== GradingMode.AI_KNOWLEDGE && !referenceDoc) return false;
    if (isBatchMode) return batchStudents.length > 0;
    return answerSheet !== null;
  }, [questionPaper, referenceDoc, answerSheet, batchStudents.length, isBatchMode, gradingMode]);

  const dashboardMetrics = useMemo(() => {
    const totalSheets = evalHistory.reduce((acc, r) => acc + r.sheetsCount, 0);
    const omrSheets = evalHistory.reduce((acc, r) => acc + r.omrCount, 0);
    const writtenSheets = evalHistory.reduce((acc, r) => acc + r.writtenCount, 0);
    const totalQuestions = evalHistory.reduce((acc, r) => acc + r.questionsCount, 0);
    const meanScore =
      evalHistory.length > 0
        ? Math.round(evalHistory.reduce((acc, r) => acc + r.avgPercentage, 0) / evalHistory.length)
        : 0;
    const lastTimestamp =
      evalHistory.length > 0 ? evalHistory[evalHistory.length - 1].timestamp : 'NEVER (0)';

    return {
      totalSheets,
      runsCount: evalHistory.length,
      omrSheets,
      writtenSheets,
      totalQuestions,
      meanScore,
      lastTimestamp,
    };
  }, [evalHistory]);

  const openRunInReportStudio = (run: EvaluationRunRecord) => {
    playSound('portal');
    setResult(run.singleResult);
    setBatchResults(run.batchResults);
    if (run.questionPaper) setQuestionPaper(run.questionPaper);
    if (run.referenceDoc) setReferenceDoc(run.referenceDoc);
    if (run.answerSheet) setAnswerSheet(run.answerSheet);
    setIsBatchMode(run.isBatch);
    setIsReportStudioOpen(true);
  };

  // --- Toast Overlay ---
  const ToastOverlay = (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2.5 pointer-events-none">
      {toasts.map((t) => {
        const dotClass =
          t.type === 'success'
            ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
            : t.type === 'error'
            ? 'bg-rose-400 shadow-[0_0_8px_#fb7185]'
            : 'bg-purple-400 shadow-[0_0_8px_#c084fc]';
        return (
          <div
            key={t.id}
            className="liquid-glass border-glow px-4 py-3 rounded-2xl flex items-center gap-3 text-xs text-white shadow-2xl pointer-events-auto animate-surface-enter w-full sm:w-80 bg-[#0d071c]/95"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
            <span className="leading-snug">{t.message}</span>
          </div>
        );
      })}
    </div>
  );

  // --- Portal Transition Overlay ---
  const PortalOverlay = portalState.visible ? (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#040209]/95 backdrop-blur-2xl p-6 animate-fade-in">
      <div className="max-w-lg w-full text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-700 flex items-center justify-center orb-glow">
          <LogoIcon className="w-8 h-8 text-white animate-spin" style={{ animationDuration: '3s' }} />
        </div>
        <h3 className="text-xl sm:text-2xl font-bold shimmer-text">{portalState.title}</h3>
        <p className="text-xs text-purple-300/70 mt-1.5 font-mono">{portalState.subtitle}</p>

        <div className="mt-7 space-y-3 text-left">
          <div className="h-12 rounded-xl skeleton-box" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-20 rounded-xl skeleton-box" />
            <div className="h-20 rounded-xl skeleton-box" />
            <div className="h-20 rounded-xl skeleton-box" />
          </div>
          <div className="h-24 rounded-xl skeleton-box" />
        </div>
      </div>
    </div>
  ) : null;

  if (!isAuthenticated) {
    return (
      <>
        {ToastOverlay}
        {PortalOverlay}
        <LandingPage
          onSignIn={handleSignIn}
          soundEnabled={soundOn}
          onToggleSound={toggleSound}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen relative overflow-x-hidden pb-20 bg-[#070510] text-[#f5f3ff]">
      {ToastOverlay}
      {PortalOverlay}

      {/* Ambient Cosmic Grid & Glows */}
      <div className="cosmic-grid absolute inset-0 pointer-events-none opacity-60" />
      <div className="absolute -top-32 left-1/3 w-[620px] h-[280px] bg-purple-600/20 blur-[140px] rounded-full pointer-events-none" />

      {/* Top App Navigation Bar */}
      <header className="relative z-30 border-b border-purple-500/20 bg-[#070310]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 lg:py-0 lg:h-16 flex flex-wrap lg:flex-nowrap items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-700 flex items-center justify-center shadow-[0_0_16px_#9333ea]">
              <LogoIcon className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white tracking-tight text-sm sm:text-base">
              GraderLabs
            </span>
            <span className="hidden xs:inline-block px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-400/40 text-purple-300">
              LLM v4.2
            </span>
          </div>

          {/* Switcher Tabs (Row 2 on mobile, centered on desktop) */}
          <div className="order-3 lg:order-2 w-full lg:w-auto flex items-center gap-1.5 p-1 rounded-full bg-[#130b26] border border-purple-500/25">
            <button
              type="button"
              onClick={() => {
                playSound('click');
                setWorkspaceTab('dashboard');
              }}
              className={`flex-1 lg:flex-none px-3 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition min-h-[36px] whitespace-nowrap ${
                workspaceTab === 'dashboard'
                  ? 'bg-purple-600 text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]'
                  : 'text-purple-200/80 hover:text-white'
              }`}
            >
              Dashboard Overview
            </button>
            <button
              type="button"
              onClick={enterStudioWithAnimation}
              className={`flex-1 lg:flex-none px-3 sm:px-4 py-1.5 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition min-h-[36px] whitespace-nowrap ${
                workspaceTab === 'studio'
                  ? 'bg-purple-600 text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]'
                  : 'text-purple-200/80 hover:text-white'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-purple-300 animate-ping" />
              <span>Evaluation Studio</span>
            </button>
          </div>

          {/* Right User Controls */}
          <div className="order-2 lg:order-3 flex items-center gap-2 sm:gap-3 ml-auto lg:ml-0">
            <button
              type="button"
              onClick={() => {
                playSound('click');
                setIsMcpModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-full bg-emerald-950/50 border border-emerald-400/40 text-[11px] font-mono text-emerald-200 hover:bg-emerald-900/50 flex items-center gap-1.5 min-h-[36px] transition"
              title="Get MCP Server URL to connect Claude, ChatGPT, or Cursor"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>MCP URL</span>
            </button>

            <button
              type="button"
              onClick={toggleSound}
              className="px-3 py-1.5 rounded-full liquid-glass border-glow text-[11px] text-purple-200 flex items-center gap-1.5 min-h-[36px]"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  soundOn ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span>SFX</span>
            </button>

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#140b29] border border-purple-500/25">
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-purple-500 to-fuchsia-500 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                {userEmail.slice(0, 2)}
              </div>
              <span className="text-xs font-medium text-purple-100 max-w-[160px] truncate">
                {userEmail}
              </span>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium text-rose-300 hover:text-white bg-rose-950/40 border border-rose-500/30 transition min-h-[36px]"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* ================================================================= */}
      {/* SUB-VIEW A: DASHBOARD OVERVIEW (Starts at 0!)                      */}
      {/* ================================================================= */}
      {workspaceTab === 'dashboard' && (
        <main className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 animate-surface-enter">
          {/* Welcome Command Center Banner */}
          <div className="liquid-glass border-glow specular-beam p-5 sm:p-8 rounded-3xl mb-6 sm:mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/80 border border-purple-400/30 text-[11px] text-purple-300 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>
                  {evalHistory.length === 0
                    ? 'Clean Session Initialized • Zero Pre-loaded Demo Data'
                    : `Active Telemetry • ${evalHistory.length} Evaluation Run(s) Recorded`}
                </span>
              </div>
              <h1 className="text-xl sm:text-3xl font-bold text-white glow-text">
                Welcome to Your Evaluation Command Center
              </h1>
              <p className="text-xs sm:text-sm text-purple-200/70 mt-1.5 max-w-2xl">
                All metrics begin at <span className="font-mono text-white font-semibold">0</span>.
                Enter the <span className="text-purple-300 font-semibold">GraderLabs Studio</span> to
                select your evaluation mode and upload your Question Paper, Answer Key, and Student Sheets.
              </p>
            </div>

            <button
              type="button"
              onMouseEnter={() => playSound('hover')}
              onClick={enterStudioWithAnimation}
              className="btn-quantix w-full md:w-auto px-6 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold text-white flex items-center justify-center gap-2.5 shrink-0 min-h-[46px]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Enter Evaluation Studio &rarr;</span>
            </button>
          </div>

          {/* 4 KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-6 sm:mb-8">
            <div className="liquid-glass border-glow specular-beam p-5 rounded-2xl">
              <div className="flex items-center justify-between text-xs text-purple-300/70">
                <span>Total Sheets Evaluated</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500/30 font-mono text-[10px]">
                  ALL
                </span>
              </div>
              <p className="text-3xl font-extrabold text-white font-mono mt-3 glow-text tabular-nums">
                {dashboardMetrics.totalSheets}
              </p>
              <p className="text-[11px] text-purple-300/55 mt-2">
                {dashboardMetrics.runsCount} run(s) processed in session
              </p>
            </div>

            <div className="liquid-glass border-glow specular-beam p-5 rounded-2xl">
              <div className="flex items-center justify-between text-xs text-purple-300/70">
                <span>OMR Sheets Graded</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500/30 font-mono text-[10px]">
                  OPTICAL
                </span>
              </div>
              <p className="text-3xl font-extrabold text-white font-mono mt-3 glow-text tabular-nums">
                {dashboardMetrics.omrSheets}
              </p>
              <p className="text-[11px] text-purple-300/55 mt-2">
                Total questions audited: <span className="font-mono text-purple-200">{dashboardMetrics.totalQuestions}</span>
              </p>
            </div>

            <div className="liquid-glass border-glow specular-beam p-5 rounded-2xl">
              <div className="flex items-center justify-between text-xs text-purple-300/70">
                <span>Written Scripts Graded</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500/30 font-mono text-[10px]">
                  LLM OCR
                </span>
              </div>
              <p className="text-3xl font-extrabold text-white font-mono mt-3 glow-text tabular-nums">
                {dashboardMetrics.writtenSheets}
              </p>
              <p className="text-[11px] text-purple-300/55 mt-2">
                Handwriting &amp; rubric passes completed
              </p>
            </div>

            <div className="liquid-glass border-glow specular-beam p-5 rounded-2xl">
              <div className="flex items-center justify-between text-xs text-purple-300/70">
                <span>Mean Score / Rubric Match</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500/30 font-mono text-[10px]">
                  AVG
                </span>
              </div>
              <p className="text-3xl font-extrabold text-white font-mono mt-3 glow-text tabular-nums">
                {dashboardMetrics.meanScore}%
              </p>
              <p className="text-[11px] text-purple-300/55 mt-2">
                Uploaded assets: <span className="font-mono text-purple-200">{uploadedSlotsCount} / 3</span>
              </p>
            </div>
          </div>

          {/* Telemetry Distribution + Document Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 liquid-glass border-glow p-5 sm:p-6 rounded-3xl flex flex-col justify-between">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-base font-bold text-white">Evaluation Distribution Telemetry</h3>
                  <p className="text-xs text-purple-300/60">
                    {evalHistory.length === 0
                      ? 'Updates automatically after Studio LLM grading run'
                      : 'Click any evaluation bar below to inspect in Student Report Studio'}
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full text-[11px] font-mono bg-purple-950/90 border border-purple-500/30 text-purple-300">
                  {evalHistory.length} {evalHistory.length === 1 ? 'DATA POINT' : 'DATA POINTS'}
                </span>
              </div>

              {evalHistory.length === 0 ? (
                <div className="my-4 py-10 px-4 rounded-2xl border border-dashed border-purple-500/25 bg-[#0a0517]/60 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-purple-950/80 border border-purple-400/30 flex items-center justify-center mx-auto mb-3 text-purple-300">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-white">0 Evaluations Recorded</p>
                  <p className="text-xs text-purple-300/60 max-w-sm mx-auto mt-1">
                    Your workspace is clean with zero demo records. Launch the Studio to upload your exam assets and run an evaluation.
                  </p>
                  <button
                    type="button"
                    onClick={enterStudioWithAnimation}
                    className="mt-4 px-4 py-2 rounded-full text-xs font-semibold bg-purple-600/30 border border-purple-400/50 text-purple-100 hover:bg-purple-600 transition min-h-[38px]"
                  >
                    Open Studio &amp; Upload Documents &rarr;
                  </button>
                </div>
              ) : (
                <div className="my-4">
                  <div className="grid grid-cols-5 gap-3 sm:gap-4 items-end h-48 pt-10 px-3 sm:px-4 pb-3 bg-[#0a0517]/60 rounded-2xl border border-purple-500/20">
                    {evalHistory.slice(-5).map((run, idx, arr) => {
                      const isLatest = idx === arr.length - 1;
                      const barHeight = Math.max(20, Math.min(100, run.avgPercentage));
                      return (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => openRunInReportStudio(run)}
                          className="flex flex-col items-center gap-2 h-full justify-end group text-center"
                          title={`Open ${run.label} in Student Report Studio`}
                        >
                          <div className="relative w-full flex-1 flex items-end justify-center">
                            <span className="-top-6 absolute px-2 py-0.5 rounded-full bg-[#1e113a] border border-purple-400/50 text-[10px] font-mono text-white whitespace-nowrap shadow-md tabular-nums">
                              {run.avgPercentage}%
                            </span>
                            <div
                              className={`w-full rounded-t-xl transition-all group-hover:brightness-125 ${
                                isLatest
                                  ? 'bg-gradient-to-t from-purple-700 via-purple-500 to-purple-300 shadow-[0_0_24px_rgba(168,85,247,0.85)]'
                                  : 'bg-purple-700/45 border border-purple-500/30'
                              }`}
                              style={{ height: `${barHeight}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-purple-200/80 truncate w-full">
                            {run.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-purple-300/55 pt-3 border-t border-purple-500/15 font-mono">
                <span>QUEUE: {isLoading ? '1 ACTIVE' : '0 PENDING'}</span>
                <span>LAST EVALUATION: {dashboardMetrics.lastTimestamp}</span>
              </div>
            </div>

            <div className="lg:col-span-5 liquid-glass border-glow p-5 sm:p-6 rounded-3xl flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Document Matrix Status</h3>
                <p className="text-xs text-purple-300/60 mb-5">
                  Current session files mounted in GraderLabs Studio
                </p>

                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-[#0c061c] border border-purple-500/20 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-purple-950 border border-purple-400/30 flex items-center justify-center text-purple-300 font-mono text-xs shrink-0">
                        QP
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white">Question Paper</p>
                        <p className="text-[11px] text-purple-300/55 truncate">
                          {questionPaper ? questionPaper.name : '0 files uploaded'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-mono border shrink-0 ${
                        questionPaper
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                          : 'bg-purple-950 text-purple-300/60 border-purple-500/20'
                      }`}
                    >
                      {formatFileSize(questionPaper)}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#0c061c] border border-purple-500/20 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-purple-950 border border-purple-400/30 flex items-center justify-center text-purple-300 font-mono text-xs shrink-0">
                        AK
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white">Answer Key / Rubric</p>
                        <p className="text-[11px] text-purple-300/55 truncate">
                          {specialMode === 'ai_knowledge'
                            ? 'AI Knowledge Internal Rubric'
                            : referenceDoc
                            ? referenceDoc.name
                            : '0 files uploaded'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-mono border shrink-0 ${
                        referenceDoc || specialMode === 'ai_knowledge'
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                          : 'bg-purple-950 text-purple-300/60 border-purple-500/20'
                      }`}
                    >
                      {specialMode === 'ai_knowledge' ? 'AI KEY' : formatFileSize(referenceDoc)}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#0c061c] border border-purple-500/20 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-purple-950 border border-purple-400/30 flex items-center justify-center text-purple-300 font-mono text-xs shrink-0">
                        SS
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white">Student Sheet(s)</p>
                        <p className="text-[11px] text-purple-300/55 truncate">
                          {isBatchMode
                            ? batchStudents.length > 0
                              ? `${batchStudents.length} batch sheet(s) queued`
                              : '0 files uploaded'
                            : answerSheet
                            ? answerSheet.name
                            : '0 files uploaded'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-mono border shrink-0 ${
                        (isBatchMode ? batchStudents.length > 0 : answerSheet !== null)
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                          : 'bg-purple-950 text-purple-300/60 border-purple-500/20'
                      }`}
                    >
                      {isBatchMode ? `${batchStudents.length} FILES` : formatFileSize(answerSheet)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={enterStudioWithAnimation}
                className="mt-6 w-full py-3 rounded-xl liquid-glass border-glow text-xs font-semibold text-purple-100 hover:text-white hover:bg-purple-800/30 transition min-h-[44px]"
              >
                Configure &amp; Upload in Studio &rarr;
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW B: GRADERLABS EVALUATION STUDIO                          */}
      {/* ================================================================= */}
      {workspaceTab === 'studio' && (
        <section className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 animate-surface-enter">
          {/* Studio Header Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-purple-500/20">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950 border border-purple-400/40 text-[11px] font-mono text-purple-200 mb-2">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                <span>GRADERLABS NEURAL STUDIO</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold shimmer-text">
                AI Exam Evaluation Studio
              </h2>
              <p className="text-xs text-purple-200/70 mt-1">
                Select your grading pipeline, mount the 3 core assessment documents, and invoke the LLM evaluator.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setIsMcpModalOpen(true);
                }}
                className="flex-1 md:flex-none px-3.5 py-2.5 rounded-xl bg-emerald-950/50 border border-emerald-400/40 text-xs font-mono font-medium text-emerald-200 hover:text-white transition flex items-center justify-center gap-1.5 min-h-[40px]"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>MCP Agent URL</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setShowReferenceLibrary(true);
                }}
                className="flex-1 md:flex-none px-3.5 py-2.5 rounded-xl bg-[#140a29] border border-purple-500/30 text-xs font-medium text-purple-200 hover:text-white transition flex items-center justify-center gap-1.5 min-h-[40px]"
              >
                <BookOpenIcon className="w-4 h-4 text-purple-300" />
                <span>Ref. Library</span>
              </button>
              <button
                type="button"
                onClick={resetStudioToZero}
                className="flex-1 md:flex-none px-3.5 py-2.5 rounded-xl bg-[#140a29] border border-purple-500/30 text-xs font-medium text-purple-300 hover:text-white transition min-h-[40px]"
              >
                Reset Studio to 0
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setWorkspaceTab('dashboard');
                }}
                className="flex-1 md:flex-none px-4 py-2.5 rounded-xl liquid-glass border-glow text-xs font-semibold text-white min-h-[40px]"
              >
                &larr; Dashboard
              </button>
            </div>
          </div>

          {/* STEP 1: EVALUATION MODE SELECTOR */}
          <div className="mt-7">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                Step 1 — Select Evaluation Engine Mode
              </span>
              <span className="text-xs font-mono text-purple-200">
                Active: {activeModeLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
              {/* Mode 1: OMR */}
              <div
                role="button"
                tabIndex={0}
                aria-pressed={baseMode === 'omr' && specialMode === 'none'}
                onClick={() => {
                  playSound('click');
                  setBaseMode('omr');
                  setSpecialMode('none');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playSound('click');
                    setBaseMode('omr');
                    setSpecialMode('none');
                  }
                }}
                onMouseEnter={() => playSound('hover')}
                className={`cursor-pointer liquid-glass border-glow specular-beam p-5 rounded-2xl transition ${
                  baseMode === 'omr' && specialMode === 'none' ? 'border-glow-active' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      baseMode === 'omr' && specialMode === 'none'
                        ? 'bg-gradient-to-br from-purple-500 to-indigo-700 text-white shadow-[0_0_15px_#9333ea]'
                        : 'bg-purple-950 border border-purple-400/40 text-purple-300'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono ${
                      baseMode === 'omr' && specialMode === 'none'
                        ? 'bg-purple-600 text-white shadow-[0_0_10px_#9333ea]'
                        : 'bg-purple-950/90 border border-purple-500/30 text-purple-300'
                    }`}
                  >
                    OPTICAL MATRIX
                  </span>
                </div>
                <h3
                  className={`text-base font-bold ${
                    baseMode === 'omr' && specialMode === 'none'
                      ? 'shimmer-text'
                      : 'text-white glow-text'
                  }`}
                >
                  OMR Evaluation
                </h3>
                <p className="text-xs text-purple-200/65 mt-1 leading-relaxed">
                  High-precision optical bubble grid detection with skew tolerance, stray-mark filtering, and multi-choice validation.
                </p>
              </div>

              {/* Mode 2: Written */}
              <div
                role="button"
                tabIndex={0}
                aria-pressed={baseMode === 'written' && specialMode === 'none'}
                onClick={() => {
                  playSound('click');
                  setBaseMode('written');
                  setSpecialMode('none');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playSound('click');
                    setBaseMode('written');
                    setSpecialMode('none');
                  }
                }}
                onMouseEnter={() => playSound('hover')}
                className={`cursor-pointer liquid-glass border-glow specular-beam p-5 rounded-2xl transition ${
                  baseMode === 'written' && specialMode === 'none' ? 'border-glow-active' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      baseMode === 'written' && specialMode === 'none'
                        ? 'bg-gradient-to-br from-purple-500 to-indigo-700 text-white shadow-[0_0_15px_#9333ea]'
                        : 'bg-purple-950 border border-purple-400/40 text-purple-300'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono ${
                      baseMode === 'written' && specialMode === 'none'
                        ? 'bg-purple-600 text-white shadow-[0_0_10px_#9333ea]'
                        : 'bg-purple-950/90 border border-purple-500/30 text-purple-300'
                    }`}
                  >
                    HANDWRITING LLM
                  </span>
                </div>
                <h3
                  className={`text-base font-bold ${
                    baseMode === 'written' && specialMode === 'none'
                      ? 'shimmer-text'
                      : 'text-white glow-text'
                  }`}
                >
                  Written Evaluation
                </h3>
                <p className="text-xs text-purple-200/65 mt-1 leading-relaxed">
                  Deep vision-language transcription for handwritten essays, derivations, diagrams, and step-by-step partial rubrics.
                </p>
              </div>

              {/* Mode 3: Hybrid Auto-Detection */}
              <div
                role="button"
                tabIndex={0}
                aria-pressed={baseMode === 'hybrid' && specialMode === 'none'}
                onClick={() => {
                  playSound('click');
                  setBaseMode('hybrid');
                  setSpecialMode('none');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playSound('click');
                    setBaseMode('hybrid');
                    setSpecialMode('none');
                  }
                }}
                onMouseEnter={() => playSound('hover')}
                className={`cursor-pointer liquid-glass border-glow specular-beam p-5 rounded-2xl transition ${
                  baseMode === 'hybrid' && specialMode === 'none' ? 'border-glow-active' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      baseMode === 'hybrid' && specialMode === 'none'
                        ? 'bg-gradient-to-br from-purple-500 to-indigo-700 text-white shadow-[0_0_15px_#9333ea]'
                        : 'bg-purple-950 border border-purple-400/40 text-purple-300'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono ${
                      baseMode === 'hybrid' && specialMode === 'none'
                        ? 'bg-purple-600 text-white shadow-[0_0_10px_#9333ea]'
                        : 'bg-purple-950/90 border border-purple-500/30 text-purple-300'
                    }`}
                  >
                    AUTO DETECTION
                  </span>
                </div>
                <h3
                  className={`text-base font-bold ${
                    baseMode === 'hybrid' && specialMode === 'none'
                      ? 'shimmer-text'
                      : 'text-white glow-text'
                  }`}
                >
                  OMR + Written Evaluation
                </h3>
                <p className="text-xs text-purple-200/75 mt-1 leading-relaxed">
                  Autonomous neural segmentation detects both OMR bubble sections and handwritten responses in a single pass.
                </p>
              </div>
            </div>

            {/* Compact Engine & Workflow Strip (Precision Tier, Special Modes, Single/Batch, OMR ROI) */}
            <div className="mt-4 liquid-glass border-glow px-4 py-3 rounded-2xl flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* Single vs Batch Toggle */}
                <div className="flex items-center gap-1 p-1 rounded-full bg-[#090414] border border-purple-500/25">
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click');
                      setIsBatchMode(false);
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                      !isBatchMode
                        ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]'
                        : 'text-purple-300/70 hover:text-white'
                    }`}
                  >
                    Single Sheet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click');
                      setIsBatchMode(true);
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                      isBatchMode
                        ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]'
                        : 'text-purple-300/70 hover:text-white'
                    }`}
                  >
                    Batch Upload
                  </button>
                </div>

                {/* Precision Tier Toggle */}
                <div className="flex items-center gap-1 p-1 rounded-full bg-[#090414] border border-purple-500/25">
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click');
                      setPrecisionTier('pro');
                      setSpecialMode('none');
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                      precisionTier === 'pro' && specialMode === 'none'
                        ? 'bg-purple-600 text-white'
                        : 'text-purple-300/70 hover:text-white'
                    }`}
                  >
                    Pro Precision
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click');
                      setPrecisionTier('fast');
                      setSpecialMode('none');
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                      precisionTier === 'fast' && specialMode === 'none'
                        ? 'bg-purple-600 text-white'
                        : 'text-purple-300/70 hover:text-white'
                    }`}
                  >
                    Fast Engine
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playSound('click');
                    setSpecialMode((prev) => (prev === 'speed_fixer' ? 'none' : 'speed_fixer'));
                  }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    specialMode === 'speed_fixer'
                      ? 'bg-amber-500/25 border-amber-300 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.45)]'
                      : 'bg-[#120a24] border-purple-500/25 text-purple-200/80 hover:text-white'
                  }`}
                  title="Single-pass rapid evaluation + automatic QID, mark & coordinate repair"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Speed Fixer Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playSound('click');
                    setLiveGradingEnabled((prev) => !prev);
                  }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    liveGradingEnabled
                      ? 'bg-fuchsia-600/30 border-fuchsia-300 text-fuchsia-100 shadow-[0_0_12px_rgba(217,70,239,0.4)]'
                      : 'bg-[#120a24] border-purple-500/25 text-purple-200/75 hover:text-white'
                  }`}
                  title="Open Student Report Studio immediately and stream AI tool calls, marks & annotations live"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      liveGradingEnabled ? 'bg-fuchsia-400' : 'bg-purple-400/40'
                    }`}
                  />
                  <span>Live Grading: {liveGradingEnabled ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playSound('click');
                    setSpecialMode((prev) => (prev === 'forensic' ? 'none' : 'forensic'));
                  }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    specialMode === 'forensic'
                      ? 'bg-rose-600/30 border-rose-400 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                      : 'bg-[#120a24] border-purple-500/25 text-purple-200/80 hover:text-white'
                  }`}
                >
                  <ShieldCheckIcon className="w-3.5 h-3.5" />
                  <span>Forensic Audit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playSound('click');
                    setSpecialMode((prev) => (prev === 'ai_knowledge' ? 'none' : 'ai_knowledge'));
                  }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    specialMode === 'ai_knowledge'
                      ? 'bg-purple-600/35 border-purple-300 text-white shadow-[0_0_12px_rgba(168,85,247,0.5)]'
                      : 'bg-[#120a24] border-purple-500/25 text-purple-200/80 hover:text-white'
                  }`}
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span>AI Knowledge (No Key)</span>
                </button>

                {(baseMode === 'omr' || baseMode === 'hybrid') && (
                  <button
                    type="button"
                    onClick={openOmrEditor}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-[#150c2b] border border-purple-400/35 text-purple-200 hover:text-white hover:bg-purple-800/40 transition flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                    <span>
                      {omrBoundingBoxes.length > 0
                        ? `OMR Zones (${omrBoundingBoxes.length})`
                        : 'OMR Template'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* STEP 2: UPLOAD ARTIFACTS MATRIX */}
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                Step 2 — Upload Assessment Documents ({uploadedSlotsCount}/3 Ready)
              </span>
              <button
                type="button"
                onClick={handleLoadAllDemo}
                className="text-[11px] font-mono text-purple-300 hover:text-white underline"
              >
                + Mount Full Sample Demo Package
              </button>
            </div>

            {isBatchMode ? (
              <BatchUpload
                onQuestionPaperChange={setQuestionPaper}
                onReferenceDocChange={setReferenceDoc}
                onStudentsChange={setBatchStudents}
                isReferenceDocDisabled={gradingMode === GradingMode.AI_KNOWLEDGE}
                questionPaperFile={questionPaper}
                referenceDocFile={referenceDoc}
              />
            ) : (
              <>
                <input
                  ref={qpInputRef}
                  type="file"
                  accept={ACCEPTED_DOCUMENT_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => handleSlotFileChange('qp', e)}
                />
                <input
                  ref={akInputRef}
                  type="file"
                  accept={ACCEPTED_DOCUMENT_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => handleSlotFileChange('ak', e)}
                />
                <input
                  ref={ssInputRef}
                  type="file"
                  accept={ACCEPTED_DOCUMENT_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => handleSlotFileChange('ss', e)}
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                  {/* Slot 01: Question Paper */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleSlotDrop('qp', e)}
                    className={`liquid-glass border-glow p-5 sm:p-6 rounded-2xl flex flex-col justify-between relative overflow-hidden ${
                      questionPaper ? 'border-glow-active' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-500/30 text-purple-300">
                          SLOT 01 • REQUIRED
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            questionPaper ? 'text-emerald-400 font-semibold' : 'text-purple-400/60'
                          }`}
                        >
                          {questionPaper ? '1 READY' : '0 UPLOADED'}
                        </span>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-purple-950/90 border border-purple-400/35 flex items-center justify-center text-purple-300 mb-4">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <h4 className="text-base font-bold text-white">Question Paper</h4>
                      <p className="text-xs text-purple-200/60 mt-1">
                        Upload the master exam paper containing question prompts, marks weightage, and section structure.
                      </p>
                    </div>

                    {slotSkeletons.qp && (
                      <div className="my-4 space-y-2">
                        <div className="h-4 rounded skeleton-box w-3/4" />
                        <div className="h-9 rounded-lg skeleton-box w-full" />
                      </div>
                    )}

                    {!slotSkeletons.qp && questionPaper && (
                      <div className="my-4 p-3 rounded-xl bg-emerald-950/30 border border-emerald-400/40 flex items-center justify-between gap-2">
                        <div className="truncate">
                          <p className="text-xs font-semibold text-emerald-200 truncate">
                            {questionPaper.name}
                          </p>
                          <p className="text-[10px] font-mono text-emerald-300/75">
                            Indexed • {formatFileSize(questionPaper)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setQuestionPaper(null)}
                          className="text-xs font-mono text-emerald-300 hover:text-rose-300 px-1.5 py-0.5"
                          title="Clear Question Paper"
                        >
                          &times;
                        </button>
                      </div>
                    )}

                    <div className="mt-5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => qpInputRef.current?.click()}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-purple-600/25 hover:bg-purple-600/45 border border-purple-400/40 text-xs font-semibold text-white transition min-h-[42px]"
                      >
                        Browse File...
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickDemoSlot('qp')}
                        title="Mount Demo Question Paper"
                        className="py-2.5 px-3 rounded-xl bg-[#160c2e] hover:bg-purple-900/50 border border-purple-500/30 text-[11px] font-mono text-purple-200 transition min-h-[42px]"
                      >
                        + Demo QP
                      </button>
                    </div>
                  </div>

                  {/* Slot 02: Answer Key */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) =>
                      specialMode !== 'ai_knowledge' && handleSlotDrop('ak', e)
                    }
                    className={`liquid-glass border-glow p-5 sm:p-6 rounded-2xl flex flex-col justify-between relative overflow-hidden ${
                      specialMode === 'ai_knowledge'
                        ? 'opacity-55 pointer-events-none'
                        : referenceDoc
                        ? 'border-glow-active'
                        : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-500/30 text-purple-300">
                          {specialMode === 'ai_knowledge' ? 'SLOT 02 • BYPASSED' : 'SLOT 02 • REQUIRED'}
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            referenceDoc || specialMode === 'ai_knowledge'
                              ? 'text-emerald-400 font-semibold'
                              : 'text-purple-400/60'
                          }`}
                        >
                          {specialMode === 'ai_knowledge'
                            ? 'AI KEY'
                            : referenceDoc
                            ? '1 READY'
                            : '0 UPLOADED'}
                        </span>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-purple-950/90 border border-purple-400/35 flex items-center justify-center text-purple-300 mb-4">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                      </div>
                      <h4 className="text-base font-bold text-white">Answer Key</h4>
                      <p className="text-xs text-purple-200/60 mt-1">
                        {specialMode === 'ai_knowledge'
                          ? 'AI Knowledge mode evaluates using internal subject mastery without an Answer Key file.'
                          : 'Upload the official OMR bubble key and marking rubric for LLM semantic comparison.'}
                      </p>
                    </div>

                    {slotSkeletons.ak && (
                      <div className="my-4 space-y-2">
                        <div className="h-4 rounded skeleton-box w-2/3" />
                        <div className="h-9 rounded-lg skeleton-box w-full" />
                      </div>
                    )}

                    {!slotSkeletons.ak && referenceDoc && specialMode !== 'ai_knowledge' && (
                      <div className="my-4 p-3 rounded-xl bg-emerald-950/30 border border-emerald-400/40 flex items-center justify-between gap-2">
                        <div className="truncate">
                          <p className="text-xs font-semibold text-emerald-200 truncate">
                            {referenceDoc.name}
                          </p>
                          <p className="text-[10px] font-mono text-emerald-300/75">
                            Rubric Ready • {formatFileSize(referenceDoc)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReferenceDoc(null)}
                          className="text-xs font-mono text-emerald-300 hover:text-rose-300 px-1.5 py-0.5"
                          title="Clear Answer Key"
                        >
                          &times;
                        </button>
                      </div>
                    )}

                    <div className="mt-5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => akInputRef.current?.click()}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-purple-600/25 hover:bg-purple-600/45 border border-purple-400/40 text-xs font-semibold text-white transition min-h-[42px]"
                      >
                        Browse File...
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickDemoSlot('ak')}
                        title="Mount Demo Answer Key"
                        className="py-2.5 px-3 rounded-xl bg-[#160c2e] hover:bg-purple-900/50 border border-purple-500/30 text-[11px] font-mono text-purple-200 transition min-h-[42px]"
                      >
                        + Demo Key
                      </button>
                    </div>
                  </div>

                  {/* Slot 03: Student Sheet */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleSlotDrop('ss', e)}
                    className={`liquid-glass border-glow p-5 sm:p-6 rounded-2xl flex flex-col justify-between relative overflow-hidden ${
                      answerSheet ? 'border-glow-active' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-purple-950 border border-purple-500/30 text-purple-300">
                          SLOT 03 • REQUIRED
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            answerSheet ? 'text-emerald-400 font-semibold' : 'text-purple-400/60'
                          }`}
                        >
                          {answerSheet ? '1 READY' : '0 UPLOADED'}
                        </span>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-purple-950/90 border border-purple-400/35 flex items-center justify-center text-purple-300 mb-4">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      </div>
                      <h4 className="text-base font-bold text-white">Student Sheet</h4>
                      <p className="text-xs text-purple-200/60 mt-1">
                        Upload scanned OMR response sheets, handwritten booklets, or capture via device camera.
                      </p>
                    </div>

                    {slotSkeletons.ss && (
                      <div className="my-4 space-y-2">
                        <div className="h-4 rounded skeleton-box w-4/5" />
                        <div className="h-9 rounded-lg skeleton-box w-full" />
                      </div>
                    )}

                    {!slotSkeletons.ss && answerSheet && (
                      <div className="my-4 p-3 rounded-xl bg-emerald-950/30 border border-emerald-400/40 flex items-center justify-between gap-2">
                        <div className="truncate">
                          <p className="text-xs font-semibold text-emerald-200 truncate">
                            {answerSheet.name}
                          </p>
                          <p className="text-[10px] font-mono text-emerald-300/75">
                            Optical + Script Ready • {formatFileSize(answerSheet)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAnswerSheet(null)}
                          className="text-xs font-mono text-emerald-300 hover:text-rose-300 px-1.5 py-0.5"
                          title="Clear Student Sheet"
                        >
                          &times;
                        </button>
                      </div>
                    )}

                    <div className="mt-5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => ssInputRef.current?.click()}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-purple-600/25 hover:bg-purple-600/45 border border-purple-400/40 text-xs font-semibold text-white transition min-h-[42px]"
                      >
                        Browse...
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          playSound('click');
                          setIsSingleScannerOpen(true);
                        }}
                        title="Capture via Camera Scanner"
                        className="py-2.5 px-3 rounded-xl bg-[#160c2e] hover:bg-purple-900/50 border border-purple-500/30 text-purple-200 transition min-h-[42px] flex items-center justify-center"
                        aria-label="Open Camera Scanner"
                      >
                        <CameraIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickDemoSlot('ss')}
                        title="Mount Demo Student Script"
                        className="py-2.5 px-3 rounded-xl bg-[#160c2e] hover:bg-purple-900/50 border border-purple-500/30 text-[11px] font-mono text-purple-200 transition min-h-[42px]"
                      >
                        + Demo
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* STEP 3: NEURAL LLM EXECUTION BAR & LIVE OUTPUT */}
          <div className="mt-8 liquid-glass border-glow specular-beam p-5 sm:p-6 rounded-3xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-700 flex items-center justify-center orb-glow shrink-0">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Neural LLM Grading Execution</h4>
                  <p className="text-xs text-purple-300/75 mt-0.5">
                    {isReadyToGrade
                      ? `All required documents mounted (${uploadedSlotsCount}/3) for ${activeModeLabel}${
                          liveGradingEnabled ? ' · Studio opens immediately with live tool calls' : ''
                        }.`
                      : `${uploadedSlotsCount} of 3 required documents mounted. Upload Question Paper, Answer Key, and Student Sheet to begin.`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
                {isLiveEvaluating && !isReportStudioOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      playSound('portal');
                      setIsReportStudioOpen(true);
                    }}
                    className="w-full md:w-auto px-5 py-3.5 rounded-2xl bg-fuchsia-600/25 border border-fuchsia-400/50 text-xs sm:text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-600/40 transition min-h-[48px] whitespace-nowrap"
                  >
                    Reopen Live Studio
                  </button>
                )}
                <button
                  type="button"
                  disabled={isLoading || !isReadyToGrade}
                  onClick={handleGrade}
                  className={`btn-quantix w-full md:w-auto px-7 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold text-white flex items-center justify-center gap-2.5 min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                    !isReadyToGrade ? 'opacity-60' : ''
                  }`}
                >
                  <span>
                    {isLoading
                      ? liveGradingEnabled
                        ? 'Live Studio Grading...'
                        : 'Evaluating with Vision LLM...'
                      : liveGradingEnabled
                      ? 'Launch Live Grading Studio'
                      : 'Run AI Evaluation Pipeline'}
                  </span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-5 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs sm:text-sm">
                <p className="font-bold text-rose-100">Evaluation Error</p>
                <p className="mt-0.5">{error}</p>
              </div>
            )}

            {(isLoading || gradingSteps.length > 0) && (
              <div className="mt-6 pt-6 border-t border-purple-500/20">
                <GradingProgress
                  steps={gradingSteps}
                  isLoading={isLoading}
                  percentage={gradingPercentage}
                />
              </div>
            )}

            {!isLoading && (result !== null || batchResults.length > 0) && (
              <div className="mt-6 pt-6 border-t border-purple-500/20 animate-surface-enter">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-[11px] font-mono bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-semibold">
                      EVALUATION COMPLETE
                    </span>
                    <span className="px-3 py-1 rounded-full text-[11px] font-mono bg-purple-950 border border-purple-400/40 text-purple-200 uppercase">
                      {activeModeLabel}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        playSound('click');
                        setWorkspaceTab('dashboard');
                      }}
                      className="text-xs font-semibold text-purple-300 hover:text-white underline"
                    >
                      View Dashboard Metrics &rarr;
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('portal');
                        setIsReportStudioOpen(true);
                      }}
                      className="btn-quantix px-4 py-2 rounded-full text-xs font-semibold text-white"
                    >
                      Open Student Report Studio &rarr;
                    </button>
                  </div>
                </div>

                {result && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-[#0c061c] border border-purple-500/30">
                      <p className="text-[11px] text-purple-300/60 font-mono">FINAL EVALUATED SCORE</p>
                      <p className="text-2xl font-extrabold text-white font-mono mt-1 glow-text tabular-nums">
                        {result.total_score} / {result.max_marks} (
                        {result.max_marks > 0
                          ? Math.round((result.total_score / result.max_marks) * 100)
                          : 0}
                        %)
                      </p>
                      <p className="text-[11px] text-emerald-400 mt-1">
                        Grade {result.letter_grade} • {result.pass_status}
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-[#0c061c] border border-purple-500/30">
                      <p className="text-[11px] text-purple-300/60 font-mono">QUESTIONS AUDITED</p>
                      <p className="text-2xl font-extrabold text-white font-mono mt-1 tabular-nums">
                        {result.questions.length} Items
                      </p>
                      <p className="text-[11px] text-purple-300/70 mt-1">
                        Spatial pins mapped &amp; interactive
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-[#0c061c] border border-purple-500/30">
                      <p className="text-[11px] text-purple-300/60 font-mono">ENGINE LATENCY</p>
                      <p className="text-2xl font-extrabold text-white font-mono mt-1 tabular-nums">
                        {result.grading_duration ? `${result.grading_duration.toFixed(1)}s` : 'Ready'}
                      </p>
                      <p className="text-[11px] text-purple-300/70 mt-1">
                        Click &ldquo;Open Student Report Studio&rdquo; for full audit
                      </p>
                    </div>
                  </div>
                )}

                {isBatchMode && batchResults.length > 0 && (
                  <div className="p-4 rounded-2xl bg-[#0c061c] border border-purple-500/30 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] text-purple-300/60 font-mono">BATCH SUMMARY</p>
                      <p className="text-lg font-bold text-white mt-0.5">
                        {batchResults.filter((b) => b.result !== null).length} of {batchResults.length} sheets scored
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsReportStudioOpen(true)}
                      className="px-4 py-2 rounded-full bg-purple-600/30 border border-purple-400/50 text-xs font-semibold text-white hover:bg-purple-600 transition"
                    >
                      Inspect All Students
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* THEMED STUDENT REPORT STUDIO (Full Interactive Overlay)           */}
      {/* ================================================================= */}
      {isReportStudioOpen && (isLiveEvaluating || result !== null || batchResults.length > 0) && (
        <ResultsDisplay
          isBatchMode={isBatchMode}
          result={result}
          batchResults={batchResults}
          onClose={() => setIsReportStudioOpen(false)}
          questionPaperFile={questionPaper}
          referenceDocFile={referenceDoc}
          answerSheetFile={answerSheet}
          isLiveEvaluating={isLiveEvaluating}
          liveStatus={liveStatus}
          liveThinking={liveThinking}
          liveToolEvents={liveToolEvents}
          recentQuestionId={recentQuestionId}
          isSpeedFixer={specialMode === 'speed_fixer'}
          liveError={liveError}
          onStopLive={handleStopLive}
          batchLiveStates={batchLiveStates}
          activeBatchStudentId={activeBatchStudentId}
        />
      )}

      {/* Single-Sheet Camera Scanner */}
      {isSingleScannerOpen && (
        <CameraScanner
          onCapture={(file) => mountFileWithSkeleton('ss', file)}
          onClose={() => setIsSingleScannerOpen(false)}
        />
      )}

      {/* OMR Template Editor */}
      {isOmrEditorOpen && omrTemplate && (
        <OMRTemplateEditor
          templateFile={omrTemplate}
          initialBoxes={omrBoundingBoxes}
          onSave={(boxes) => {
            setOmrBoundingBoxes(boxes);
            setIsOmrEditorOpen(false);
            pushToast(`Saved ${boxes.length} calibrated OMR region(s).`, 'success');
          }}
          onClose={() => setIsOmrEditorOpen(false)}
        />
      )}

      {/* Reference Library Modal */}
      {showReferenceLibrary && (
        <ReferenceLibrary
          onClose={() => setShowReferenceLibrary(false)}
          onTestNow={(testData) => {
            const qpFile = new File([testData.questionPaperText], 'Model-Test-QP.txt', {
              type: 'text/plain',
            });
            const keyFile = new File([testData.answerKeyText], 'Model-Test-Key.txt', {
              type: 'text/plain',
            });
            const studentFile = new File([testData.studentSheetText], 'Model-Test-Student.txt', {
              type: 'text/plain',
            });

            setQuestionPaper(qpFile);
            setReferenceDoc(keyFile);
            setAnswerSheet(studentFile);
            setIsBatchMode(false);
            setBaseMode('written');
            setPrecisionTier('pro');
            setSpecialMode('none');
            setShowReferenceLibrary(false);
            setWorkspaceTab('studio');
            pushToast('Model Test package mounted in Evaluation Studio.', 'success');
          }}
        />
      )}

      {/* MCP Server Connection Modal */}
      {isMcpModalOpen && (
        <McpConnectModal
          onClose={() => setIsMcpModalOpen(false)}
          mountedSummary={{
            questionPaper: questionPaper?.name || null,
            answerKey:
              specialMode === 'ai_knowledge'
                ? 'AI Knowledge (No Key)'
                : referenceDoc?.name || null,
            studentSheet: isBatchMode
              ? batchStudents.length > 0
                ? `${batchStudents.length} batch sheet(s)`
                : null
              : answerSheet?.name || null,
          }}
          historyCount={evalHistory.length}
        />
      )}
    </div>
  );
}

export default App;
