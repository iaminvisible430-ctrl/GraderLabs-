import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type, ThinkingLevel, FunctionCallingConfigMode } from '@google/genai';
import type { Part, Content, FunctionDeclaration, FunctionCall } from '@google/genai';
import fs from 'node:fs';
import {
  getConfiguredFallbackProviders,
  isGeminiFallbackEligibleError,
  runFallbackOcr,
  runFallbackGrade,
  runFallbackGradeStream,
} from './server/fallbackProviders.ts';
import {
  sanitizeQuestionResult,
  sanitizeGradingResult,
  computeDerivedGradeInfo,
  normalizeQuestionId,
  subscribeStudioEvents,
  getWorkspaceState,
  syncWorkspaceState,
  getEvaluationHistory,
  upsertEvaluationRecord,
  deleteEvaluationRecord,
  type StoredEvaluationRecord,
} from './server/studioStore.ts';
import { mountMcpRoutes } from './server/mcpServer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore .env load error
}

interface BoundingBoxInput {
  id: string;
  question_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GradeRequestBody {
  answerSheetPart?: Part;
  referenceMaterialPart?: Part | null;
  questionPaperPart?: Part;
  questionPaperPages?: Part[];
  referenceMaterialPages?: Part[];
  answerSheetPages?: Part[];
  mode?: string;
  baseHint?: string;
  boundingBoxes?: BoundingBoxInput[];
  studentOcrData?: string;
  qpOcrData?: string;
  refOcrData?: string;
  rawStudentOCR?: string;
}

interface OcrRequestBody {
  filePart?: Part;
  filePages?: Part[];
}

let aiInstance: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'GEMINI_API_KEY is not configured on the server. Please check your Settings > Secrets panel.'
    ) as Error & { status?: number };
    err.status = 500;
    throw err;
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiInstance;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  const hasFallbacks = getConfiguredFallbackProviders().length > 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const errObj = error as { status?: number; message?: string };
      const status = errObj?.status;
      const msg = errObj?.message || '';
      const isDailyQuota =
        msg.includes('PerDay') ||
        msg.includes('RequestsPerDay') ||
        /retry in\s+\d+(?:\.\d+)?[hm]/i.test(msg);
      const isRateOrQuota =
        status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
      if (hasFallbacks && isRateOrQuota) {
        throw error;
      }
      const isTransient =
        !isDailyQuota &&
        (status === 429 ||
          status === 503 ||
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('RESOURCE_EXHAUSTED'));
      if (!isTransient || attempt === maxRetries) {
        throw error;
      }
      const retryMatch = msg.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
      const parsedDelayMs = retryMatch ? Math.ceil(Number(retryMatch[1]) * 1000) + 250 : 0;
      const delayMs =
        parsedDelayMs > 0 && parsedDelayMs <= 15000
          ? parsedDelayMs
          : 1000 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function formatGeminiError(error: unknown, fallbackMessage: string): { status: number; message: string } {
  const errObj = error as { status?: number; message?: string };
  const rawMessage = errObj?.message || '';
  const status = typeof errObj?.status === 'number' ? errObj.status : 500;

  if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('PERMISSION_DENIED') || status === 403) {
    return {
      status: status === 403 ? 403 : 400,
      message: 'Gemini API authentication failed. Please verify the API key in Settings > Secrets.',
    };
  }
  if (rawMessage.includes('RESOURCE_EXHAUSTED') || status === 429) {
    const retryMatch = rawMessage.match(/Please retry in\s+[\d.]+s/i);
    const quotaIdMatch = rawMessage.match(/"quotaId"\s*:\s*"([^"]+)"/i);
    const detail = [retryMatch?.[0], quotaIdMatch?.[1]].filter(Boolean).join(' · ');
    const fallbackHint =
      ' To process immediately without waiting for quota reset, add an API key for Mistral, HuggingFace, or Cloudflare in Settings > Secrets.';
    return {
      status: 429,
      message: detail
        ? `Rate limit or quota exceeded (${detail}).${fallbackHint}`
        : `Gemini free-tier daily request quota exceeded.${fallbackHint}`,
    };
  }
  if (rawMessage.includes('500')) {
    return {
      status: 500,
      message: 'Server error. Documents may be too large or complex.',
    };
  }
  if (rawMessage) {
    return { status, message: rawMessage };
  }
  return { status, message: fallbackMessage };
}

const annotationSchema = {
  type: Type.OBJECT,
  description:
    'Normalized 0-1000 bounding box for the target document page: (0,0) is top-left, (1000,1000) is bottom-right. All coordinates must be integers in 0..1000 with ymin < ymax and xmin < xmax, and page_number must be 1-indexed for that document.',
  properties: {
    ymin: { type: Type.NUMBER, description: 'Top edge in 0-1000 normalized page coordinates (0 = top, 1000 = bottom).' },
    xmin: { type: Type.NUMBER, description: 'Left edge in 0-1000 normalized page coordinates (0 = left, 1000 = right).' },
    ymax: { type: Type.NUMBER, description: 'Bottom edge in 0-1000 normalized page coordinates (must be > ymin).' },
    xmax: { type: Type.NUMBER, description: 'Right edge in 0-1000 normalized page coordinates (must be > xmin).' },
    page_number: { type: Type.INTEGER, description: '1-indexed page number within that specific document (starts at 1).' },
  },
  required: ['ymin', 'xmin', 'ymax', 'xmax', 'page_number'],
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    total_score: { type: Type.NUMBER },
    max_marks: { type: Type.NUMBER },
    pass_status: { type: Type.STRING },
    letter_grade: { type: Type.STRING },
    special_award: { type: Type.STRING },
    teacher_overall_comments: { type: Type.STRING },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question_id: { type: Type.STRING },
          question_text: { type: Type.STRING },
          student_answer: { type: Type.STRING },
          score: { type: Type.NUMBER },
          full_marks: { type: Type.NUMBER },
          confidence: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          annotation: {
            ...annotationSchema,
            description:
              'Tight bounding box enclosing the student answer (handwritten ink, diagrams, or filled OMR bubbles) on the STUDENT SHEET, with page_number referencing the Student Sheet.',
          },
          qp_annotation: {
            ...annotationSchema,
            description:
              'Tight bounding box enclosing this question text on the QUESTION PAPER, with page_number referencing the Question Paper.',
          },
          ref_annotation: {
            ...annotationSchema,
            description:
              'Tight bounding box enclosing the model answer/rubric for this question on the ANSWER KEY, with page_number referencing the Answer Key.',
          },
        },
        required: [
          'question_id',
          'question_text',
          'student_answer',
          'score',
          'full_marks',
          'confidence',
          'feedback',
          'annotation',
        ],
      },
    },
  },
  required: ['total_score', 'max_marks', 'questions'],
};

const V11_GEMINI_3_CORE = `
    **PROTOCOL V12.0: GEMINI 3 PRO INTELLIGENCE LAYER**
    1.  **ZERO-OMISSION INDEXING:** Map every student answer to its corresponding QID from the QP. Unanswered questions must be marked as 0.
    2.  **CROSSED-OUT TEXT:** Ignore text with strikethroughs. If a student writes an answer and crosses it out, treat it as null.
    3.  **PARTIAL CREDIT ENGINE:** Award proportional marks for steps/logic. Break down complex answers into key value points.
    4.  **MULTILINGUAL SYSTEMS:** Detect script (Latin, Devanagari, Cyrillic, etc.) and apply local grading norms and language-specific nuances.
    5.  **PERFECT ANNOTATION PLACEMENT:** Annotations must strictly hug the student's ink/answer area. Do not include surrounding whitespace.
    6.  **HIGH OCR:** Use the provided Forensic OCR transcript as ground truth for hard-to-read handwriting.
    7.  **FORMAT AGNOSTIC:** Handle text, tables, and structured data found in documents or spreadsheets (if provided as images/pdf) with equal precision.
`;

const V6_COORDINATE_SYSTEM = `
    **PROTOCOL V12.1: PRECISION 0-1000 SPATIAL GROUNDING**
    *   Every page uses an independent normalized [0..1000] x [0..1000] coordinate grid: (0,0) is Top-Left, (1000,1000) is Bottom-Right. Never return raw pixel values or 0.0-1.0 decimals.
    *   \`annotation\`: Tightly hug ONLY the student's actual answer region on the STUDENT SHEET (all lines of handwriting, math steps, sketches, or filled OMR row/bubbles for that question), excluding blank margins and adjacent questions. Set \`page_number\` to the 1-indexed page of the Student Sheet.
    *   \`qp_annotation\`: Tightly hug ONLY that question's text/prompt on the QUESTION PAPER, with \`page_number\` referencing the Question Paper.
    *   \`ref_annotation\`: When an Answer Key is provided, tightly hug ONLY that question's solution/rubric on the ANSWER KEY, with \`page_number\` referencing the Answer Key.
    *   Verify \`ymin < ymax\` and \`xmin < xmax\` for every box, and make multi-line answers span from the first line's ascenders to the last line's descenders without cutting off words.
`;

function isSpeedFixerMode(mode: string): boolean {
  return mode.toLowerCase().includes('speed fixer');
}

const SPEED_FIXER_PROTOCOL = `
    **SPEED FIXER MODE ACTIVE (ULTRA-FAST SINGLE-PASS + AUTO-REPAIR):**
    1. Resolve messy/out-of-order student numbering automatically to match the Question Paper QIDs (e.g., repair "Q.1(a)" or unnumbered answers by context).
    2. Automatically disregard crossed-out scribbles and repair ambiguous faint OCR tokens using Question Paper & Answer Key context.
    3. Keep bounding boxes tight around the final uncrossed answer region and ensure score is strictly 0 <= score <= full_marks.
    4. Document any auto-fix you performed concisely in \`fixer_note\` (or via \`apply_speed_fixer_repair\` during Live Grading).
`;

function buildPrompt(
  mode: string,
  studentOcrData?: string,
  qpOcrData?: string,
  refOcrData?: string,
  boundingBoxes?: BoundingBoxInput[],
  rawStudentOCR?: string,
  baseHint?: string
): string {
  const supplementaryOcr =
    studentOcrData || qpOcrData || refOcrData
      ? '\n**SUPPLEMENTARY TEXT DATA (PDF LAYER):** Use if visual text is unclear.'
      : '';
  const handwrittenOcr = rawStudentOCR
    ? `\n\n--- FORENSIC OCR PRE-READ (GEMINI 3) ---\nUse this transcript to aid your visual search and handwriting deciphering:\n${rawStudentOCR}`
    : '';

  let specificInstruction = '';

  if (isSpeedFixerMode(mode)) {
    const subHint = baseHint ? ` Focus detection style: ${baseHint.toUpperCase()} (auto-detect OMR bubbles & handwritten ink cleanly).` : '';
    specificInstruction = `MODE: SPEED FIXER.${subHint}\n${SPEED_FIXER_PROTOCOL}`;
  } else if (mode.includes('Handwritten')) {
    specificInstruction =
      'MODE: HANDWRITTEN ONLY. Focus purely on handwritten ink. Ignore printed text or OMR bubbles. Use high-precision graphology analysis.';
  } else if (mode.includes('OMR')) {
    specificInstruction =
      'MODE: OMR ONLY. Focus STRICTLY on the filled bubbles. Do not read handwritten text in margins. Use the provided bounding boxes if available.';
  } else if (mode.includes('Hybrid')) {
    specificInstruction =
      'MODE: HYBRID. Scan for BOTH filled bubbles (MCQ) and handwritten answers (Theory). Fuse the data into a single report.';
  } else if (mode === 'AI Knowledge (No Key)') {
    specificInstruction =
      "MODE: AI KNOWLEDGE. Grade based on your internal knowledge base. Ignore the 'Reference Key' section.";
  } else if (mode.includes('Forensic Audit')) {
    specificInstruction =
      'MODE: FORENSIC AUDIT (VIP). 1) Detect cheating patterns (e.g. different handwriting styles). 2) Assess student confidence based on ink pressure/hesitation. 3) Report potential academic dishonesty.';
  }

  let mainPrompt = `
        You are GraderLabs Neural Evaluator (Powered by ${mode.includes('Gemini 3') ? 'Gemini 3 Pro' : 'Gemini 2.5'}).
        ${V11_GEMINI_3_CORE}
        ${V6_COORDINATE_SYSTEM}
        ${specificInstruction}
        ${supplementaryOcr}
        ${handwrittenOcr}
    `;

  if (boundingBoxes && boundingBoxes.length > 0) {
    const formattedBoxes = boundingBoxes.map(({ question_id, x, y, width, height }) => ({
      question_id,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    }));
    mainPrompt += `\n**OMR TEMPLATE:**\n\`\`\`json\n${JSON.stringify(formattedBoxes)}\n\`\`\``;
  }

  return mainPrompt;
}

const registerQuestionEvaluationTool: FunctionDeclaration = {
  name: 'register_question_evaluation',
  description:
    'Immediately registers a single evaluated question, its marks, OCR answer, feedback, and 0-1000 bounding-box annotations into the live Student Report Studio. Call this once per question as soon as you evaluate it.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      question_id: { type: Type.STRING, description: 'Question identifier matching the Question Paper (e.g., "1", "2a", "3").' },
      question_text: { type: Type.STRING, description: 'Concise text/prompt of the question.' },
      student_answer: { type: Type.STRING, description: 'Exact transcribed student answer or selected OMR option.' },
      score: { type: Type.NUMBER, description: 'Awarded marks for this question.' },
      full_marks: { type: Type.NUMBER, description: 'Maximum possible marks for this question.' },
      confidence: { type: Type.NUMBER, description: 'Confidence score between 0.0 and 1.0.' },
      feedback: { type: Type.STRING, description: 'Concise, specific rubric feedback explaining the score.' },
      fixer_note: { type: Type.STRING, description: 'Optional note if Speed Fixer auto-repaired numbering, crossed-out text, or ambiguous layout.' },
      annotation: {
        ...annotationSchema,
        description: 'Tight 0-1000 bounding box enclosing the student answer on the STUDENT SHEET.',
      },
      qp_annotation: {
        ...annotationSchema,
        description: 'Optional tight 0-1000 bounding box enclosing the question on the QUESTION PAPER.',
      },
      ref_annotation: {
        ...annotationSchema,
        description: 'Optional tight 0-1000 bounding box enclosing the model solution on the ANSWER KEY.',
      },
    },
    required: [
      'question_id',
      'question_text',
      'student_answer',
      'score',
      'full_marks',
      'confidence',
      'feedback',
      'annotation',
    ],
  },
};

const applySpeedFixerRepairTool: FunctionDeclaration = {
  name: 'apply_speed_fixer_repair',
  description:
    'Records an automatic Speed Fixer repair (such as QID normalization, crossed-out text cleanup, faint ink recovery, or coordinate re-anchoring) to display in the live studio.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      question_id: { type: Type.STRING, description: 'Affected question ID.' },
      issue_type: {
        type: Type.STRING,
        description: 'Repair category: qid_normalization, strikethrough_cleanup, coordinate_reanchor, partial_credit_split, or ocr_disambiguation.',
      },
      description: { type: Type.STRING, description: 'Short explanation of what Speed Fixer corrected.' },
    },
    required: ['question_id', 'issue_type', 'description'],
  },
};

const finalizeExamEvaluationTool: FunctionDeclaration = {
  name: 'finalize_exam_evaluation',
  description:
    'Completes the live grading session after ALL questions have been registered via register_question_evaluation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      total_score: { type: Type.NUMBER, description: 'Sum of awarded scores across all questions.' },
      max_marks: { type: Type.NUMBER, description: 'Sum of full_marks across all questions.' },
      pass_status: { type: Type.STRING, description: 'Pass or Fail.' },
      letter_grade: { type: Type.STRING, description: 'Letter grade (A+, A, B, C, D, E, or F).' },
      special_award: { type: Type.STRING, description: 'Optional award like Distinction, or empty string.' },
      teacher_overall_comments: { type: Type.STRING, description: 'Overall summary of student performance and recommendations.' },
      speed_fixer_summary: { type: Type.STRING, description: 'Optional summary of auto-repairs applied during Speed Fixer mode.' },
    },
    required: ['total_score', 'max_marks', 'pass_status', 'letter_grade', 'teacher_overall_comments'],
  },
};

const OCR_PROMPT = `
    **MODE: V12.0 FORENSIC TRANSCRIPTION (GEMINI 3 PRO)**
    You are a forensic document examiner utilizing the Gemini 3 Vision Engine.
    
    **MANDATORY PROTOCOLS:**
    1.  **READ EVERY PIXEL:** Do not skim. Look at every ink stroke, including faint or messy handwriting.
    2.  **NUMBERING IS SACRED:** Explicitly identify and transcribe every question number (1, 2, a, b, i, ii, Q1) found in margins.
    3.  **CROSS-OUT DETECTION:** If a student has crossed out text (strikethrough, 'X' mark), transcribe it but enclose it in ~~double tildes~~ and label as [crossed-out].
    4.  **SYMBOL RECOGNITION:** Transcribe grading symbols (ticks, crosses).
    5.  **PRESERVE LAYOUT:** Maintain line breaks and table structures.
    6.  **FORMAT AGNOSTIC:** If the file is a screenshot of a spreadsheet or document, transcribe the structured data accurately.
    
    RETURN ONLY THE RAW FORENSIC TRANSCRIPTION.
`;

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // --- Mount MCP Server Routes (/mcp Streamable HTTP + /sse & /messages Legacy SSE + OAuth 2.1 DCR) ---
  mountMcpRoutes(app);

  // --- Shared Studio Workspace, Live Events & Persistent History API ---
  app.get('/api/studio/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': studio-events-open\n\n');

    const unsubscribe = subscribeStudioEvents(res);
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  app.get('/api/studio/workspace', (_req: Request, res: Response) => {
    const ws = getWorkspaceState();
    res.json({
      ...ws,
      questionPaper: ws.questionPaper
        ? { ...ws.questionPaper, pagesCount: ws.questionPaper.pages.length, pages: undefined }
        : null,
      answerKey: ws.answerKey
        ? { ...ws.answerKey, pagesCount: ws.answerKey.pages.length, pages: undefined }
        : null,
      studentSheets: ws.studentSheets.map((s) => ({
        ...s,
        pagesCount: s.pages.length,
        pages: undefined,
      })),
    });
  });

  app.post('/api/studio/sync-workspace', (req: Request, res: Response) => {
    const updated = syncWorkspaceState(req.body || {});
    res.json({
      ok: true,
      updatedAt: updated.updatedAt,
      questionPaper: updated.questionPaper?.name || null,
      answerKey: updated.answerKey?.name || null,
      studentSheetsCount: updated.studentSheets.length,
    });
  });

  app.get('/api/studio/history', (_req: Request, res: Response) => {
    res.json({ history: getEvaluationHistory() });
  });

  app.post('/api/studio/history', (req: Request, res: Response) => {
    const record = req.body as StoredEvaluationRecord | undefined;
    if (!record || !record.id) {
      res.status(400).json({ error: 'Invalid evaluation history record.' });
      return;
    }
    const saved = upsertEvaluationRecord({
      ...record,
      createdAt: record.createdAt || new Date().toISOString(),
      source: record.source || 'app',
    });
    res.json({ ok: true, record: saved });
  });

  app.delete('/api/studio/history/:id', (req: Request, res: Response) => {
    const deleted = deleteEvaluationRecord(String(req.params.id));
    res.json({ ok: deleted });
  });

  app.post('/api/gemini/ocr', async (req: Request, res: Response) => {
    try {
      const { filePart, filePages } = (req.body || {}) as OcrRequestBody;
      if (!filePart) {
        res.status(400).json({ error: 'Missing filePart in request body.' });
        return;
      }

      try {
        const ai = getAiClient();
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts: [{ text: OCR_PROMPT }, filePart] },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            },
          })
        );

        res.json({ text: (response.text ?? '').trim(), provider: 'gemini' });
        return;
      } catch (geminiError: unknown) {
        if (isGeminiFallbackEligibleError(geminiError) && getConfiguredFallbackProviders().length > 0) {
          console.warn('Gemini OCR unavailable; invoking fallback LLM provider:', geminiError);
          const fallback = await runFallbackOcr({
            filePart,
            filePages,
            ocrPrompt: OCR_PROMPT,
          });
          res.json({ text: fallback.text, provider: fallback.provider, model: fallback.model });
          return;
        }
        throw geminiError;
      }
    } catch (error: unknown) {
      console.error('Server OCR error:', error);
      const formatted = formatGeminiError(error, 'OCR processing failed.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/gemini/grade', async (req: Request, res: Response) => {
    try {
      const {
        answerSheetPart,
        referenceMaterialPart,
        questionPaperPart,
        questionPaperPages,
        referenceMaterialPages,
        answerSheetPages,
        mode = '',
        baseHint,
        boundingBoxes,
        studentOcrData,
        qpOcrData,
        refOcrData,
        rawStudentOCR,
      } = (req.body || {}) as GradeRequestBody;

      if (!questionPaperPart || !answerSheetPart) {
        res.status(400).json({ error: 'Missing required questionPaperPart or answerSheetPart.' });
        return;
      }

      const speedFixer = isSpeedFixerMode(mode);
      const mainPrompt = buildPrompt(
        mode,
        studentOcrData,
        qpOcrData,
        refOcrData,
        boundingBoxes,
        rawStudentOCR,
        baseHint
      );

      let rawParsed: Record<string, unknown> | null = null;
      let usedFallbackProvider: string | null = null;

      try {
        const ai = getAiClient();
        const parts: Part[] = [
          { text: mainPrompt },
          { text: '\n\n--- QUESTION PAPER ---' },
          questionPaperPart,
        ];
        if (referenceMaterialPart) {
          parts.push({ text: '\n\n--- ANSWER KEY ---' });
          parts.push(referenceMaterialPart);
        }
        parts.push({ text: '\n\n--- STUDENT SHEET ---' });
        parts.push(answerSheetPart);

        const isHighPrecision =
          !speedFixer && (mode.includes('Gemini 3') || mode === 'AI Knowledge (No Key)');

        const response = await withRetry(() =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts },
            config: {
              responseMimeType: 'application/json',
              responseSchema,
              thinkingConfig: {
                thinkingLevel: isHighPrecision ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
              },
            },
          })
        );

        const jsonText = (response.text ?? '')
          .trim()
          .replace(/^```json\n?/, '')
          .replace(/\n?```$/, '');

        if (!jsonText) {
          throw Object.assign(new Error('AI returned an empty grading response.'), { status: 502 });
        }

        try {
          rawParsed = JSON.parse(jsonText);
        } catch {
          res.status(502).json({ error: 'AI response could not be parsed cleanly. Please retry grading.' });
          return;
        }
      } catch (geminiError: unknown) {
        if (isGeminiFallbackEligibleError(geminiError) && getConfiguredFallbackProviders().length > 0) {
          console.warn('Gemini grading unavailable; invoking fallback LLM provider:', geminiError);
          const fallback = await runFallbackGrade({
            prompt: mainPrompt,
            questionPaperPart,
            referenceMaterialPart,
            answerSheetPart,
            questionPaperPages,
            referenceMaterialPages,
            answerSheetPages,
          });
          rawParsed = fallback.parsed;
          usedFallbackProvider = `${fallback.provider} (${fallback.model})`;
        } else {
          throw geminiError;
        }
      }

      if (!rawParsed) {
        res.status(502).json({ error: 'AI returned an empty grading response.' });
        return;
      }

      const parsed = sanitizeGradingResult(rawParsed, speedFixer);
      if (usedFallbackProvider && !parsed.speed_fixer_summary) {
        res.json({ ...parsed, provider_used: usedFallbackProvider });
        return;
      }
      res.json(parsed);
    } catch (error: unknown) {
      console.error('Server Grading error:', error);
      const formatted = formatGeminiError(error, 'AI processing failed. Ensure documents are clear.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/gemini/grade-live', async (req: Request, res: Response) => {
    let clientClosed = false;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    const liveAbortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
        liveAbortController.abort();
      }
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    });

    const sendSse = (payload: Record<string, unknown>) => {
      if (clientClosed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const {
        answerSheetPart,
        referenceMaterialPart,
        questionPaperPart,
        questionPaperPages,
        referenceMaterialPages,
        answerSheetPages,
        mode = '',
        baseHint,
        boundingBoxes,
        studentOcrData,
        qpOcrData,
        refOcrData,
        rawStudentOCR,
      } = (req.body || {}) as GradeRequestBody;

      if (!questionPaperPart || !answerSheetPart) {
        res.status(400).json({ error: 'Missing required questionPaperPart or answerSheetPart.' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      req.socket?.setNoDelay(true);
      res.flushHeaders?.();
      res.write(': stream-open\n\n');
      keepAliveTimer = setInterval(() => {
        if (!clientClosed && !res.writableEnded) {
          res.write(': keepalive\n\n');
        }
      }, 10000);

      const speedFixer = isSpeedFixerMode(mode);

      const basePrompt = buildPrompt(
        mode,
        studentOcrData,
        qpOcrData,
        refOcrData,
        boundingBoxes,
        rawStudentOCR,
        baseHint
      );

      const liveToolInstructions = `
    **LIVE STREAMING THINKING + TOOL-CALL EVALUATION PROTOCOL:**
    You are connected to the live GraderLabs Student Report Studio.
    1. Evaluate every question in paper order. If an exam has multiple sections that restart numbering (e.g. Section A 1..30 and Section B Q1..Q5), assign unique \`question_id\` values such as \`1\`..\`30\` for Section A and \`B1\`..\`B5\` for Section B so no two questions ever share the same \`question_id\`.
    2. Invoke \`register_question_evaluation\` for each question with its score, \`full_marks\`, \`student_answer\`, crisp 1-2 sentence \`feedback\`, and tight 0-1000 bounding boxes (\`annotation\`, plus \`qp_annotation\` and \`ref_annotation\` when visible).
    ${
      speedFixer
        ? '3. Whenever you normalize a messy QID, ignore crossed-out writing, recover faint ink, or fix box alignment, call `apply_speed_fixer_repair` (or include `fixer_note`) so the user sees the auto-repair live.\n    4.'
        : '3.'
    } Do NOT output raw JSON text in prose. Once ALL questions across all sections are registered, call \`finalize_exam_evaluation\` immediately (in the same turn when possible) to minimize latency.
      `;

      const initialParts: Part[] = [
        { text: `${basePrompt}\n${liveToolInstructions}` },
        { text: '\n\n--- QUESTION PAPER ---' },
        questionPaperPart,
      ];
      if (referenceMaterialPart) {
        initialParts.push({ text: '\n\n--- ANSWER KEY ---' });
        initialParts.push(referenceMaterialPart);
      }
      initialParts.push({ text: '\n\n--- STUDENT SHEET ---' });
      initialParts.push(answerSheetPart);

      const declarations: FunctionDeclaration[] = speedFixer
        ? [
            registerQuestionEvaluationTool,
            applySpeedFixerRepairTool,
            finalizeExamEvaluationTool,
          ]
        : [registerQuestionEvaluationTool, finalizeExamEvaluationTool];

      const conversation: Content[] = [{ role: 'user', parts: initialParts }];
      const registeredQuestions: ReturnType<typeof sanitizeQuestionResult>[] = [];
      const seenQuestionKeys = new Map<string, number>();
      const fixerDescriptions: string[] = [];
      let finalizeCalled = false;
      let finalMeta: Record<string, unknown> = {};
      let forceToolRetry = false;

      sendSse({
        type: 'status',
        message: speedFixer
          ? 'Speed Fixer Live Engine streaming reasoning & rapid tool calls...'
          : 'Live Vision Engine streaming reasoning & evaluation tool calls...',
      });

      const registerEvaluatedQuestion = (args: Record<string, unknown>) => {
        const idx = registeredQuestions.length;
        let sanitizedQ = sanitizeQuestionResult(args, idx, speedFixer);
        const qKey = String(sanitizedQ.question_id).toLowerCase();

        if (seenQuestionKeys.has(qKey)) {
          const existingIdx = seenQuestionKeys.get(qKey)!;
          const existing = registeredQuestions[existingIdx];
          const sameQuestion =
            existing &&
            existing.full_marks === sanitizedQ.full_marks &&
            (existing.question_text.slice(0, 24).toLowerCase() ===
              sanitizedQ.question_text.slice(0, 24).toLowerCase() ||
              existing.annotation?.page_number === sanitizedQ.annotation?.page_number);

          if (sameQuestion) {
            registeredQuestions[existingIdx] = sanitizedQ;
          } else {
            let uniqueId = `B${sanitizedQ.question_id}`;
            let suffixNum = 2;
            if (seenQuestionKeys.has(uniqueId.toLowerCase())) {
              while (seenQuestionKeys.has(`${sanitizedQ.question_id}-${suffixNum}`.toLowerCase())) {
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
            seenQuestionKeys.set(uniqueId.toLowerCase(), registeredQuestions.length);
            registeredQuestions.push(sanitizedQ);
          }
        } else {
          seenQuestionKeys.set(qKey, registeredQuestions.length);
          registeredQuestions.push(sanitizedQ);
        }

        const runningScore =
          Math.round(registeredQuestions.reduce((s, q) => s + q.score, 0) * 100) / 100;
        const runningMax =
          Math.round(registeredQuestions.reduce((s, q) => s + q.full_marks, 0) * 100) / 100;

        sendSse({
          type: 'tool_call',
          toolName: 'register_question_evaluation',
          questionId: sanitizedQ.question_id,
          score: sanitizedQ.score,
          fullMarks: sanitizedQ.full_marks,
          hasAnnotation: Boolean(sanitizedQ.annotation),
          status: sanitizedQ.fixer_note ? 'fixed' : 'success',
          summary: `Q${sanitizedQ.question_id} registered · ${sanitizedQ.score}/${sanitizedQ.full_marks} marks${
            sanitizedQ.fixer_note ? ` · ${sanitizedQ.fixer_note}` : ''
          }`,
        });

        sendSse({
          type: 'question_graded',
          question: sanitizedQ,
          total_score: runningScore,
          max_marks: runningMax,
        });
      };

      const MAX_TURNS = 10;
      try {
        const ai = getAiClient();
        for (let turn = 0; turn < MAX_TURNS && !finalizeCalled && !clientClosed; turn++) {
          const useForcedTools = forceToolRetry;
          forceToolRetry = false;

          const stream = await withRetry(() =>
            ai.models.generateContentStream({
              model: 'gemini-4-hydrogen',
              contents: conversation,
              config: {
                tools: [{ functionDeclarations: declarations }],
                toolConfig: useForcedTools
                  ? {
                      functionCallingConfig: {
                        mode: FunctionCallingConfigMode.ANY,
                        allowedFunctionNames: declarations.map((d) => d.name!),
                      },
                    }
                  : {
                      functionCallingConfig: {
                        mode: FunctionCallingConfigMode.AUTO,
                      },
                    },
                thinkingConfig: {
                  thinkingLevel:
                    mode.includes('Forensic Audit') && turn === 0
                      ? ThinkingLevel.MEDIUM
                      : ThinkingLevel.LOW,
                  includeThoughts: true,
                },
              },
            })
          );

          const turnParts: Part[] = [];
          const turnFunctionCalls: FunctionCall[] = [];
          let turnText = '';

          for await (const chunk of stream) {
            if (clientClosed) break;

            const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of chunkParts) {
              turnParts.push(part);
              if (part.thought && part.text) {
                sendSse({
                  type: 'thinking',
                  text: part.text,
                  turn,
                });
              } else if (part.text) {
                turnText += part.text;
              }
              if (part.functionCall) {
                const fc = part.functionCall;
                turnFunctionCalls.push(fc);

                if (fc.name === 'register_question_evaluation') {
                  registerEvaluatedQuestion((fc.args || {}) as Record<string, unknown>);
                } else if (fc.name === 'apply_speed_fixer_repair') {
                  const args = (fc.args || {}) as Record<string, unknown>;
                  const qid = normalizeQuestionId(args.question_id, registeredQuestions.length);
                  const issueType = String(args.issue_type || 'auto_repair');
                  const desc = String(args.description || 'Auto-repaired formatting & marks');
                  fixerDescriptions.push(`Q${qid}: ${desc}`);

                  sendSse({
                    type: 'tool_call',
                    toolName: 'apply_speed_fixer_repair',
                    questionId: qid,
                    status: 'fixed',
                    summary: `Speed Fixer (${issueType}) on Q${qid}: ${desc}`,
                  });
                } else if (fc.name === 'finalize_exam_evaluation') {
                  finalizeCalled = true;
                  finalMeta = (fc.args || {}) as Record<string, unknown>;
                  sendSse({
                    type: 'tool_call',
                    toolName: 'finalize_exam_evaluation',
                    status: 'success',
                    summary: `Finalizing audit across ${registeredQuestions.length} question(s)...`,
                  });
                }
              }
            }
            if (finalizeCalled) {
              break;
            }
          }

          if (finalizeCalled) {
            await stream.return?.(undefined).catch(() => {});
            break;
          }

          if (clientClosed) {
            await stream.return?.(undefined).catch(() => {});
            break;
          }

          if (turnFunctionCalls.length > 0) {
            conversation.push({ role: 'model', parts: turnParts });
            const runningScore =
              Math.round(registeredQuestions.reduce((s, q) => s + q.score, 0) * 100) / 100;
            const runningMax =
              Math.round(registeredQuestions.reduce((s, q) => s + q.full_marks, 0) * 100) / 100;

            const fnResponseParts: Part[] = turnFunctionCalls.map((fc) => ({
              functionResponse: {
                id: fc.id,
                name: fc.name,
                response: {
                  ok: true,
                  registered_count: registeredQuestions.length,
                  running_total_score: runningScore,
                  running_max_marks: runningMax,
                  instruction:
                    'Continue with any remaining ungraded questions using register_question_evaluation, or call finalize_exam_evaluation if all questions are complete.',
                },
              },
            }));
            conversation.push({ role: 'user', parts: fnResponseParts });
          } else {
            // No function calls in this turn — check if text JSON fallback was emitted
            const trimmed = turnText
              .trim()
              .replace(/^```json\n?/, '')
              .replace(/\n?```$/, '');
            if (trimmed.startsWith('{')) {
              try {
                const fallbackParsed = JSON.parse(trimmed) as Record<string, unknown>;
                const sanitized = sanitizeGradingResult(fallbackParsed, speedFixer);
                for (const q of sanitized.questions) {
                  const qKey = String(q.question_id).toLowerCase();
                  if (!seenQuestionKeys.has(qKey)) {
                    seenQuestionKeys.set(qKey, registeredQuestions.length);
                    registeredQuestions.push(q);
                    sendSse({
                      type: 'question_graded',
                      question: q,
                      total_score: sanitized.total_score,
                      max_marks: sanitized.max_marks,
                    });
                  }
                }
                finalMeta = fallbackParsed;
              } catch {
                // Ignore non-JSON prose
              }
            }

            if (registeredQuestions.length === 0 && turn === 0) {
              if (turnParts.length > 0) {
                conversation.push({ role: 'model', parts: turnParts });
              }
              conversation.push({
                role: 'user',
                parts: [
                  {
                    text: 'Please invoke register_question_evaluation for each question now, and finish with finalize_exam_evaluation.',
                  },
                ],
              });
              forceToolRetry = true;
              continue;
            }
            break;
          }
        }
      } catch (geminiError: unknown) {
        if (
          !clientClosed &&
          registeredQuestions.length === 0 &&
          isGeminiFallbackEligibleError(geminiError) &&
          getConfiguredFallbackProviders().length > 0
        ) {
          console.warn('Gemini Live stream unavailable; switching to fallback LLM stream:', geminiError);
          sendSse({
            type: 'status',
            message: 'Gemini unavailable or quota reached — streaming fallback LLM pipeline...',
          });
          sendSse({
            type: 'tool_call',
            toolName: 'system',
            status: 'fixed',
            summary: `Fallback routing active (${getConfiguredFallbackProviders().join(' → ')})`,
          });

          const fallbackRes = await runFallbackGradeStream(
            {
              prompt: basePrompt,
              questionPaperPart,
              referenceMaterialPart,
              answerSheetPart,
              questionPaperPages,
              referenceMaterialPages,
              answerSheetPages,
              signal: liveAbortController.signal,
            },
            {
              onProviderStart: (provider, model) => {
                sendSse({
                  type: 'status',
                  message: `Fallback engine (${provider} · ${model}) streaming evaluation...`,
                });
              },
              onThinking: (text) => {
                sendSse({ type: 'thinking', text, turn: 0 });
              },
              onQuestionObject: (rawQ) => {
                registerEvaluatedQuestion(rawQ);
              },
            }
          );

          const rawQuestions = Array.isArray(fallbackRes.parsed.questions)
            ? fallbackRes.parsed.questions
            : [];
          if (registeredQuestions.length === 0 && rawQuestions.length > 0) {
            for (const rq of rawQuestions) {
              if (rq && typeof rq === 'object') {
                registerEvaluatedQuestion(rq as Record<string, unknown>);
              }
            }
          }
          finalMeta = fallbackRes.parsed;
          finalizeCalled = true;
          sendSse({
            type: 'tool_call',
            toolName: 'finalize_exam_evaluation',
            status: 'success',
            summary: `Finalizing ${fallbackRes.provider} audit across ${registeredQuestions.length} question(s)...`,
          });
        } else {
          throw geminiError;
        }
      }

      if (clientClosed) return;

      if (registeredQuestions.length === 0) {
        sendSse({
          type: 'error',
          error: 'AI did not return any graded questions. Please check document legibility and try again.',
        });
        res.end();
        return;
      }

      const computedTotal =
        Math.round(registeredQuestions.reduce((s, q) => s + q.score, 0) * 100) / 100;
      const computedMax =
        Math.round(registeredQuestions.reduce((s, q) => s + q.full_marks, 0) * 100) / 100;

      const rawFinalTotal = Number(finalMeta.total_score);
      const rawFinalMax = Number(finalMeta.max_marks);
      const finalTotal =
        computedMax > 0 || !Number.isFinite(rawFinalTotal) ? computedTotal : rawFinalTotal;
      const finalMax =
        computedMax > 0 || !Number.isFinite(rawFinalMax) ? computedMax : rawFinalMax;
      const derived = computeDerivedGradeInfo(finalTotal, finalMax);

      const combinedFixerSummary =
        typeof finalMeta.speed_fixer_summary === 'string' && finalMeta.speed_fixer_summary.trim()
          ? finalMeta.speed_fixer_summary.trim()
          : fixerDescriptions.length > 0
          ? fixerDescriptions.join(' · ')
          : speedFixer
          ? `Speed Fixer audited ${registeredQuestions.length} question(s) and verified scores & annotation coordinates.`
          : null;

      const completedResult = {
        total_score: finalTotal,
        max_marks: finalMax,
        pass_status:
          typeof finalMeta.pass_status === 'string' && finalMeta.pass_status.trim() && !speedFixer
            ? finalMeta.pass_status.trim()
            : derived.pass_status,
        letter_grade:
          typeof finalMeta.letter_grade === 'string' && finalMeta.letter_grade.trim() && !speedFixer
            ? finalMeta.letter_grade.trim()
            : derived.letter_grade,
        special_award:
          typeof finalMeta.special_award === 'string' && finalMeta.special_award.trim()
            ? finalMeta.special_award.trim()
            : derived.special_award,
        teacher_overall_comments:
          typeof finalMeta.teacher_overall_comments === 'string' &&
          finalMeta.teacher_overall_comments.trim()
            ? finalMeta.teacher_overall_comments.trim()
            : `Evaluated ${registeredQuestions.length} question(s) via Live Streaming Engine.`,
        speed_fixer_summary: combinedFixerSummary,
        questions: registeredQuestions,
      };

      sendSse({ type: 'completed', result: completedResult });
      res.end();
    } catch (error: unknown) {
      console.error('Server Live Grading error:', error);
      const formatted = formatGeminiError(error, 'Live AI processing failed. Ensure documents are clear.');
      if (!res.headersSent) {
        res.status(formatted.status).json({ error: formatted.message });
      } else {
        sendSse({ type: 'error', error: formatted.message });
        res.end();
      }
    } finally {
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    }
  });

  // Always return clean JSON for Express body-parser / payload errors
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      res.status(413).json({
        error: 'Uploaded documents exceed server payload limit. Please compress or split large PDFs.',
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Malformed JSON request payload.' });
      return;
    }
    next(err);
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
