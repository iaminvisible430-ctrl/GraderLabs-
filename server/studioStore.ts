import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.resolve(__dirname, '..', '.graderlabs-history.json');

export interface RawAnnotationInput {
  ymin?: unknown;
  xmin?: unknown;
  ymax?: unknown;
  xmax?: unknown;
  page_number?: unknown;
}

export interface SanitizedAnnotation {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  page_number: number;
}

export interface SanitizedQuestionResult {
  question_id: string;
  question_text: string;
  student_answer: string;
  score: number;
  full_marks: number;
  confidence: number;
  feedback: string;
  matched_passages: string[];
  fixer_note?: string;
  annotation?: SanitizedAnnotation;
  qp_annotation?: SanitizedAnnotation;
  ref_annotation?: SanitizedAnnotation;
  [key: string]: unknown;
}

export interface SanitizedGradingResult {
  total_score: number;
  max_marks: number;
  pass_status: string;
  letter_grade: string;
  special_award: string | null;
  teacher_overall_comments?: string | null;
  speed_fixer_summary?: string | null;
  grading_duration?: number;
  provider_used?: string;
  questions: SanitizedQuestionResult[];
  [key: string]: unknown;
}

export interface WorkspaceSlotDoc {
  name: string;
  mimeType: string;
  size: number;
  textContent: string;
  pageCount: number;
  pages: string[]; // base64 JPEG images without data URI prefix
}

export interface WorkspaceStudentDoc extends WorkspaceSlotDoc {
  studentId: string;
  rollNumber?: string;
  studentClass?: string;
}

export interface StudioWorkspaceState {
  questionPaper: WorkspaceSlotDoc | null;
  answerKey: WorkspaceSlotDoc | null;
  studentSheets: WorkspaceStudentDoc[];
  modeLabel: string;
  baseMode: 'omr' | 'written' | 'hybrid';
  specialMode: 'none' | 'forensic' | 'ai_knowledge' | 'speed_fixer';
  omrBoundingBoxes: Array<{
    id: string;
    question_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  updatedAt: string | null;
}

export interface StoredEvaluationRecord {
  id: string;
  label: string;
  timestamp: string;
  createdAt: string;
  modeLabel: string;
  baseMode: 'omr' | 'written' | 'hybrid';
  isBatch: boolean;
  sheetsCount: number;
  questionsCount: number;
  omrCount: number;
  writtenCount: number;
  avgPercentage: number;
  totalScore: number;
  maxMarks: number;
  source: 'app' | 'mcp';
  agentName?: string;
  sessionId?: string;
  documentNames?: {
    questionPaper?: string;
    answerKey?: string;
    answerSheet?: string;
  };
  singleResult: SanitizedGradingResult | null;
}

export interface McpToolEventPayload {
  id: string;
  timestamp: string;
  toolName:
    | 'register_question_evaluation'
    | 'apply_speed_fixer_repair'
    | 'finalize_exam_evaluation'
    | 'system';
  summary: string;
  questionId?: string | number;
  score?: number;
  fullMarks?: number;
  hasAnnotation?: boolean;
  status: 'running' | 'success' | 'fixed';
}

export interface McpLiveSession {
  sessionId: string;
  agentName: string;
  studentName: string;
  mode: string;
  speedFixer: boolean;
  startedAt: number;
  createdAtIso: string;
  thinking: string;
  questions: SanitizedQuestionResult[];
  seenKeys: Map<string, number>;
  fixerDescriptions: string[];
  toolEvents: McpToolEventPayload[];
  status: 'live' | 'completed';
}

// --- Shared Sanitization & Grading Math ---

export function sanitizeAnnotation(raw: RawAnnotationInput | undefined | null): SanitizedAnnotation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  let ymin = Number(raw.ymin);
  let xmin = Number(raw.xmin);
  let ymax = Number(raw.ymax);
  let xmax = Number(raw.xmax);

  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return undefined;
  if (ymin === 0 && xmin === 0 && ymax === 0 && xmax === 0) return undefined;

  if (Math.max(ymin, xmin, ymax, xmax) <= 1.0 && Math.min(ymin, xmin, ymax, xmax) >= 0) {
    ymin *= 1000;
    xmin *= 1000;
    ymax *= 1000;
    xmax *= 1000;
  }

  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];

  ymin = Math.max(0, Math.min(1000, ymin));
  xmin = Math.max(0, Math.min(1000, xmin));
  ymax = Math.max(0, Math.min(1000, ymax));
  xmax = Math.max(0, Math.min(1000, xmax));

  const MIN_SPAN = 14;
  if (xmax - xmin < MIN_SPAN) {
    const cx = (xmin + xmax) / 2;
    xmin = Math.max(0, Math.min(1000 - MIN_SPAN, cx - MIN_SPAN / 2));
    xmax = Math.min(1000, xmin + MIN_SPAN);
  }
  if (ymax - ymin < MIN_SPAN) {
    const cy = (ymin + ymax) / 2;
    ymin = Math.max(0, Math.min(1000 - MIN_SPAN, cy - MIN_SPAN / 2));
    ymax = Math.min(1000, ymin + MIN_SPAN);
  }

  const rawPage = Number(raw.page_number);
  const page_number = Number.isFinite(rawPage) && rawPage >= 1 ? Math.round(rawPage) : 1;

  return {
    ymin: Math.round(ymin),
    xmin: Math.round(xmin),
    ymax: Math.round(ymax),
    xmax: Math.round(xmax),
    page_number,
  };
}

export function normalizeQuestionId(rawId: unknown, fallbackIndex: number): string {
  const raw = String(rawId ?? '').trim();
  if (!raw) return String(fallbackIndex + 1);
  const cleaned = raw
    .replace(/^question\s*/i, '')
    .replace(/^q\.?\s*/i, '')
    .replace(/[.:]+$/, '')
    .trim();
  return cleaned || String(fallbackIndex + 1);
}

export function computeDerivedGradeInfo(score: number, maxMarks: number) {
  if (maxMarks <= 0) {
    return { pass_status: 'Fail', letter_grade: 'F', special_award: null as string | null };
  }
  const pct = (score / maxMarks) * 100;
  let letter_grade = 'F';
  if (pct >= 90) letter_grade = 'A+';
  else if (pct >= 80) letter_grade = 'A';
  else if (pct >= 70) letter_grade = 'B';
  else if (pct >= 60) letter_grade = 'C';
  else if (pct >= 50) letter_grade = 'D';
  else if (pct >= 33) letter_grade = 'E';
  return {
    pass_status: pct >= 33 ? 'Pass' : 'Fail',
    letter_grade,
    special_award: pct >= 90 ? 'Distinction' : null,
  };
}

export function sanitizeQuestionResult(
  q: Record<string, unknown>,
  idx: number,
  speedFixer = false
): SanitizedQuestionResult {
  const fixerNotes: string[] = [];
  if (typeof q.fixer_note === 'string' && q.fixer_note.trim()) {
    fixerNotes.push(q.fixer_note.trim());
  }

  const rawId = q.question_id ?? String(idx + 1);
  const question_id = speedFixer ? normalizeQuestionId(rawId, idx) : String(rawId);
  if (speedFixer && question_id !== String(rawId).trim()) {
    fixerNotes.push(`Normalized QID "${String(rawId).trim()}" → "Q${question_id}"`);
  }

  let fullMarks = Number(q.full_marks);
  if (!Number.isFinite(fullMarks) || fullMarks < 0) {
    fullMarks = 1;
    if (speedFixer) fixerNotes.push('Defaulted invalid max marks to 1');
  }

  let score = Number(q.score);
  if (!Number.isFinite(score)) {
    score = 0;
  }
  if (score < 0) {
    if (speedFixer) fixerNotes.push(`Clamped negative score ${score} → 0`);
    score = 0;
  } else if (fullMarks > 0 && score > fullMarks) {
    if (speedFixer) fixerNotes.push(`Clamped score ${score} → max ${fullMarks}`);
    score = fullMarks;
  }
  score = Math.round(score * 100) / 100;

  let confidence = Number(q.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.9;
  confidence = Math.max(0, Math.min(1, confidence));

  const annotation = sanitizeAnnotation(q.annotation as RawAnnotationInput | undefined);
  const qp_annotation = sanitizeAnnotation(q.qp_annotation as RawAnnotationInput | undefined);
  const ref_annotation = sanitizeAnnotation(q.ref_annotation as RawAnnotationInput | undefined);

  return {
    ...q,
    question_id,
    question_text: typeof q.question_text === 'string' ? q.question_text : '',
    student_answer: typeof q.student_answer === 'string' ? q.student_answer : '',
    score,
    full_marks: fullMarks,
    confidence,
    feedback: typeof q.feedback === 'string' ? q.feedback : '',
    matched_passages: Array.isArray(q.matched_passages)
      ? q.matched_passages.map((p) => String(p))
      : [],
    fixer_note: fixerNotes.length > 0 ? fixerNotes.join(' · ') : undefined,
    annotation,
    qp_annotation,
    ref_annotation,
  };
}

export function sanitizeGradingResult(
  parsed: Record<string, unknown>,
  speedFixer = false
): SanitizedGradingResult {
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = rawQuestions.map((q: Record<string, unknown>, idx: number) =>
    sanitizeQuestionResult(q, idx, speedFixer)
  );

  const computedTotal = Math.round(questions.reduce((sum, q) => sum + q.score, 0) * 100) / 100;
  const computedMax = Math.round(questions.reduce((sum, q) => sum + q.full_marks, 0) * 100) / 100;

  const rawTotal = Number(parsed.total_score);
  const rawMax = Number(parsed.max_marks);

  const total_score =
    speedFixer || !Number.isFinite(rawTotal) || computedMax > 0 ? computedTotal : rawTotal;
  const max_marks =
    speedFixer || !Number.isFinite(rawMax) || computedMax > 0 ? computedMax : rawMax;

  const derived = computeDerivedGradeInfo(total_score, max_marks);

  let speed_fixer_summary =
    typeof parsed.speed_fixer_summary === 'string' && parsed.speed_fixer_summary.trim()
      ? parsed.speed_fixer_summary.trim()
      : null;
  if (speedFixer && !speed_fixer_summary) {
    const fixedCount = questions.filter((q) => Boolean(q.fixer_note)).length;
    const repairedTotal =
      Number.isFinite(rawTotal) && Math.abs(rawTotal - computedTotal) > 0.01
        ? ` Reconciled total ${rawTotal} → ${computedTotal}.`
        : '';
    speed_fixer_summary = `Speed Fixer audited ${questions.length} question(s)${
      fixedCount > 0 ? `, applied ${fixedCount} auto-repair(s)` : ', verified all QIDs & bounds'
    }.${repairedTotal}`;
  }

  return {
    ...parsed,
    total_score,
    max_marks,
    pass_status:
      typeof parsed.pass_status === 'string' && parsed.pass_status.trim() && !speedFixer
        ? parsed.pass_status.trim()
        : derived.pass_status,
    letter_grade:
      typeof parsed.letter_grade === 'string' && parsed.letter_grade.trim() && !speedFixer
        ? parsed.letter_grade.trim()
        : derived.letter_grade,
    special_award:
      typeof parsed.special_award === 'string' && parsed.special_award.trim()
        ? parsed.special_award.trim()
        : derived.special_award,
    teacher_overall_comments:
      typeof parsed.teacher_overall_comments === 'string'
        ? parsed.teacher_overall_comments
        : undefined,
    speed_fixer_summary,
    questions,
  };
}

// --- Studio Store Singleton State ---

let workspaceState: StudioWorkspaceState = {
  questionPaper: null,
  answerKey: null,
  studentSheets: [],
  modeLabel: 'OMR + Written (Auto Detection)',
  baseMode: 'hybrid',
  specialMode: 'none',
  omrBoundingBoxes: [],
  updatedAt: null,
};

const liveSessions = new Map<string, McpLiveSession>();
let latestSessionId: string | null = null;
const sseClients = new Set<Response>();

function loadHistoryFromDisk(): StoredEvaluationRecord[] {
  try {
    if (!fs.existsSync(HISTORY_FILE_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredEvaluationRecord[]) : [];
  } catch {
    return [];
  }
}

function saveHistoryToDisk(records: StoredEvaluationRecord[]): void {
  try {
    const trimmed = records.slice(-100);
    fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Warning: Could not persist studio evaluation history:', err);
  }
}

let evaluationHistory: StoredEvaluationRecord[] = loadHistoryFromDisk();

export function broadcastStudioEvent(event: string, data: Record<string, unknown>): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      if (!client.writableEnded) {
        client.write(payload);
      } else {
        sseClients.delete(client);
      }
    } catch {
      sseClients.delete(client);
    }
  }
}

export function subscribeStudioEvents(res: Response): () => void {
  sseClients.add(res);
  return () => {
    sseClients.delete(res);
  };
}

export function getWorkspaceState(): StudioWorkspaceState {
  return workspaceState;
}

export function syncWorkspaceState(input: Partial<StudioWorkspaceState>): StudioWorkspaceState {
  const normalizeSlot = (slot: unknown): WorkspaceSlotDoc | null => {
    if (!slot || typeof slot !== 'object') return null;
    const s = slot as Record<string, unknown>;
    const pages = Array.isArray(s.pages)
      ? s.pages
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
          .slice(0, 12)
          .map((p) => p.replace(/^data:image\/[^;]+;base64,/, ''))
      : [];
    return {
      name: String(s.name || 'Document'),
      mimeType: String(s.mimeType || 'application/pdf'),
      size: Number(s.size) || 0,
      textContent: typeof s.textContent === 'string' ? s.textContent : '',
      pageCount: Math.max(pages.length, Number(s.pageCount) || (pages.length > 0 ? pages.length : 1)),
      pages,
    };
  };

  const normalizeStudents = (arr: unknown): WorkspaceStudentDoc[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item, idx): WorkspaceStudentDoc | null => {
        const slot = normalizeSlot(item);
        if (!slot) return null;
        const raw = item as Record<string, unknown>;
        return {
          ...slot,
          studentId: String(raw.studentId || `student-${idx + 1}`),
          rollNumber: typeof raw.rollNumber === 'string' ? raw.rollNumber : undefined,
          studentClass: typeof raw.studentClass === 'string' ? raw.studentClass : undefined,
        };
      })
      .filter((x): x is WorkspaceStudentDoc => x !== null);
  };

  workspaceState = {
    questionPaper:
      input.questionPaper === undefined
        ? workspaceState.questionPaper
        : normalizeSlot(input.questionPaper),
    answerKey:
      input.answerKey === undefined ? workspaceState.answerKey : normalizeSlot(input.answerKey),
    studentSheets:
      input.studentSheets === undefined
        ? workspaceState.studentSheets
        : normalizeStudents(input.studentSheets),
    modeLabel:
      typeof input.modeLabel === 'string' && input.modeLabel.trim()
        ? input.modeLabel.trim()
        : workspaceState.modeLabel,
    baseMode:
      input.baseMode === 'omr' || input.baseMode === 'written' || input.baseMode === 'hybrid'
        ? input.baseMode
        : workspaceState.baseMode,
    specialMode:
      input.specialMode === 'none' ||
      input.specialMode === 'forensic' ||
      input.specialMode === 'ai_knowledge' ||
      input.specialMode === 'speed_fixer'
        ? input.specialMode
        : workspaceState.specialMode,
    omrBoundingBoxes: Array.isArray(input.omrBoundingBoxes)
      ? input.omrBoundingBoxes
      : workspaceState.omrBoundingBoxes,
    updatedAt: new Date().toISOString(),
  };

  return workspaceState;
}

export function getEvaluationHistory(): StoredEvaluationRecord[] {
  return evaluationHistory;
}

export function getEvaluationRecordById(id: string): StoredEvaluationRecord | undefined {
  return evaluationHistory.find((r) => r.id === id);
}

export function upsertEvaluationRecord(record: StoredEvaluationRecord): StoredEvaluationRecord {
  const existingIdx = evaluationHistory.findIndex((r) => r.id === record.id);
  if (existingIdx >= 0) {
    evaluationHistory[existingIdx] = record;
  } else {
    evaluationHistory = [...evaluationHistory, record];
  }
  saveHistoryToDisk(evaluationHistory);
  broadcastStudioEvent('history_updated', {
    record,
    totalCount: evaluationHistory.length,
  });
  return record;
}

export function deleteEvaluationRecord(id: string): boolean {
  const before = evaluationHistory.length;
  evaluationHistory = evaluationHistory.filter((r) => r.id !== id);
  if (evaluationHistory.length !== before) {
    saveHistoryToDisk(evaluationHistory);
    broadcastStudioEvent('history_updated', {
      deletedId: id,
      totalCount: evaluationHistory.length,
    });
    return true;
  }
  return false;
}

function formatShortTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFullTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function inferBaseMode(modeStr: string): 'omr' | 'written' | 'hybrid' {
  const low = modeStr.toLowerCase();
  if (low.includes('omr') && !low.includes('written') && !low.includes('hybrid')) return 'omr';
  if (low.includes('written') || low.includes('handwrit')) return 'written';
  return 'hybrid';
}

export function startMcpLiveSession(params: {
  studentName?: string;
  mode?: string;
  agentName?: string;
  thinkingSummary?: string;
}): McpLiveSession {
  const sessionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mode = params.mode?.trim() || workspaceState.modeLabel || 'MCP External AI Evaluation';
  const agentName = params.agentName?.trim() || 'Connected MCP AI';
  const defaultSheetName =
    workspaceState.studentSheets[0]?.name.replace(/\.[^/.]+$/, '') || 'Student Sheet';
  const studentName = params.studentName?.trim() || defaultSheetName;
  const speedFixer = mode.toLowerCase().includes('speed fixer');

  const sysEvent: McpToolEventPayload = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: formatFullTime(),
    toolName: 'system',
    summary: `MCP Agent (${agentName}) started live studio session for ${studentName}`,
    status: 'running',
  };

  const session: McpLiveSession = {
    sessionId,
    agentName,
    studentName,
    mode,
    speedFixer,
    startedAt: Date.now(),
    createdAtIso: new Date().toISOString(),
    thinking: params.thinkingSummary?.trim() || '',
    questions: [],
    seenKeys: new Map(),
    fixerDescriptions: [],
    toolEvents: [sysEvent],
    status: 'live',
  };

  liveSessions.set(sessionId, session);
  latestSessionId = sessionId;

  broadcastStudioEvent('mcp_session_started', {
    sessionId,
    agentName,
    studentName,
    mode,
    speedFixer,
    thinking: session.thinking,
    toolEvent: sysEvent,
  });

  return session;
}

function resolveSession(sessionId?: string): McpLiveSession {
  if (sessionId && liveSessions.has(sessionId)) {
    return liveSessions.get(sessionId)!;
  }
  if (latestSessionId && liveSessions.has(latestSessionId)) {
    const latest = liveSessions.get(latestSessionId)!;
    if (latest.status === 'live') return latest;
  }
  return startMcpLiveSession({});
}

export function registerMcpQuestion(
  sessionId: string | undefined,
  args: Record<string, unknown>
): {
  sessionId: string;
  question: SanitizedQuestionResult;
  runningScore: number;
  runningMax: number;
  registeredCount: number;
} {
  const session = resolveSession(sessionId);
  const idx = session.questions.length;
  let sanitizedQ = sanitizeQuestionResult(args, idx, session.speedFixer);
  const qKey = String(sanitizedQ.question_id).toLowerCase();

  if (session.seenKeys.has(qKey)) {
    const existingIdx = session.seenKeys.get(qKey)!;
    const existing = session.questions[existingIdx];
    const sameQuestion =
      existing &&
      existing.full_marks === sanitizedQ.full_marks &&
      (existing.question_text.slice(0, 24).toLowerCase() ===
        sanitizedQ.question_text.slice(0, 24).toLowerCase() ||
        existing.annotation?.page_number === sanitizedQ.annotation?.page_number);

    if (sameQuestion) {
      session.questions[existingIdx] = sanitizedQ;
    } else {
      let uniqueId = `B${sanitizedQ.question_id}`;
      let suffixNum = 2;
      if (session.seenKeys.has(uniqueId.toLowerCase())) {
        while (session.seenKeys.has(`${sanitizedQ.question_id}-${suffixNum}`.toLowerCase())) {
          suffixNum++;
        }
        uniqueId = `${sanitizedQ.question_id}-${suffixNum}`;
      }
      sanitizedQ = {
        ...sanitizedQ,
        question_id: uniqueId,
        fixer_note: sanitizedQ.fixer_note
          ? `${sanitizedQ.fixer_note} · Section ID ${uniqueId}`
          : `Section ID ${uniqueId}`,
      };
      session.seenKeys.set(uniqueId.toLowerCase(), session.questions.length);
      session.questions.push(sanitizedQ);
    }
  } else {
    session.seenKeys.set(qKey, session.questions.length);
    session.questions.push(sanitizedQ);
  }

  const runningScore =
    Math.round(session.questions.reduce((s, q) => s + q.score, 0) * 100) / 100;
  const runningMax =
    Math.round(session.questions.reduce((s, q) => s + q.full_marks, 0) * 100) / 100;

  const toolEvent: McpToolEventPayload = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: formatFullTime(),
    toolName: 'register_question_evaluation',
    questionId: sanitizedQ.question_id,
    score: sanitizedQ.score,
    fullMarks: sanitizedQ.full_marks,
    hasAnnotation: Boolean(sanitizedQ.annotation),
    status: sanitizedQ.fixer_note ? 'fixed' : 'success',
    summary: `[${session.agentName}] Q${sanitizedQ.question_id} registered · ${sanitizedQ.score}/${sanitizedQ.full_marks} marks`,
  };
  session.toolEvents.push(toolEvent);

  broadcastStudioEvent('mcp_question_graded', {
    sessionId: session.sessionId,
    agentName: session.agentName,
    question: sanitizedQ,
    total_score: runningScore,
    max_marks: runningMax,
    toolEvent,
  });

  return {
    sessionId: session.sessionId,
    question: sanitizedQ,
    runningScore,
    runningMax,
    registeredCount: session.questions.length,
  };
}

export function applyMcpSpeedFixerRepair(
  sessionId: string | undefined,
  args: { question_id: string; issue_type: string; description: string }
): { sessionId: string; toolEvent: McpToolEventPayload } {
  const session = resolveSession(sessionId);
  const qid = normalizeQuestionId(args.question_id, session.questions.length);
  const issueType = String(args.issue_type || 'auto_repair');
  const desc = String(args.description || 'Auto-repaired formatting & marks');
  session.fixerDescriptions.push(`Q${qid}: ${desc}`);

  const toolEvent: McpToolEventPayload = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: formatFullTime(),
    toolName: 'apply_speed_fixer_repair',
    questionId: qid,
    status: 'fixed',
    summary: `[${session.agentName}] Speed Fixer (${issueType}) on Q${qid}: ${desc}`,
  };
  session.toolEvents.push(toolEvent);

  broadcastStudioEvent('mcp_tool_call', {
    sessionId: session.sessionId,
    toolEvent,
  });

  return { sessionId: session.sessionId, toolEvent };
}

export function finalizeMcpSession(
  sessionId: string | undefined,
  meta: Record<string, unknown>
): { record: StoredEvaluationRecord; result: SanitizedGradingResult } {
  const session = resolveSession(sessionId);
  if (session.questions.length === 0) {
    throw new Error(
      'Cannot finalize session with 0 registered questions. Call register_question_evaluation for each question first.'
    );
  }

  const computedTotal =
    Math.round(session.questions.reduce((s, q) => s + q.score, 0) * 100) / 100;
  const computedMax =
    Math.round(session.questions.reduce((s, q) => s + q.full_marks, 0) * 100) / 100;

  const rawFinalTotal = Number(meta.total_score);
  const rawFinalMax = Number(meta.max_marks);
  const finalTotal =
    computedMax > 0 || !Number.isFinite(rawFinalTotal) ? computedTotal : rawFinalTotal;
  const finalMax =
    computedMax > 0 || !Number.isFinite(rawFinalMax) ? computedMax : rawFinalMax;
  const derived = computeDerivedGradeInfo(finalTotal, finalMax);

  const combinedFixerSummary =
    typeof meta.speed_fixer_summary === 'string' && meta.speed_fixer_summary.trim()
      ? meta.speed_fixer_summary.trim()
      : session.fixerDescriptions.length > 0
      ? session.fixerDescriptions.join(' · ')
      : session.speedFixer
      ? `Speed Fixer audited ${session.questions.length} question(s).`
      : null;

  const durationSec = Math.max(0.1, (Date.now() - session.startedAt) / 1000);
  const completedResult: SanitizedGradingResult = {
    total_score: finalTotal,
    max_marks: finalMax,
    pass_status:
      typeof meta.pass_status === 'string' && meta.pass_status.trim() && !session.speedFixer
        ? meta.pass_status.trim()
        : derived.pass_status,
    letter_grade:
      typeof meta.letter_grade === 'string' && meta.letter_grade.trim() && !session.speedFixer
        ? meta.letter_grade.trim()
        : derived.letter_grade,
    special_award:
      typeof meta.special_award === 'string' && meta.special_award.trim()
        ? meta.special_award.trim()
        : derived.special_award,
    teacher_overall_comments:
      typeof meta.teacher_overall_comments === 'string' && meta.teacher_overall_comments.trim()
        ? meta.teacher_overall_comments.trim()
        : `Evaluated ${session.questions.length} question(s) via MCP (${session.agentName}).`,
    speed_fixer_summary: combinedFixerSummary,
    grading_duration: durationSec,
    provider_used: `MCP (${session.agentName})`,
    questions: session.questions,
  };

  session.status = 'completed';

  const toolEvent: McpToolEventPayload = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: formatFullTime(),
    toolName: 'finalize_exam_evaluation',
    status: 'success',
    summary: `[${session.agentName}] Finalized ${session.questions.length} question(s) · ${finalTotal}/${finalMax}`,
  };
  session.toolEvents.push(toolEvent);

  const pct = finalMax > 0 ? Math.round((finalTotal / finalMax) * 100) : 0;
  const studentLabel =
    (typeof meta.student_name === 'string' && meta.student_name.trim()) || session.studentName;
  const baseMode = inferBaseMode(session.mode);

  const record: StoredEvaluationRecord = {
    id: `mcp-run-${Date.now()}`,
    label: studentLabel.slice(0, 18),
    timestamp: formatShortTime(),
    createdAt: new Date().toISOString(),
    modeLabel: `${session.mode} · MCP (${session.agentName})`,
    baseMode,
    isBatch: false,
    sheetsCount: 1,
    questionsCount: completedResult.questions.length,
    omrCount: baseMode === 'omr' || baseMode === 'hybrid' ? 1 : 0,
    writtenCount: baseMode === 'written' || baseMode === 'hybrid' ? 1 : 0,
    avgPercentage: pct,
    totalScore: completedResult.total_score,
    maxMarks: completedResult.max_marks,
    source: 'mcp',
    agentName: session.agentName,
    sessionId: session.sessionId,
    documentNames: {
      questionPaper: workspaceState.questionPaper?.name,
      answerKey: workspaceState.answerKey?.name,
      answerSheet: workspaceState.studentSheets[0]?.name || studentLabel,
    },
    singleResult: completedResult,
  };

  upsertEvaluationRecord(record);

  broadcastStudioEvent('mcp_session_completed', {
    sessionId: session.sessionId,
    agentName: session.agentName,
    result: completedResult,
    record,
    toolEvent,
  });

  return { record, result: completedResult };
}

export function saveDirectStudioEvaluation(input: {
  studentName?: string;
  modeLabel?: string;
  agentName?: string;
  total_score?: number;
  max_marks?: number;
  pass_status?: string;
  letter_grade?: string;
  special_award?: string;
  teacher_overall_comments?: string;
  speed_fixer_summary?: string;
  questions: Array<Record<string, unknown>>;
}): { record: StoredEvaluationRecord; result: SanitizedGradingResult } {
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error('questions array must contain at least one evaluated question.');
  }

  const mode = input.modeLabel?.trim() || workspaceState.modeLabel || 'MCP Studio Evaluation';
  const agentName = input.agentName?.trim() || 'Connected MCP AI';
  const speedFixer = mode.toLowerCase().includes('speed fixer');
  const sanitized = sanitizeGradingResult(
    {
      total_score: input.total_score,
      max_marks: input.max_marks,
      pass_status: input.pass_status,
      letter_grade: input.letter_grade,
      special_award: input.special_award,
      teacher_overall_comments: input.teacher_overall_comments,
      speed_fixer_summary: input.speed_fixer_summary,
      questions: input.questions,
    },
    speedFixer
  );
  sanitized.provider_used = `MCP (${agentName})`;

  const pct =
    sanitized.max_marks > 0 ? Math.round((sanitized.total_score / sanitized.max_marks) * 100) : 0;
  const studentLabel =
    input.studentName?.trim() ||
    workspaceState.studentSheets[0]?.name.replace(/\.[^/.]+$/, '') ||
    'MCP Sheet';
  const baseMode = inferBaseMode(mode);

  const record: StoredEvaluationRecord = {
    id: `mcp-run-${Date.now()}`,
    label: studentLabel.slice(0, 18),
    timestamp: formatShortTime(),
    createdAt: new Date().toISOString(),
    modeLabel: `${mode} · MCP (${agentName})`,
    baseMode,
    isBatch: false,
    sheetsCount: 1,
    questionsCount: sanitized.questions.length,
    omrCount: baseMode === 'omr' || baseMode === 'hybrid' ? 1 : 0,
    writtenCount: baseMode === 'written' || baseMode === 'hybrid' ? 1 : 0,
    avgPercentage: pct,
    totalScore: sanitized.total_score,
    maxMarks: sanitized.max_marks,
    source: 'mcp',
    agentName,
    documentNames: {
      questionPaper: workspaceState.questionPaper?.name,
      answerKey: workspaceState.answerKey?.name,
      answerSheet: workspaceState.studentSheets[0]?.name || studentLabel,
    },
    singleResult: sanitized,
  };

  upsertEvaluationRecord(record);

  broadcastStudioEvent('mcp_session_completed', {
    sessionId: `mcp-direct-${Date.now()}`,
    agentName,
    result: sanitized,
    record,
    toolEvent: {
      id: `evt-${Date.now()}`,
      timestamp: formatFullTime(),
      toolName: 'finalize_exam_evaluation',
      status: 'success',
      summary: `[${agentName}] Saved ${sanitized.questions.length} question(s) directly to Studio & History`,
    },
  });

  return { record, result: sanitized };
}
