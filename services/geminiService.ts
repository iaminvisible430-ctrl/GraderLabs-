import {
  GradingMode,
  type GradingResult,
  type BoundingBox,
  type QuestionResult,
  type LiveToolEvent,
} from '../types';
import { loadPdfDocument } from '../utils/pdfUtils';
import {
  resolveEffectiveMimeType,
  isPdfFile,
  isImageMime,
  fileToBase64,
  optimizeImageForApi,
  readDocumentAsText,
} from '../utils/fileUtils';

interface SerializedPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface LiveGradingCallbacks {
  onStatus?: (message: string) => void;
  onThinking?: (deltaText: string) => void;
  onToolCall?: (event: LiveToolEvent) => void;
  onQuestionGraded?: (
    question: QuestionResult,
    runningScore: number,
    runningMax: number
  ) => void;
  onComplete?: (result: GradingResult) => void;
}

export async function extractTextAndLayoutFromFile(file: File): Promise<string | undefined> {
  const mime = await resolveEffectiveMimeType(file);
  if (!isPdfFile(file, mime)) {
    return undefined;
  }

  let pdf: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdf = await loadPdfDocument(new Uint8Array(arrayBuffer));

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str || '').join(' ');
      fullText += `[Page ${i} Text Layer]\n${pageText}\n\n`;
    }
    return fullText.trim();
  } catch (error) {
    console.warn(
      `Warning: Could not extract text layer from PDF (${file.name}). Proceeding with visual-only grading.`,
      error
    );
    return undefined;
  } finally {
    if (pdf) {
      await pdf.destroy().catch(() => {});
    }
  }
}

export async function renderPdfFallbackPages(
  file: File,
  maxPages = 6,
  timeoutMs = 1500
): Promise<SerializedPart[]> {
  const mime = await resolveEffectiveMimeType(file);
  if (!isPdfFile(file, mime) || typeof document === 'undefined') {
    return [];
  }

  const renderTask = async (): Promise<SerializedPart[]> => {
    let pdf: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
    try {
      const arrayBuffer = await file.arrayBuffer();
      pdf = await loadPdfDocument(new Uint8Array(arrayBuffer));
      const count = Math.min(pdf.numPages, maxPages);
      const pages: SerializedPart[] = [];

      for (let i = 1; i <= count; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1] || '';
        if (base64) {
          pages.push({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
        }
      }
      return pages;
    } catch {
      return [];
    } finally {
      if (pdf) {
        await pdf.destroy().catch(() => {});
      }
    }
  };

  return Promise.race([
    renderTask(),
    new Promise<SerializedPart[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ]);
}

const fileToPart = async (file: File): Promise<SerializedPart> => {
  if (!file || file.size === 0) {
    throw new Error(`File "${file?.name || 'document'}" is empty (0 bytes).`);
  }

  const resolvedMime = await resolveEffectiveMimeType(file);

  if (resolvedMime === 'application/pdf') {
    const data = await fileToBase64(file);
    return { inlineData: { mimeType: 'application/pdf', data } };
  }

  if (isImageMime(resolvedMime)) {
    const optimized = await optimizeImageForApi(file, resolvedMime);
    return { inlineData: optimized };
  }

  const text = await readDocumentAsText(file, resolvedMime);
  if (!text.trim()) {
    throw new Error(`File "${file.name}" contains no readable text content.`);
  }
  return { text };
};

// --- DEDICATED FORENSIC OCR SERVICE (SERVER-SIDE) ---
export async function performHandwrittenOCR(file: File): Promise<string> {
  try {
    const [filePart, filePages] = await Promise.all([
      fileToPart(file),
      renderPdfFallbackPages(file, 4, 1000),
    ]);
    const response = await fetch('/api/gemini/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePart, filePages }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `OCR request failed (${response.status})`);
    }

    const data = (await response.json()) as { text?: string };
    return (data.text || '').trim();
  } catch (e) {
    console.warn('OCR Pre-processing failed, continuing to main grading without it.', e);
    return '';
  }
}

export async function gradeAnswers(
  answerSheet: File,
  referenceMaterial: File | null,
  questionPaper: File,
  mode: GradingMode,
  boundingBoxes?: BoundingBox[],
  studentOcrData?: string,
  qpOcrData?: string,
  refOcrData?: string,
  rawStudentOCR?: string,
  baseHint?: string
): Promise<GradingResult> {
  try {
    const [
      questionPaperPart,
      answerSheetPart,
      referenceMaterialPart,
      questionPaperPages,
      answerSheetPages,
      referenceMaterialPages,
    ] = await Promise.all([
      fileToPart(questionPaper),
      fileToPart(answerSheet),
      referenceMaterial ? fileToPart(referenceMaterial) : Promise.resolve(null),
      renderPdfFallbackPages(questionPaper, 6, 1200),
      renderPdfFallbackPages(answerSheet, 6, 1200),
      referenceMaterial ? renderPdfFallbackPages(referenceMaterial, 6, 1200) : Promise.resolve([]),
    ]);

    const response = await fetch('/api/gemini/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answerSheetPart,
        referenceMaterialPart,
        questionPaperPart,
        questionPaperPages,
        referenceMaterialPages,
        answerSheetPages,
        mode,
        baseHint,
        boundingBoxes,
        studentOcrData,
        qpOcrData,
        refOcrData,
        rawStudentOCR,
      }),
    });

    if (response.status === 413) {
      throw new Error(
        'Uploaded documents are too large for a single grading pass. Please compress or split large PDFs and try again.'
      );
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || 'AI processing failed. Ensure documents are clear and valid.');
    }

    if (!data || !Array.isArray(data.questions)) {
      throw new Error('AI returned an incomplete grading structure. Please try running the evaluation again.');
    }

    return data as GradingResult;
  } catch (error: any) {
    console.error('Grading API Error:', error);
    if (error?.message) {
      throw new Error(error.message);
    }
    throw new Error('AI processing failed. Ensure documents are clear.');
  }
}

export async function gradeAnswersLive(
  answerSheet: File,
  referenceMaterial: File | null,
  questionPaper: File,
  mode: GradingMode,
  callbacks: LiveGradingCallbacks,
  options?: {
    boundingBoxes?: BoundingBox[];
    studentOcrData?: string;
    qpOcrData?: string;
    refOcrData?: string;
    rawStudentOCR?: string;
    baseHint?: string;
    signal?: AbortSignal;
  }
): Promise<GradingResult> {
  callbacks.onStatus?.('Encoding & uploading exam documents to AI live stream...');

  const [
    questionPaperPart,
    answerSheetPart,
    referenceMaterialPart,
    questionPaperPages,
    answerSheetPages,
    referenceMaterialPages,
  ] = await Promise.all([
    fileToPart(questionPaper),
    fileToPart(answerSheet),
    referenceMaterial ? fileToPart(referenceMaterial) : Promise.resolve(null),
    renderPdfFallbackPages(questionPaper, 6, 1200),
    renderPdfFallbackPages(answerSheet, 6, 1200),
    referenceMaterial ? renderPdfFallbackPages(referenceMaterial, 6, 1200) : Promise.resolve([]),
  ]);

  const response = await fetch('/api/gemini/grade-live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options?.signal,
    body: JSON.stringify({
      answerSheetPart,
      referenceMaterialPart,
      questionPaperPart,
      questionPaperPages,
      referenceMaterialPages,
      answerSheetPages,
      mode,
      baseHint: options?.baseHint,
      boundingBoxes: options?.boundingBoxes,
      studentOcrData: options?.studentOcrData,
      qpOcrData: options?.qpOcrData,
      refOcrData: options?.refOcrData,
      rawStudentOCR: options?.rawStudentOCR,
    }),
  });

  if (response.status === 413) {
    throw new Error(
      'Uploaded documents are too large for a single grading pass. Please compress or split large PDFs and try again.'
    );
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    throw new Error(errData?.error || 'Live AI evaluation failed to start.');
  }

  if (!response.body) {
    throw new Error('Streaming response body is unavailable in this browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: GradingResult | null = null;

  const processFrame = (frame: string) => {
    const dataLines = frame
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());

    if (dataLines.length === 0) return;

    const jsonStr = dataLines.join('\n');
    let payload: any;
    try {
      payload = JSON.parse(jsonStr);
    } catch {
      return;
    }

    if (payload.type === 'status' && typeof payload.message === 'string') {
      callbacks.onStatus?.(payload.message);
    } else if (payload.type === 'thinking' && typeof payload.text === 'string') {
      callbacks.onThinking?.(payload.text);
    } else if (payload.type === 'tool_call') {
      const evt: LiveToolEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        toolName: payload.toolName || 'system',
        summary: payload.summary || 'AI tool executed',
        questionId: payload.questionId,
        score: typeof payload.score === 'number' ? payload.score : undefined,
        fullMarks: typeof payload.fullMarks === 'number' ? payload.fullMarks : undefined,
        hasAnnotation: Boolean(payload.hasAnnotation),
        status: payload.status || 'success',
      };
      callbacks.onToolCall?.(evt);
    } else if (payload.type === 'question_graded' && payload.question) {
      callbacks.onQuestionGraded?.(
        payload.question as QuestionResult,
        Number(payload.total_score) || 0,
        Number(payload.max_marks) || 0
      );
    } else if (payload.type === 'completed' && payload.result) {
      finalResult = payload.result as GradingResult;
      callbacks.onComplete?.(finalResult);
    } else if (payload.type === 'error') {
      throw new Error(payload.error || 'Live AI grading stream encountered an error.');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    processFrame(buffer);
  }

  if (!finalResult) {
    throw new Error('Live grading stream ended before completion.');
  }

  return finalResult;
}
