
export enum GradingMode {
  // --- GEMINI 3 PRO ECOSYSTEM (High Precision) ---
  GEMINI_3_HANDWRITTEN = 'Gemini 3 Pro: Handwritten',
  GEMINI_3_OMR = 'Gemini 3 Pro: OMR',
  GEMINI_3_HYBRID = 'Gemini 3 Pro: Hybrid (OMR + HW)',
  GEMINI_3_FORENSIC = 'Gemini 3 Pro: Forensic Audit (VIP)',

  // --- SPEED FIXER ECOSYSTEM (Rapid Single-Pass + Auto-Repair) ---
  SPEED_FIXER = 'Speed Fixer: Rapid Auto-Repair',

  // --- SPECIALIZED MODES ---
  AI_KNOWLEDGE = 'AI Knowledge (No Key)',

  // --- FAST PROCESSOR ECOSYSTEM (Speed / 2.5) ---
  FAST_GENERAL = 'Fast Processor: General (2.5)',
  FAST_HANDWRITTEN = 'Fast Processor: Handwritten',
  FAST_OMR = 'Fast Processor: OMR',
  FAST_HYBRID = 'Fast Processor: Hybrid',
}

export interface Annotation {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  page_number?: number;
}

export interface QuestionResult {
  question_id: number | string;
  question_text: string;
  student_answer: string;
  score: number;
  full_marks: number;
  confidence: number;
  feedback: string;
  matched_passages: string[];
  fixer_note?: string;
  annotation?: Annotation;         // Student Sheet Annotation
  qp_annotation?: Annotation;      // Question Paper Annotation
  ref_annotation?: Annotation;     // Reference Key Annotation
}

export interface GradingResult {
  total_score: number;
  max_marks: number;
  pass_status: string;
  letter_grade: string;
  special_award: string | null;
  questions: QuestionResult[];
  grading_duration?: number;
  adjusted_total_score?: number | null;
  adjustment_reason?: string | null;
  teacher_overall_comments?: string | null;
  speed_fixer_summary?: string | null;
}

export interface LiveToolEvent {
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

export interface StudentData {
  id: string;
  rollNumber: string;
  name: string;
  studentClass: string;
  answerSheet: File;
}

export interface BatchResultItem {
  student: StudentData;
  result: GradingResult | null;
  error?: string;
  previewUrl: string;
  answerSheetMimeType: string;
}

export interface BoundingBox {
  id: string;
  question_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
