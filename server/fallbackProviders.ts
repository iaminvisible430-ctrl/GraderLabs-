import type { Part } from '@google/genai';

export type FallbackProviderName = 'mistral' | 'huggingface' | 'cloudflare';

interface OpenAiContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface FallbackOcrParams {
  filePart: Part;
  filePages?: Part[];
  ocrPrompt: string;
}

export interface FallbackGradeParams {
  prompt: string;
  questionPaperPart: Part;
  referenceMaterialPart?: Part | null;
  answerSheetPart: Part;
  questionPaperPages?: Part[];
  referenceMaterialPages?: Part[];
  answerSheetPages?: Part[];
  signal?: AbortSignal;
}

export interface FallbackStreamCallbacks {
  onProviderStart?: (provider: FallbackProviderName, model: string) => void;
  onThinking?: (text: string) => void;
  onQuestionObject?: (rawQuestion: Record<string, unknown>) => void;
}

const FALLBACK_JSON_CONTRACT = `
**STRICT COMPACT JSON OUTPUT FORMAT (REQUIRED):**
Return ONLY a single valid JSON object (no markdown fences, no prose outside JSON) with this structure:
{
  "total_score": number,
  "max_marks": number,
  "pass_status": "Pass" | "Fail",
  "letter_grade": "A+" | "A" | "B" | "C" | "D" | "E" | "F",
  "teacher_overall_comments": string,
  "questions": [
    {
      "question_id": string,
      "question_text": string,
      "student_answer": string,
      "score": number,
      "full_marks": number,
      "confidence": number,
      "feedback": string,
      "annotation": { "ymin": number, "xmin": number, "ymax": number, "xmax": number, "page_number": integer }
    }
  ]
}
Grade EVERY single question across ALL sections in the Question Paper (do not skip or summarize multiple questions together).
If an exam has multiple sections that restart numbering (e.g. Section A 1..30 and Section B Q1..Q5), assign unique question_id values such as "1".."30" and "B1".."B5".
Keep "question_text" <= 10 words and "feedback" <= 14 words so all questions finish cleanly without truncation, and properly escape any double quotes inside JSON strings.
`;

export function getConfiguredFallbackProviders(): FallbackProviderName[] {
  const configured: FallbackProviderName[] = [];
  if (
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
    (process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_AUTH_TOKEN ||
      process.env.CLOUDFLARE_WORKERS_AI)?.trim()
  ) {
    configured.push('cloudflare');
  }
  if (process.env.MISTRAL_API_KEY?.trim()) {
    configured.push('mistral');
  }
  if ((process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN)?.trim()) {
    configured.push('huggingface');
  }
  return configured;
}

export function isGeminiFallbackEligibleError(error: unknown): boolean {
  const errObj = error as { status?: number; message?: string; code?: string };
  const status = errObj?.status;
  const msg = (errObj?.message || '').toUpperCase();
  if (status === 400 && !msg.includes('API_KEY')) {
    return false;
  }
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('GEMINI_API_KEY') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('QUOTA') ||
    msg.includes('RATE LIMIT') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('OVERLOADED') ||
    msg.includes('TIMEOUT') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('ECONNRESET')
  );
}

function getMistralKey(): string {
  return (process.env.MISTRAL_API_KEY || '').trim();
}

function getHuggingFaceKey(): string {
  return (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '').trim();
}

function getCloudflareCreds(): { accountId: string; apiToken: string } {
  return {
    accountId: (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    apiToken: (
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_AUTH_TOKEN ||
      process.env.CLOUDFLARE_WORKERS_AI ||
      ''
    ).trim(),
  };
}

function isImageInlinePart(part: Part | null | undefined): boolean {
  return Boolean(part?.inlineData?.mimeType?.startsWith('image/') && part?.inlineData?.data);
}

function isPdfInlinePart(part: Part | null | undefined): boolean {
  return Boolean(part?.inlineData?.mimeType === 'application/pdf' && part?.inlineData?.data);
}

function toDataUrl(part: Part): string {
  const mime = part.inlineData?.mimeType || 'image/jpeg';
  const data = part.inlineData?.data || '';
  return `data:${mime};base64,${data}`;
}

async function extractEmbeddedPdfTextNode(part: Part): Promise<string> {
  if (!isPdfInlinePart(part) || !part.inlineData?.data) return '';
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = new Uint8Array(Buffer.from(part.inlineData.data, 'base64'));
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    const chunks: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => (item && typeof item === 'object' && 'str' in item ? String((item as { str?: string }).str || '') : ''))
        .join(' ')
        .trim();
      if (pageText) {
        chunks.push(`[Page ${i} PDF Text]\n${pageText}`);
      }
    }
    await doc.destroy().catch(() => {});
    return chunks.join('\n\n').trim();
  } catch {
    return '';
  }
}

async function mistralPdfOcr(part: Part, signal?: AbortSignal): Promise<string> {
  const apiKey = getMistralKey();
  if (!apiKey || !isPdfInlinePart(part)) return '';
  try {
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          document_url: toDataUrl(part),
        },
      }),
    });
    if (!res.ok) return '';
    const json = (await res.json()) as {
      pages?: Array<{ index?: number; markdown?: string }>;
    };
    if (!Array.isArray(json.pages) || json.pages.length === 0) return '';
    return json.pages
      .map((p, idx) => `[Page ${(p.index ?? idx) + 1}]\n${(p.markdown || '').trim()}`)
      .join('\n\n')
      .trim();
  } catch {
    return '';
  }
}

async function cloudflareVisionOcrPage(part: Part, label: string, signal?: AbortSignal): Promise<string> {
  const { accountId, apiToken } = getCloudflareCreds();
  if (!accountId || !apiToken || !isImageInlinePart(part) || !part.inlineData?.data) return '';
  try {
    const imageBytes = Array.from(Buffer.from(part.inlineData.data, 'base64'));
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          prompt: `Transcribe all visible text, question numbers, filled MCQ/OMR choices, and handwritten answers from this ${label} page accurately.`,
          image: imageBytes,
          max_tokens: 2048,
        }),
      }
    );
    if (!res.ok) return '';
    const data = (await res.json()) as {
      result?: { response?: string; text?: string };
      response?: string;
      text?: string;
    };
    return (data.result?.response || data.result?.text || data.response || data.text || '').trim();
  } catch {
    return '';
  }
}

async function appendDocumentBlocks(
  blocks: OpenAiContentBlock[],
  label: string,
  part: Part,
  pages: Part[] | undefined,
  provider: FallbackProviderName,
  signal?: AbortSignal
): Promise<boolean> {
  blocks.push({ type: 'text', text: `\n\n--- ${label} ---` });

  if (part.text) {
    blocks.push({ type: 'text', text: part.text });
    return false;
  }

  // For Cloudflare, extract embedded PDF text first because Llama 3.3 70B fast expects text messages
  // and handles full multi-document context in <3 seconds without image-array formatting issues.
  if (provider === 'cloudflare' && isPdfInlinePart(part)) {
    const extractedText = await extractEmbeddedPdfTextNode(part);
    if (extractedText && extractedText.length >= 40) {
      blocks.push({ type: 'text', text: extractedText });
      return false;
    }
    const validPages = (pages || []).filter((p) => isImageInlinePart(p)).slice(0, 8);
    if (validPages.length > 0) {
      const pageTranscripts = await Promise.all(
        validPages.map(async (p, idx) => {
          const text = await cloudflareVisionOcrPage(p, `${label} Page ${idx + 1}`, signal);
          return text ? `[${label} - Page ${idx + 1} Vision OCR]\n${text}` : '';
        })
      );
      const joined = pageTranscripts.filter(Boolean).join('\n\n');
      if (joined) {
        blocks.push({ type: 'text', text: joined });
        return false;
      }
    }
  }

  if (provider === 'cloudflare' && isImageInlinePart(part)) {
    const ocrText = await cloudflareVisionOcrPage(part, label, signal);
    if (ocrText) {
      blocks.push({ type: 'text', text: ocrText });
      return false;
    }
  }

  if (isImageInlinePart(part)) {
    blocks.push({
      type: 'image_url',
      image_url: { url: toDataUrl(part) },
    });
    return true;
  }

  if (provider === 'mistral' && isPdfInlinePart(part)) {
    const ocrText = await mistralPdfOcr(part, signal);
    if (ocrText) {
      blocks.push({ type: 'text', text: ocrText });
      return false;
    }
  }

  const validPages = (pages || []).filter((p) => isImageInlinePart(p));
  if (validPages.length > 0) {
    validPages.forEach((p, idx) => {
      blocks.push({ type: 'text', text: `[${label} - Page ${idx + 1}]` });
      blocks.push({
        type: 'image_url',
        image_url: { url: toDataUrl(p) },
      });
    });
    return true;
  }

  if (isPdfInlinePart(part)) {
    const extractedText = await extractEmbeddedPdfTextNode(part);
    if (extractedText) {
      blocks.push({ type: 'text', text: extractedText });
      return false;
    }
    blocks.push({
      type: 'text',
      text: `[${label} is a PDF without extracted page images. Rely on supplementary PDF text layer provided in the prompt.]`,
    });
  }

  return false;
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function balanceTruncatedJson(slice: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
  }
  if (stack.length === 0 && !inString) return slice;
  let repaired = slice;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, '');
  while (stack.length > 0) {
    repaired += stack.pop();
  }
  return repaired;
}

function extractIndividualQuestionObjects(cleaned: string): Array<Record<string, unknown>> {
  const questions: Array<Record<string, unknown>> = [];
  const keyMatch = /"questions"\s*:\s*\[/.exec(cleaned);
  let i = keyMatch ? keyMatch.index + keyMatch[0].length : 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const chunk = cleaned.slice(start, i + 1);
        try {
          const obj = JSON.parse(chunk.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
          if (obj && typeof obj === 'object' && ('question_id' in obj || 'score' in obj)) {
            questions.push(obj);
          }
        } catch {
          // Skip malformed object
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0 && keyMatch) {
      break;
    }
  }
  return questions;
}

export function extractJsonObjectFromText(rawText: string): Record<string, unknown> {
  const cleaned = stripThinkTags(rawText)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Continue fallback extraction
  }

  const start = cleaned.indexOf('{');
  if (start === -1) {
    throw new Error('Fallback model output did not contain a JSON grading object.');
  }

  const lastClose = cleaned.lastIndexOf('}');
  if (lastClose > start) {
    const slice = cleaned.slice(start, lastClose + 1);
    try {
      const parsed = JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      const balanced = balanceTruncatedJson(slice);
      if (balanced) {
        try {
          const parsed = JSON.parse(balanced.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {
          // Try question-level recovery below
        }
      }
    }
  } else {
    const balanced = balanceTruncatedJson(cleaned.slice(start));
    if (balanced) {
      try {
        const parsed = JSON.parse(balanced) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // Continue recovery
      }
    }
  }

  const questions = extractIndividualQuestionObjects(cleaned);
  if (questions.length === 0) {
    throw new Error('Fallback model returned non-parseable grading JSON with 0 valid questions.');
  }

  const totalScore = Math.round(questions.reduce((s, q) => s + (Number(q.score) || 0), 0) * 100) / 100;
  const maxMarks = Math.round(questions.reduce((s, q) => s + (Number(q.full_marks) || 1), 0) * 100) / 100;

  return {
    total_score: totalScore,
    max_marks: maxMarks,
    teacher_overall_comments: `Recovered ${questions.length} graded question(s) from fallback stream.`,
    questions,
  };
}

/**
 * Incrementally extracts completed JSON objects from the top-level `"questions": [ ... ]` array
 * while an OpenAI-compatible SSE completion is streaming.
 */
class IncrementalQuestionStreamParser {
  private buffer = '';
  private scanIndex = 0;
  private state: 'seeking_key' | 'seeking_array' | 'in_array' | 'in_object' | 'done' = 'seeking_key';
  private objectStart = -1;
  private braceDepth = 0;
  private inString = false;
  private escaped = false;
  private inThinkTag = false;
  private emittedCount = 0;

  feed(delta: string, onThinking?: (thought: string) => void, onQuestion?: (q: Record<string, unknown>) => void) {
    if (!delta) return;

    let cleanDelta = delta;
    // Extract <think>...</think> reasoning if model emits inline think tags
    if (cleanDelta.includes('<think>') || this.inThinkTag) {
      let out = '';
      let cursor = 0;
      while (cursor < cleanDelta.length) {
        if (!this.inThinkTag) {
          const idx = cleanDelta.indexOf('<think>', cursor);
          if (idx === -1) {
            out += cleanDelta.slice(cursor);
            break;
          }
          out += cleanDelta.slice(cursor, idx);
          this.inThinkTag = true;
          cursor = idx + 7;
        } else {
          const endIdx = cleanDelta.indexOf('</think>', cursor);
          if (endIdx === -1) {
            onThinking?.(cleanDelta.slice(cursor));
            cursor = cleanDelta.length;
          } else {
            onThinking?.(cleanDelta.slice(cursor, endIdx));
            this.inThinkTag = false;
            cursor = endIdx + 8;
          }
        }
      }
      cleanDelta = out;
    }

    if (!cleanDelta) return;
    this.buffer += cleanDelta;

    while (this.scanIndex < this.buffer.length && this.state !== 'done') {
      if (this.state === 'seeking_key') {
        const match = /"questions"\s*:\s*\[/.exec(this.buffer.slice(Math.max(0, this.scanIndex - 20)));
        if (!match) {
          this.scanIndex = Math.max(0, this.buffer.length - 18);
          break;
        }
        const baseOffset = Math.max(0, this.scanIndex - 20);
        this.scanIndex = baseOffset + match.index + match[0].length;
        this.state = 'in_array';
        continue;
      }

      const ch = this.buffer[this.scanIndex];
      if (this.state === 'in_array') {
        if (ch === '{') {
          this.state = 'in_object';
          this.objectStart = this.scanIndex;
          this.braceDepth = 1;
          this.inString = false;
          this.escaped = false;
        } else if (ch === ']') {
          this.state = 'done';
        }
        this.scanIndex++;
        continue;
      }

      if (this.state === 'in_object') {
        if (this.inString) {
          if (this.escaped) {
            this.escaped = false;
          } else if (ch === '\\') {
            this.escaped = true;
          } else if (ch === '"') {
            this.inString = false;
          }
          this.scanIndex++;
          continue;
        }

        if (ch === '"') {
          this.inString = true;
        } else if (ch === '{') {
          this.braceDepth++;
        } else if (ch === '}') {
          this.braceDepth--;
          if (this.braceDepth === 0 && this.objectStart >= 0) {
            const objStr = this.buffer.slice(this.objectStart, this.scanIndex + 1);
            try {
              const parsedObj = JSON.parse(objStr) as Record<string, unknown>;
              if (parsedObj && typeof parsedObj === 'object') {
                this.emittedCount++;
                onQuestion?.(parsedObj);
              }
            } catch {
              // Ignore malformed partial; full JSON parse at completion will reconcile
            }
            this.objectStart = -1;
            this.state = 'in_array';
          }
        }
        this.scanIndex++;
      }
    }
  }

  getFullText(): string {
    return this.buffer;
  }

  getEmittedCount(): number {
    return this.emittedCount;
  }
}

interface OpenAiCompatEndpointConfig {
  provider: FallbackProviderName;
  url: string;
  apiKey: string;
  models: string[];
  supportsJsonObjectMode: boolean;
}

function getEndpointConfig(
  provider: FallbackProviderName,
  hasImages: boolean
): OpenAiCompatEndpointConfig | null {
  if (provider === 'mistral') {
    const apiKey = getMistralKey();
    if (!apiKey) return null;
    const configured = process.env.MISTRAL_MODEL?.trim();
    const models = configured
      ? [configured]
      : hasImages
      ? ['mistral-small-latest', 'mistral-large-latest']
      : ['mistral-large-latest', 'mistral-small-latest'];
    return {
      provider,
      url: 'https://api.mistral.ai/v1/chat/completions',
      apiKey,
      models,
      supportsJsonObjectMode: true,
    };
  }

  if (provider === 'huggingface') {
    const apiKey = getHuggingFaceKey();
    if (!apiKey) return null;
    const configured = process.env.HUGGINGFACE_MODEL?.trim();
    const models = configured
      ? [configured]
      : hasImages
      ? ['Qwen/Qwen2.5-VL-72B-Instruct:fastest', 'Qwen/Qwen2.5-VL-7B-Instruct:fastest']
      : ['Qwen/Qwen2.5-72B-Instruct:fastest', 'meta-llama/Llama-3.3-70B-Instruct:fastest'];
    return {
      provider,
      url: 'https://router.huggingface.co/v1/chat/completions',
      apiKey,
      models,
      supportsJsonObjectMode: false,
    };
  }

  if (provider === 'cloudflare') {
    const { accountId, apiToken } = getCloudflareCreds();
    if (!accountId || !apiToken) return null;
    const configured = process.env.CLOUDFLARE_MODEL?.trim();
    const models = configured
      ? [configured]
      : ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
    return {
      provider,
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      apiKey: apiToken,
      models,
      supportsJsonObjectMode: false,
    };
  }

  return null;
}

/**
 * Merges text-only blocks into a plain string (required by Cloudflare Workers AI /v1/chat/completions)
 * and coalesces adjacent text blocks when multimodal blocks are present.
 */
function serializeOpenAiMessageContent(blocks: OpenAiContentBlock[]): string | OpenAiContentBlock[] {
  const hasImages = blocks.some((b) => b.type === 'image_url');
  if (!hasImages) {
    return blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n\n');
  }
  const merged: OpenAiContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text && merged.length > 0 && merged[merged.length - 1].type === 'text') {
      merged[merged.length - 1] = {
        type: 'text',
        text: `${merged[merged.length - 1].text}\n\n${b.text}`,
      };
    } else {
      merged.push(b);
    }
  }
  return merged;
}

async function callOpenAiCompatCompletion(
  config: OpenAiCompatEndpointConfig,
  blocks: OpenAiContentBlock[],
  expectJson: boolean,
  signal?: AbortSignal
): Promise<{ text: string; model: string }> {
  let lastError: unknown;
  const serializedContent = serializeOpenAiMessageContent(blocks);

  for (const model of config.models) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 120_000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const body: Record<string, unknown> = {
        model,
        messages: [
          {
            role: 'user',
            content: serializedContent,
          },
        ],
        max_tokens: 8192,
      };
      if (expectJson && config.supportsJsonObjectMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(config.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: combinedSignal,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        throw new Error(`${config.provider} (${model}) returned ${res.status}: ${errTxt.slice(0, 240)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      const text =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
          ? rawContent.map((c) => c.text || '').join('')
          : '';
      if (!text.trim()) {
        throw new Error(`${config.provider} (${model}) returned an empty response.`);
      }
      return { text: text.trim(), model };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${config.provider} request failed.`);
}

async function callOpenAiCompatStream(
  config: OpenAiCompatEndpointConfig,
  blocks: OpenAiContentBlock[],
  callbacks: FallbackStreamCallbacks,
  signal?: AbortSignal
): Promise<{ text: string; model: string }> {
  // Cloudflare Workers AI fp8-fast SSE streaming occasionally drops single characters inside deltas,
  // corrupting large JSON arrays. Using non-stream completion avoids delta drops while keeping latency ~25-40s.
  if (config.provider === 'cloudflare') {
    const firstModel = config.models[0] || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    callbacks.onProviderStart?.(config.provider, firstModel);
    callbacks.onThinking?.(
      `Evaluating all exam questions and rubric criteria via ${firstModel}...\n`
    );
    const heartbeat = setInterval(() => {
      callbacks.onThinking?.('Evaluating remaining sections and verifying marks...\n');
    }, 10_000);
    try {
      const singleRes = await callOpenAiCompatCompletion(config, blocks, false, signal);
      const parsedJson = extractJsonObjectFromText(singleRes.text);
      if (typeof parsedJson.teacher_overall_comments === 'string' && parsedJson.teacher_overall_comments.trim()) {
        callbacks.onThinking?.(`Summary: ${parsedJson.teacher_overall_comments.trim()}\n`);
      }
      if (Array.isArray(parsedJson.questions)) {
        for (const q of parsedJson.questions) {
          if (q && typeof q === 'object') {
            callbacks.onQuestionObject?.(q as Record<string, unknown>);
          }
        }
      }
      return singleRes;
    } finally {
      clearInterval(heartbeat);
    }
  }

  let lastError: unknown;
  const serializedContent = serializeOpenAiMessageContent(blocks);

  for (const model of config.models) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 210_000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      callbacks.onProviderStart?.(config.provider, model);

      const body: Record<string, unknown> = {
        model,
        stream: true,
        messages: [
          {
            role: 'user',
            content: serializedContent,
          },
        ],
        max_tokens: 8192,
      };
      if (config.supportsJsonObjectMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(config.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: combinedSignal,
        body: JSON.stringify(body),
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || !res.body) {
        const errTxt = await res.text().catch(() => '');
        // Try non-streaming fallback inside the same provider if streaming is rejected
        try {
          const singleRes = await callOpenAiCompatCompletion(
            { ...config, models: [model] },
            blocks,
            true,
            combinedSignal
          );
          try {
            const parsedJson = extractJsonObjectFromText(singleRes.text);
            if (Array.isArray(parsedJson.questions)) {
              for (const q of parsedJson.questions) {
                if (q && typeof q === 'object') {
                  callbacks.onQuestionObject?.(q as Record<string, unknown>);
                }
              }
            }
          } catch {
            // Let caller parse or surface formatting error
          }
          return singleRes;
        } catch {
          throw new Error(`${config.provider} (${model}) stream failed (${res.status}): ${errTxt.slice(0, 220)}`);
        }
      }

      if (contentType.includes('application/json')) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
        };
        const rawContent = data.choices?.[0]?.message?.content;
        const text =
          typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
            ? rawContent.map((c) => c.text || '').join('')
            : '';
        if (text.trim()) {
          try {
            const parsedJson = extractJsonObjectFromText(text);
            if (Array.isArray(parsedJson.questions)) {
              for (const q of parsedJson.questions) {
                if (q && typeof q === 'object') {
                  callbacks.onQuestionObject?.(q as Record<string, unknown>);
                }
              }
            }
          } catch {
            // Caller handles parse failure
          }
          return { text: text.trim(), model };
        }
      }

      const parser = new IncrementalQuestionStreamParser();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = '';

      const processSseLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const payloadStr = line.slice(5).trim();
        if (!payloadStr || payloadStr === '[DONE]') return;
        try {
          const chunk = JSON.parse(payloadStr) as {
            choices?: Array<{
              delta?: {
                content?: string | Array<{ text?: string }>;
                reasoning_content?: string;
                reasoning?: string;
              };
            }>;
          };
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) return;
          const reasoningDelta = delta.reasoning_content || delta.reasoning;
          if (typeof reasoningDelta === 'string' && reasoningDelta) {
            callbacks.onThinking?.(reasoningDelta);
          }
          const contentDelta =
            typeof delta.content === 'string'
              ? delta.content
              : Array.isArray(delta.content)
              ? delta.content.map((c) => c.text || '').join('')
              : '';
          if (contentDelta) {
            parser.feed(contentDelta, callbacks.onThinking, callbacks.onQuestionObject);
          }
        } catch {
          // Ignore non-JSON heartbeat lines
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          sseBuf += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
          const lines = sseBuf.split('\n');
          sseBuf = lines.pop() || '';
          for (const line of lines) {
            processSseLine(line);
          }
        }
        if (done) {
          if (sseBuf.trim()) processSseLine(sseBuf);
          break;
        }
      }

      const fullText = parser.getFullText().trim();
      if (!fullText) {
        throw new Error(`${config.provider} (${model}) stream ended with empty content.`);
      }
      return { text: fullText, model };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${config.provider} stream failed.`);
}

async function buildGradingBlocks(
  params: FallbackGradeParams,
  provider: FallbackProviderName
): Promise<{ blocks: OpenAiContentBlock[]; hasImages: boolean }> {
  const blocks: OpenAiContentBlock[] = [
    {
      type: 'text',
      text: `${params.prompt}\n\n${FALLBACK_JSON_CONTRACT}`,
    },
  ];

  const hasQpImg = await appendDocumentBlocks(
    blocks,
    'QUESTION PAPER',
    params.questionPaperPart,
    params.questionPaperPages,
    provider,
    params.signal
  );

  let hasRefImg = false;
  if (params.referenceMaterialPart) {
    hasRefImg = await appendDocumentBlocks(
      blocks,
      'ANSWER KEY',
      params.referenceMaterialPart,
      params.referenceMaterialPages,
      provider,
      params.signal
    );
  }

  const hasAnsImg = await appendDocumentBlocks(
    blocks,
    'STUDENT SHEET',
    params.answerSheetPart,
    params.answerSheetPages,
    provider,
    params.signal
  );

  return {
    blocks,
    hasImages: hasQpImg || hasRefImg || hasAnsImg,
  };
}

export async function runFallbackOcr(
  params: FallbackOcrParams
): Promise<{ text: string; provider: FallbackProviderName; model: string }> {
  const providers = getConfiguredFallbackProviders();
  if (providers.length === 0) {
    throw new Error('No fallback LLM providers configured.');
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      if (provider === 'mistral' && isPdfInlinePart(params.filePart)) {
        const directPdfOcr = await mistralPdfOcr(params.filePart);
        if (directPdfOcr) {
          return { text: directPdfOcr, provider: 'mistral', model: 'mistral-ocr-latest' };
        }
      }

      const blocks: OpenAiContentBlock[] = [{ type: 'text', text: params.ocrPrompt }];
      const hasImages = await appendDocumentBlocks(
        blocks,
        'DOCUMENT',
        params.filePart,
        params.filePages,
        provider
      );
      const config = getEndpointConfig(provider, hasImages);
      if (!config) continue;

      const { text, model } = await callOpenAiCompatCompletion(config, blocks, false);
      return { text, provider, model };
    } catch (err: unknown) {
      errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All fallback OCR providers failed (${errors.join(' | ')})`);
}

export async function runFallbackGrade(
  params: FallbackGradeParams
): Promise<{ parsed: Record<string, unknown>; provider: FallbackProviderName; model: string }> {
  const providers = getConfiguredFallbackProviders();
  if (providers.length === 0) {
    throw new Error('No fallback LLM providers configured.');
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const { blocks, hasImages } = await buildGradingBlocks(params, provider);
      const config = getEndpointConfig(provider, hasImages);
      if (!config) continue;

      const { text, model } = await callOpenAiCompatCompletion(config, blocks, true, params.signal);
      const parsed = extractJsonObjectFromText(text);
      return { parsed, provider, model };
    } catch (err: unknown) {
      if (params.signal?.aborted) throw err;
      errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All fallback grading providers failed (${errors.join(' | ')})`);
}

export async function runFallbackGradeStream(
  params: FallbackGradeParams,
  callbacks: FallbackStreamCallbacks
): Promise<{ parsed: Record<string, unknown>; provider: FallbackProviderName; model: string }> {
  const providers = getConfiguredFallbackProviders();
  if (providers.length === 0) {
    throw new Error('No fallback LLM providers configured.');
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const { blocks, hasImages } = await buildGradingBlocks(params, provider);
      const config = getEndpointConfig(provider, hasImages);
      if (!config) continue;

      const { text, model } = await callOpenAiCompatStream(config, blocks, callbacks, params.signal);
      const parsed = extractJsonObjectFromText(text);
      return { parsed, provider, model };
    } catch (err: unknown) {
      if (params.signal?.aborted) throw err;
      errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All fallback live providers failed (${errors.join(' | ')})`);
}
