import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  getWorkspaceState,
  getEvaluationHistory,
  getEvaluationRecordById,
  deleteEvaluationRecord,
  startMcpLiveSession,
  registerMcpQuestion,
  applyMcpSpeedFixerRepair,
  finalizeMcpSession,
  saveDirectStudioEvaluation,
} from './studioStore.ts';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

const ANNOTATION_JSON_SCHEMA = {
  type: 'object',
  description:
    'Normalized 0-1000 bounding box for the page: (0,0) top-left, (1000,1000) bottom-right, 1-indexed page_number.',
  properties: {
    ymin: { type: 'number', minimum: 0, maximum: 1000 },
    xmin: { type: 'number', minimum: 0, maximum: 1000 },
    ymax: { type: 'number', minimum: 0, maximum: 1000 },
    xmax: { type: 'number', minimum: 0, maximum: 1000 },
    page_number: { type: 'integer', minimum: 1 },
  },
  required: ['ymin', 'xmin', 'ymax', 'xmax', 'page_number'],
};

export const MCP_TOOLS = [
  {
    name: 'get_studio_workspace',
    description:
      'Inspects the currently mounted GraderLabs Studio exam workspace (Question Paper, Answer Key/Rubric, Student Answer Sheet(s), OMR bounding boxes, active grading mode, page counts, and extracted text layers). Does NOT invoke any server-side LLM.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_document_page_image',
    description:
      'Retrieves a rendered JPEG image of a specific page from the mounted Question Paper, Answer Key, or Student Sheet so the connected AI can visually read handwriting, diagrams, or filled OMR bubbles directly.',
    inputSchema: {
      type: 'object',
      properties: {
        slot: {
          type: 'string',
          enum: ['question_paper', 'answer_key', 'student_sheet'],
          description: 'Which document slot to inspect.',
        },
        page_number: {
          type: 'integer',
          minimum: 1,
          description: '1-indexed page number within that document.',
        },
        student_id: {
          type: 'string',
          description: 'Optional studentId when multiple student sheets are queued in batch mode.',
        },
      },
      required: ['slot', 'page_number'],
    },
  },
  {
    name: 'start_live_evaluation_session',
    description:
      'Opens the GraderLabs Student Report Studio live in connected browsers and creates a live evaluation session ID so each evaluated question streams in real time.',
    inputSchema: {
      type: 'object',
      properties: {
        student_name: { type: 'string', description: 'Student or script label shown in Studio & History.' },
        mode: { type: 'string', description: 'Evaluation mode label (e.g., Hybrid, Speed Fixer, Handwritten, OMR).' },
        agent_name: { type: 'string', description: 'Name of the connected AI client evaluating the exam (e.g., Claude, ChatGPT).' },
        thinking_summary: { type: 'string', description: 'Optional initial reasoning note displayed in the live Studio stream.' },
      },
    },
  },
  {
    name: 'register_question_evaluation',
    description:
      'Registers one evaluated question (score, student answer transcription, feedback, and 0-1000 spatial bounding box annotations) into the live Student Report Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID from start_live_evaluation_session (defaults to latest active session).' },
        question_id: { type: 'string', description: 'Unique question ID matching the paper (e.g. "1", "2", "B1").' },
        question_text: { type: 'string', description: 'Concise text/prompt of the question.' },
        student_answer: { type: 'string', description: 'Transcribed student answer or selected OMR option.' },
        score: { type: 'number', description: 'Marks awarded.' },
        full_marks: { type: 'number', description: 'Maximum possible marks.' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Evaluation confidence (0.0 - 1.0).' },
        feedback: { type: 'string', description: 'Specific rubric feedback justifying the awarded score.' },
        fixer_note: { type: 'string', description: 'Optional Speed Fixer repair note.' },
        annotation: ANNOTATION_JSON_SCHEMA,
        qp_annotation: ANNOTATION_JSON_SCHEMA,
        ref_annotation: ANNOTATION_JSON_SCHEMA,
      },
      required: ['question_id', 'question_text', 'student_answer', 'score', 'full_marks', 'feedback'],
    },
  },
  {
    name: 'apply_speed_fixer_repair',
    description:
      'Logs an automatic Speed Fixer repair event (QID normalization, crossed-out text cleanup, coordinate re-anchoring) into the live Student Report Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        question_id: { type: 'string' },
        issue_type: {
          type: 'string',
          description: 'e.g. qid_normalization, strikethrough_cleanup, coordinate_reanchor, partial_credit_split, ocr_disambiguation',
        },
        description: { type: 'string' },
      },
      required: ['question_id', 'issue_type', 'description'],
    },
  },
  {
    name: 'finalize_exam_evaluation',
    description:
      'Finalizes the active live evaluation session, persists the complete Student Report Studio evaluation into Studio Evaluation History, and notifies connected UI dashboards.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        student_name: { type: 'string' },
        total_score: { type: 'number' },
        max_marks: { type: 'number' },
        pass_status: { type: 'string' },
        letter_grade: { type: 'string' },
        special_award: { type: 'string' },
        teacher_overall_comments: { type: 'string' },
        speed_fixer_summary: { type: 'string' },
      },
      required: ['teacher_overall_comments'],
    },
  },
  {
    name: 'save_studio_evaluation',
    description:
      'One-shot tool to submit a complete evaluated exam report directly into Student Report Studio & persistent Studio Evaluation History without streaming individual question calls.',
    inputSchema: {
      type: 'object',
      properties: {
        student_name: { type: 'string' },
        mode_label: { type: 'string' },
        agent_name: { type: 'string' },
        total_score: { type: 'number' },
        max_marks: { type: 'number' },
        pass_status: { type: 'string' },
        letter_grade: { type: 'string' },
        special_award: { type: 'string' },
        teacher_overall_comments: { type: 'string' },
        speed_fixer_summary: { type: 'string' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question_id: { type: 'string' },
              question_text: { type: 'string' },
              student_answer: { type: 'string' },
              score: { type: 'number' },
              full_marks: { type: 'number' },
              confidence: { type: 'number' },
              feedback: { type: 'string' },
              fixer_note: { type: 'string' },
              annotation: ANNOTATION_JSON_SCHEMA,
              qp_annotation: ANNOTATION_JSON_SCHEMA,
              ref_annotation: ANNOTATION_JSON_SCHEMA,
            },
            required: ['question_id', 'question_text', 'student_answer', 'score', 'full_marks', 'feedback'],
          },
        },
      },
      required: ['questions', 'teacher_overall_comments'],
    },
  },
  {
    name: 'list_evaluation_history',
    description:
      'Lists saved Student Report Studio evaluations in persistent Studio history (scores, grades, question counts, timestamps, document names, and source agent).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'get_evaluation_report',
    description:
      'Fetches the full Student Report Studio evaluation JSON (every question, OCR transcript, awarded marks, feedback, and spatial annotations) for a saved report_id from Studio history.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: { type: 'string' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'delete_evaluation_report',
    description: 'Deletes a specific evaluation report from persistent Studio Evaluation History.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: { type: 'string' },
      },
      required: ['report_id'],
    },
  },
];

function formatTextContent(data: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function handleToolCall(name: string, args: Record<string, unknown> = {}) {
  switch (name) {
    case 'get_studio_workspace': {
      const ws = getWorkspaceState();
      return formatTextContent({
        updatedAt: ws.updatedAt,
        modeLabel: ws.modeLabel,
        baseMode: ws.baseMode,
        specialMode: ws.specialMode,
        omrBoundingBoxesCount: ws.omrBoundingBoxes.length,
        omrBoundingBoxes: ws.omrBoundingBoxes,
        questionPaper: ws.questionPaper
          ? {
              name: ws.questionPaper.name,
              mimeType: ws.questionPaper.mimeType,
              pageCount: ws.questionPaper.pageCount,
              renderedImagesAvailable: ws.questionPaper.pages.length,
              textContent: ws.questionPaper.textContent,
            }
          : null,
        answerKey: ws.answerKey
          ? {
              name: ws.answerKey.name,
              mimeType: ws.answerKey.mimeType,
              pageCount: ws.answerKey.pageCount,
              renderedImagesAvailable: ws.answerKey.pages.length,
              textContent: ws.answerKey.textContent,
            }
          : null,
        studentSheets: ws.studentSheets.map((s) => ({
          studentId: s.studentId,
          name: s.name,
          rollNumber: s.rollNumber,
          studentClass: s.studentClass,
          mimeType: s.mimeType,
          pageCount: s.pageCount,
          renderedImagesAvailable: s.pages.length,
          textContent: s.textContent,
        })),
        nextStepHint:
          !ws.questionPaper && ws.studentSheets.length === 0
            ? 'No exam documents are currently mounted in the browser Studio. Ask the user to upload Question Paper, Answer Key, and Student Sheet in GraderLabs Studio, or evaluate provided text directly and persist with save_studio_evaluation / start_live_evaluation_session.'
            : 'Use get_document_page_image to inspect page visuals with your own vision, then grade via start_live_evaluation_session -> register_question_evaluation -> finalize_exam_evaluation.',
      });
    }

    case 'get_document_page_image': {
      const ws = getWorkspaceState();
      const slot = String(args.slot || '');
      const pageNum = Math.max(1, Math.round(Number(args.page_number) || 1));
      const studentId = typeof args.student_id === 'string' ? args.student_id : undefined;

      let doc =
        slot === 'question_paper'
          ? ws.questionPaper
          : slot === 'answer_key'
          ? ws.answerKey
          : slot === 'student_sheet'
          ? (studentId
              ? ws.studentSheets.find((s) => s.studentId === studentId)
              : ws.studentSheets[0]) || null
          : null;

      if (!doc) {
        return {
          content: [{ type: 'text', text: `No document mounted for slot "${slot}".` }],
          isError: true,
        };
      }

      const pageBase64 = doc.pages[pageNum - 1];
      if (!pageBase64) {
        return {
          content: [
            {
              type: 'text',
              text: `Page ${pageNum} image is not available for "${doc.name}" (${doc.pages.length} rendered image page(s) available). Extracted text:\n${doc.textContent}`,
            },
          ],
          isError: doc.pages.length > 0,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `${doc.name} (${slot}) — Page ${pageNum} of ${doc.pageCount}. Normalized coordinate space for bounding boxes is [0..1000] x [0..1000].`,
          },
          {
            type: 'image',
            data: pageBase64,
            mimeType: 'image/jpeg',
          },
        ],
      };
    }

    case 'start_live_evaluation_session': {
      const session = startMcpLiveSession({
        studentName: typeof args.student_name === 'string' ? args.student_name : undefined,
        mode: typeof args.mode === 'string' ? args.mode : undefined,
        agentName: typeof args.agent_name === 'string' ? args.agent_name : undefined,
        thinkingSummary: typeof args.thinking_summary === 'string' ? args.thinking_summary : undefined,
      });
      return formatTextContent({
        session_id: session.sessionId,
        student_name: session.studentName,
        mode: session.mode,
        agent_name: session.agentName,
        status: 'live_studio_opened',
      });
    }

    case 'register_question_evaluation': {
      const sessionId = typeof args.session_id === 'string' ? args.session_id : undefined;
      const out = registerMcpQuestion(sessionId, args);
      return formatTextContent({
        ok: true,
        session_id: out.sessionId,
        registered_question_id: out.question.question_id,
        score: out.question.score,
        full_marks: out.question.full_marks,
        registered_count: out.registeredCount,
        running_total_score: out.runningScore,
        running_max_marks: out.runningMax,
      });
    }

    case 'apply_speed_fixer_repair': {
      const out = applyMcpSpeedFixerRepair(
        typeof args.session_id === 'string' ? args.session_id : undefined,
        {
          question_id: String(args.question_id || '1'),
          issue_type: String(args.issue_type || 'auto_repair'),
          description: String(args.description || 'Applied automatic repair'),
        }
      );
      return formatTextContent({ ok: true, session_id: out.sessionId, event: out.toolEvent });
    }

    case 'finalize_exam_evaluation': {
      const sessionId = typeof args.session_id === 'string' ? args.session_id : undefined;
      const { record, result } = finalizeMcpSession(sessionId, args);
      return formatTextContent({
        ok: true,
        saved_to_history: true,
        report_id: record.id,
        label: record.label,
        total_score: result.total_score,
        max_marks: result.max_marks,
        percentage: record.avgPercentage,
        letter_grade: result.letter_grade,
        pass_status: result.pass_status,
        questions_count: result.questions.length,
      });
    }

    case 'save_studio_evaluation': {
      const questions = Array.isArray(args.questions)
        ? (args.questions as Array<Record<string, unknown>>)
        : [];
      const { record, result } = saveDirectStudioEvaluation({
        studentName: typeof args.student_name === 'string' ? args.student_name : undefined,
        modeLabel: typeof args.mode_label === 'string' ? args.mode_label : undefined,
        agentName: typeof args.agent_name === 'string' ? args.agent_name : undefined,
        total_score: args.total_score !== undefined ? Number(args.total_score) : undefined,
        max_marks: args.max_marks !== undefined ? Number(args.max_marks) : undefined,
        pass_status: typeof args.pass_status === 'string' ? args.pass_status : undefined,
        letter_grade: typeof args.letter_grade === 'string' ? args.letter_grade : undefined,
        special_award: typeof args.special_award === 'string' ? args.special_award : undefined,
        teacher_overall_comments:
          typeof args.teacher_overall_comments === 'string' ? args.teacher_overall_comments : undefined,
        speed_fixer_summary:
          typeof args.speed_fixer_summary === 'string' ? args.speed_fixer_summary : undefined,
        questions,
      });
      return formatTextContent({
        ok: true,
        saved_to_history: true,
        report_id: record.id,
        label: record.label,
        total_score: result.total_score,
        max_marks: result.max_marks,
        percentage: record.avgPercentage,
        letter_grade: result.letter_grade,
        pass_status: result.pass_status,
        questions_count: result.questions.length,
      });
    }

    case 'list_evaluation_history': {
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 50));
      const history = getEvaluationHistory().slice(-limit).reverse();
      return formatTextContent({
        total_count: getEvaluationHistory().length,
        evaluations: history.map((r) => ({
          report_id: r.id,
          label: r.label,
          timestamp: r.timestamp,
          createdAt: r.createdAt,
          modeLabel: r.modeLabel,
          source: r.source,
          agentName: r.agentName,
          totalScore: r.totalScore,
          maxMarks: r.maxMarks,
          avgPercentage: r.avgPercentage,
          questionsCount: r.questionsCount,
          letter_grade: r.singleResult?.letter_grade,
          pass_status: r.singleResult?.pass_status,
          documentNames: r.documentNames,
        })),
      });
    }

    case 'get_evaluation_report': {
      const reportId = String(args.report_id || '');
      const record = getEvaluationRecordById(reportId);
      if (!record) {
        return {
          content: [{ type: 'text', text: `Evaluation report "${reportId}" not found.` }],
          isError: true,
        };
      }
      return formatTextContent(record);
    }

    case 'delete_evaluation_report': {
      const reportId = String(args.report_id || '');
      const deleted = deleteEvaluationRecord(reportId);
      return formatTextContent({ ok: deleted, report_id: reportId });
    }

    default:
      throw Object.assign(new Error(`Unknown MCP tool: ${name}`), { code: -32601 });
  }
}

function processJsonRpcRequest(reqMsg: JsonRpcRequest): Record<string, unknown> | null {
  const id = reqMsg.id ?? null;
  const method = reqMsg.method;
  const params = (reqMsg.params || {}) as Record<string, unknown>;

  if (!method) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid JSON-RPC request: missing method.' },
    };
  }

  // Notifications have no id and expect no JSON-RPC response payload
  if (method.startsWith('notifications/') || (reqMsg.id === undefined && method === 'initialized')) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize': {
        const clientVersion =
          typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26';
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion)
          ? clientVersion
          : SUPPORTED_PROTOCOL_VERSIONS[0];

        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: {
              tools: { listChanged: true },
              resources: { listChanged: true },
              prompts: {},
            },
            serverInfo: {
              name: 'graderlabs-studio-mcp',
              version: '1.0.0',
            },
            instructions:
              'Connected to GraderLabs Exam Evaluation Studio. Perform OCR, reasoning, and grading using YOUR OWN AI/vision (no host env LLM calls). 1) Call get_studio_workspace to read mounted documents and text layers. 2) Call get_document_page_image for pages requiring visual handwriting/OMR inspection. 3) Call start_live_evaluation_session, register_question_evaluation per question, and finalize_exam_evaluation (or save_studio_evaluation) to stream live into Student Report Studio and build persistent Studio Evaluation History. Use list_evaluation_history and get_evaluation_report to inspect past evaluations.',
          },
        };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };

      case 'tools/call': {
        const toolName = String(params.name || '');
        const toolArgs =
          params.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {};
        try {
          const result = handleToolCall(toolName, toolArgs);
          return { jsonrpc: '2.0', id, result };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Tool execution error';
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: message }],
              isError: true,
            },
          };
        }
      }

      case 'resources/list': {
        const history = getEvaluationHistory();
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri: 'graderlabs://workspace/current',
                name: 'Current Mounted Studio Workspace',
                description:
                  'Metadata and extracted text layers for Question Paper, Answer Key, and Student Sheet(s) currently mounted in GraderLabs Studio.',
                mimeType: 'application/json',
              },
              {
                uri: 'graderlabs://history',
                name: 'Studio Evaluation History',
                description: `All ${history.length} saved Student Report Studio evaluations.`,
                mimeType: 'application/json',
              },
              ...history.slice(-20).map((r) => ({
                uri: `graderlabs://history/${r.id}`,
                name: `${r.label} (${r.totalScore}/${r.maxMarks} · ${r.avgPercentage}%)`,
                description: `${r.modeLabel} · ${r.questionsCount} questions · ${r.timestamp}`,
                mimeType: 'application/json',
              })),
            ],
          },
        };
      }

      case 'resources/read': {
        const uri = String(params.uri || '');
        if (uri === 'graderlabs://workspace/current') {
          const ws = getWorkspaceState();
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(
                    {
                      ...ws,
                      questionPaper: ws.questionPaper
                        ? { ...ws.questionPaper, pages: `[${ws.questionPaper.pages.length} JPEG page(s)]` }
                        : null,
                      answerKey: ws.answerKey
                        ? { ...ws.answerKey, pages: `[${ws.answerKey.pages.length} JPEG page(s)]` }
                        : null,
                      studentSheets: ws.studentSheets.map((s) => ({
                        ...s,
                        pages: `[${s.pages.length} JPEG page(s)]`,
                      })),
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }
        if (uri === 'graderlabs://history') {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(getEvaluationHistory(), null, 2),
                },
              ],
            },
          };
        }
        if (uri.startsWith('graderlabs://history/')) {
          const idPart = uri.slice('graderlabs://history/'.length);
          const rec = getEvaluationRecordById(idPart);
          if (!rec) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32002, message: `Resource not found: ${uri}` },
            };
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(rec, null, 2),
                },
              ],
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32002, message: `Unknown resource URI: ${uri}` },
        };
      }

      case 'prompts/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            prompts: [
              {
                name: 'evaluate_exam_live',
                description:
                  'Guides the connected AI to inspect mounted GraderLabs exam documents, grade every question with its own reasoning, stream updates into Student Report Studio, and save into History.',
                arguments: [
                  {
                    name: 'agent_name',
                    description: 'Name of the connected AI assistant (e.g., Claude, ChatGPT).',
                    required: false,
                  },
                ],
              },
            ],
          },
        };

      case 'prompts/get': {
        const promptName = String(params.name || '');
        if (promptName !== 'evaluate_exam_live') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown prompt: ${promptName}` },
          };
        }
        const promptArgs = (params.arguments || {}) as Record<string, unknown>;
        const agentName = typeof promptArgs.agent_name === 'string' ? promptArgs.agent_name : 'Connected AI';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Live GraderLabs Studio exam evaluation workflow.',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Evaluate the exam currently mounted in GraderLabs Studio using your own vision & reasoning (agent_name: "${agentName}"). Step 1: Call get_studio_workspace and call get_document_page_image for each page you need to inspect. Step 2: Call start_live_evaluation_session. Step 3: Call register_question_evaluation for every question in order with accurate marks, transcription, feedback, and 0-1000 bounding boxes. Step 4: Call finalize_exam_evaluation to save the complete report to Studio Evaluation History.`,
                },
              },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal MCP server error';
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    };
  }
}

function setMcpCorsHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

function resolvePublicOrigin(req: Request): string {
  const host =
    (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
    req.get('host') ||
    'localhost:3000';
  const rawProto =
    (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol;
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const proto = !isLocal && rawProto === 'http' ? 'https' : rawProto;
  return `${proto}://${host}`;
}

const STATIC_PUBLIC_CLIENT_ID = 'graderlabs-mcp-client';

interface RegisteredOAuthClient {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  scope: string;
  createdAt: number;
}

interface PendingAuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge?: string;
  code_challenge_method?: string;
  expiresAt: number;
}

interface IssuedOAuthToken {
  access_token: string;
  refresh_token: string;
  client_id: string;
  scope: string;
  expiresAt: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') return true;
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
    ) {
      return true;
    }
    if (parsed.protocol === 'cursor:' || parsed.protocol === 'vscode:' || parsed.protocol === 'claude:') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method = 'S256'
): boolean {
  if (!codeVerifier) return false;
  if (method.toUpperCase() === 'PLAIN') {
    return codeVerifier === codeChallenge;
  }
  const hash = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return hash === codeChallenge;
}

export function mountMcpRoutes(app: Express): void {
  const mcpSessions = new Set<string>();
  const legacySseSessions = new Map<string, { res: Response; timer: ReturnType<typeof setInterval> }>();

  const oauthClients = new Map<string, RegisteredOAuthClient>([
    [
      STATIC_PUBLIC_CLIENT_ID,
      {
        client_id: STATIC_PUBLIC_CLIENT_ID,
        client_name: 'GraderLabs Public MCP Connector (PKCE)',
        redirect_uris: [
          'https://claude.ai/api/mcp/auth_callback',
          'https://claude.com/api/mcp/auth_callback',
          'https://chatgpt.com/connector_platform_oauth_redirect',
          'https://chat.openai.com/connector_platform_oauth_redirect',
        ],
        token_endpoint_auth_method: 'none',
        scope: 'mcp:tools mcp:resources',
        createdAt: Date.now(),
      },
    ],
  ]);
  const authCodes = new Map<string, PendingAuthCode>();
  const issuedTokens = new Map<string, IssuedOAuthToken>();
  const refreshTokens = new Map<string, IssuedOAuthToken>();

  app.options(
    [
      '/mcp',
      '/sse',
      '/messages',
      '/api/mcp/info',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource/sse',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
      '/register',
      '/oauth/register',
      '/authorize',
      '/oauth/authorize',
      '/token',
      '/oauth/token',
    ],
    (_req: Request, res: Response) => {
      setMcpCorsHeaders(res);
      res.status(204).end();
    }
  );

  // --- RFC 9728 OAuth Protected Resource Metadata ---
  app.get(
    [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource/sse',
    ],
    (req: Request, res: Response) => {
      setMcpCorsHeaders(res);
      const origin = resolvePublicOrigin(req);
      const resourcePath = req.path.endsWith('/sse') ? '/sse' : '/mcp';
      res.json({
        resource: `${origin}${resourcePath}`,
        authorization_servers: [origin],
        scopes_supported: ['mcp:tools', 'mcp:resources'],
        bearer_methods_supported: ['header'],
        resource_name: 'GraderLabs Studio MCP',
        resource_documentation: `${origin}/api/mcp/info`,
      });
    }
  );

  // --- RFC 8414 / OIDC OAuth Authorization Server Metadata ---
  app.get(
    [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
    ],
    (req: Request, res: Response) => {
      setMcpCorsHeaders(res);
      const origin = resolvePublicOrigin(req);
      res.json({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/register`,
        scopes_supported: ['mcp:tools', 'mcp:resources'],
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256', 'plain'],
        service_documentation: `${origin}/api/mcp/info`,
      });
    }
  );

  // --- RFC 7591 Dynamic Client Registration (DCR) ---
  app.post(['/register', '/oauth/register'], (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const body = (req.body || {}) as Record<string, unknown>;
    const rawRedirects = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && isAllowedRedirectUri(u))
      : [];

    const redirectUris =
      rawRedirects.length > 0
        ? rawRedirects
        : [
            'https://claude.ai/api/mcp/auth_callback',
            'https://chatgpt.com/connector_platform_oauth_redirect',
          ];

    const authMethod =
      typeof body.token_endpoint_auth_method === 'string' && body.token_endpoint_auth_method.trim()
        ? body.token_endpoint_auth_method.trim()
        : 'none';
    const clientName =
      typeof body.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim()
        : 'External MCP AI Client';
    const scope =
      typeof body.scope === 'string' && body.scope.trim()
        ? body.scope.trim()
        : 'mcp:tools mcp:resources';

    const clientId = `graderlabs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const issuedSecret =
      authMethod === 'none' ? undefined : `glsec_${crypto.randomBytes(24).toString('hex')}`;

    const client: RegisteredOAuthClient = {
      client_id: clientId,
      client_secret: issuedSecret,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      scope,
      createdAt: Date.now(),
    };
    oauthClients.set(clientId, client);

    res.status(201).json({
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      scope: client.scope,
    });
  });

  // --- OAuth 2.1 + PKCE Authorization Consent Screen ---
  app.get(['/oauth/authorize', '/authorize'], (req: Request, res: Response) => {
    const clientId = String(req.query.client_id || STATIC_PUBLIC_CLIENT_ID);
    const redirectUri = String(req.query.redirect_uri || '');
    const state = String(req.query.state || '');
    const scope = String(req.query.scope || 'mcp:tools mcp:resources');
    const codeChallenge = String(req.query.code_challenge || '');
    const codeChallengeMethod = String(req.query.code_challenge_method || 'S256');
    const responseType = String(req.query.response_type || 'code');

    if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'A valid https:// or localhost redirect_uri is required.',
      });
      return;
    }
    if (responseType !== 'code') {
      const errUrl = new URL(redirectUri);
      errUrl.searchParams.set('error', 'unsupported_response_type');
      if (state) errUrl.searchParams.set('state', state);
      res.redirect(302, errUrl.toString());
      return;
    }

    const client = oauthClients.get(clientId);
    const displayName = client?.client_name || clientId;
    const actionUrl = req.path.startsWith('/oauth/') ? '/oauth/authorize' : '/authorize';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorize MCP Connection — GraderLabs Studio</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #070510; color: #f5f3ff; font-family: system-ui, -apple-system, sans-serif; padding: 24px; }
    .card { max-width: 440px; width: 100%; background: #110926; border: 1px solid rgba(168,85,247,0.35); border-radius: 20px; padding: 28px; box-shadow: 0 24px 60px rgba(0,0,0,0.65); }
    .badge { display: inline-block; font-size: 11px; font-family: monospace; color: #6ee7b7; background: rgba(16,185,129,0.14); border: 1px solid rgba(52,211,153,0.35); padding: 4px 10px; border-radius: 999px; margin-bottom: 14px; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 16px; font-size: 13px; color: #c4b5fd; line-height: 1.5; }
    .box { background: #080412; border: 1px solid rgba(168,85,247,0.22); border-radius: 12px; padding: 12px 14px; font-size: 12px; margin-bottom: 18px; }
    .box div { margin: 4px 0; word-break: break-all; }
    .label { color: #a78bfa; font-family: monospace; }
    .actions { display: flex; gap: 10px; }
    button { flex: 1; padding: 11px 16px; border-radius: 12px; font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
    .approve { background: linear-gradient(90deg, #7c3aed, #a855f7); color: #fff; }
    .deny { background: #1c103b; color: #ddd6fe; border: 1px solid rgba(168,85,247,0.3); }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">GRADERLABS MCP OAUTH 2.1</div>
    <h1>Connect External AI to Studio</h1>
    <p><strong>${escapeHtml(displayName)}</strong> wants permission to inspect mounted exam documents, stream evaluations into Student Report Studio, and access Studio Evaluation History using its own AI vision &amp; reasoning.</p>
    <div class="box">
      <div><span class="label">Client ID:</span> ${escapeHtml(clientId)}</div>
      <div><span class="label">Scopes:</span> ${escapeHtml(scope)}</div>
      <div><span class="label">Redirect:</span> ${escapeHtml(new URL(redirectUri).origin)}</div>
    </div>
    <form method="POST" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}" />
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="deny">Cancel</button>
        <button type="submit" name="decision" value="approve" class="approve">Authorize Connection</button>
      </div>
    </form>
  </div>
</body>
</html>`);
  });

  app.post(['/oauth/authorize', '/authorize'], (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const redirectUri = String(body.redirect_uri || '');
    const state = String(body.state || '');
    const clientId = String(body.client_id || STATIC_PUBLIC_CLIENT_ID);
    const scope = String(body.scope || 'mcp:tools mcp:resources');
    const codeChallenge = typeof body.code_challenge === 'string' && body.code_challenge ? body.code_challenge : undefined;
    const codeChallengeMethod =
      typeof body.code_challenge_method === 'string' && body.code_challenge_method
        ? body.code_challenge_method
        : 'S256';
    const decision = String(body.decision || 'approve');

    if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Invalid redirect_uri.' });
      return;
    }

    const target = new URL(redirectUri);
    if (decision === 'deny') {
      target.searchParams.set('error', 'access_denied');
      if (state) target.searchParams.set('state', state);
      res.redirect(302, target.toString());
      return;
    }

    const code = `gl_code_${crypto.randomBytes(24).toString('hex')}`;
    authCodes.set(code, {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    res.redirect(302, target.toString());
  });

  // --- OAuth 2.1 Token Exchange Endpoint ---
  app.post(['/oauth/token', '/token'], (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const body = (req.body || {}) as Record<string, unknown>;
    const grantType = String(body.grant_type || 'authorization_code');

    let clientId = typeof body.client_id === 'string' ? body.client_id : '';
    let clientSecret = typeof body.client_secret === 'string' ? body.client_secret : '';
    const authHeader = req.header('authorization') || '';
    if (authHeader.toLowerCase().startsWith('basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf-8');
        const colonIdx = decoded.indexOf(':');
        if (colonIdx > -1) {
          clientId = clientId || decodeURIComponent(decoded.slice(0, colonIdx));
          clientSecret = clientSecret || decodeURIComponent(decoded.slice(colonIdx + 1));
        }
      } catch {
        // Ignore malformed basic auth header
      }
    }

    if (grantType === 'authorization_code') {
      const code = String(body.code || '');
      const redirectUri = String(body.redirect_uri || '');
      const codeVerifier = String(body.code_verifier || '');
      const pending = authCodes.get(code);
      if (!pending || pending.expiresAt < Date.now()) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' });
        return;
      }
      authCodes.delete(code);

      if (redirectUri && pending.redirect_uri !== redirectUri) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' });
        return;
      }

      const registered = oauthClients.get(pending.client_id);
      if (registered?.client_secret && clientSecret && registered.client_secret !== clientSecret) {
        res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client_secret.' });
        return;
      }

      if (pending.code_challenge) {
        if (!verifyPkceChallenge(codeVerifier, pending.code_challenge, pending.code_challenge_method)) {
          res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier verification failed.' });
          return;
        }
      }

      const tokenPair: IssuedOAuthToken = {
        access_token: `gl_mcp_${crypto.randomBytes(24).toString('hex')}`,
        refresh_token: `gl_ref_${crypto.randomBytes(24).toString('hex')}`,
        client_id: clientId || pending.client_id,
        scope: pending.scope,
        expiresAt: Date.now() + 86400 * 1000,
      };
      issuedTokens.set(tokenPair.access_token, tokenPair);
      refreshTokens.set(tokenPair.refresh_token, tokenPair);

      res.json({
        access_token: tokenPair.access_token,
        token_type: 'Bearer',
        expires_in: 86400,
        refresh_token: tokenPair.refresh_token,
        scope: tokenPair.scope,
      });
      return;
    }

    if (grantType === 'refresh_token') {
      const oldRefresh = String(body.refresh_token || '');
      const prev = refreshTokens.get(oldRefresh);
      if (!prev) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh_token.' });
        return;
      }
      refreshTokens.delete(oldRefresh);
      issuedTokens.delete(prev.access_token);

      const nextPair: IssuedOAuthToken = {
        access_token: `gl_mcp_${crypto.randomBytes(24).toString('hex')}`,
        refresh_token: `gl_ref_${crypto.randomBytes(24).toString('hex')}`,
        client_id: prev.client_id,
        scope: prev.scope,
        expiresAt: Date.now() + 86400 * 1000,
      };
      issuedTokens.set(nextPair.access_token, nextPair);
      refreshTokens.set(nextPair.refresh_token, nextPair);

      res.json({
        access_token: nextPair.access_token,
        token_type: 'Bearer',
        expires_in: 86400,
        refresh_token: nextPair.refresh_token,
        scope: nextPair.scope,
      });
      return;
    }

    if (grantType === 'client_credentials') {
      const tokenPair: IssuedOAuthToken = {
        access_token: `gl_mcp_${crypto.randomBytes(24).toString('hex')}`,
        refresh_token: `gl_ref_${crypto.randomBytes(24).toString('hex')}`,
        client_id: clientId || STATIC_PUBLIC_CLIENT_ID,
        scope: 'mcp:tools mcp:resources',
        expiresAt: Date.now() + 86400 * 1000,
      };
      issuedTokens.set(tokenPair.access_token, tokenPair);
      res.json({
        access_token: tokenPair.access_token,
        token_type: 'Bearer',
        expires_in: 86400,
        scope: tokenPair.scope,
      });
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  app.get('/api/mcp/info', (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const origin = resolvePublicOrigin(req);
    res.json({
      name: 'graderlabs-studio-mcp',
      version: '1.0.0',
      streamableHttpUrl: `${origin}/mcp`,
      sseUrl: `${origin}/sse`,
      oauth: {
        supported: true,
        dynamicClientRegistration: true,
        staticPublicClientId: STATIC_PUBLIC_CLIENT_ID,
        authorizationEndpoint: `${origin}/oauth/authorize`,
        tokenEndpoint: `${origin}/oauth/token`,
        registrationEndpoint: `${origin}/register`,
      },
      tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      historyCount: getEvaluationHistory().length,
      workspaceUpdatedAt: getWorkspaceState().updatedAt,
    });
  });

  // --- Streamable HTTP MCP Endpoint (/mcp) ---
  app.get('/mcp', (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const accept = (req.headers.accept || '').toLowerCase();
    if (accept.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      res.write(': mcp-stream-open\n\n');
      const timer = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n');
      }, 15000);
      req.on('close', () => clearInterval(timer));
      return;
    }

    const origin = resolvePublicOrigin(req);
    res.json({
      server: 'graderlabs-studio-mcp',
      version: '1.0.0',
      transport: 'streamable-http',
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      endpoint: `${origin}/mcp`,
      legacySseEndpoint: `${origin}/sse`,
      oauth: {
        registrationEndpoint: `${origin}/register`,
        authorizationEndpoint: `${origin}/oauth/authorize`,
        tokenEndpoint: `${origin}/oauth/token`,
        staticPublicClientId: STATIC_PUBLIC_CLIENT_ID,
      },
      tools: MCP_TOOLS.map((t) => t.name),
      historyCount: getEvaluationHistory().length,
    });
  });

  app.post('/mcp', (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    let sessionId = req.header('mcp-session-id') || '';
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      mcpSessions.add(sessionId);
    } else {
      mcpSessions.add(sessionId);
    }
    res.setHeader('Mcp-Session-Id', sessionId);

    const payload = req.body;
    if (Array.isArray(payload)) {
      const responses = payload
        .map((item) => processJsonRpcRequest(item as JsonRpcRequest))
        .filter((r): r is Record<string, unknown> => r !== null);
      if (responses.length === 0) {
        res.status(202).end();
        return;
      }
      res.json(responses);
      return;
    }

    if (!payload || typeof payload !== 'object') {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: expected JSON-RPC object.' },
      });
      return;
    }

    const rpcResponse = processJsonRpcRequest(payload as JsonRpcRequest);
    if (!rpcResponse) {
      res.status(202).end();
      return;
    }
    res.json(rpcResponse);
  });

  app.delete('/mcp', (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const sessionId = req.header('mcp-session-id');
    if (sessionId) mcpSessions.delete(sessionId);
    res.status(204).end();
  });

  // --- Legacy HTTP+SSE MCP Transport (/sse + /messages) ---
  app.get('/sse', (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const sessionId = crypto.randomUUID();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const messageEndpoint = `/messages?sessionId=${encodeURIComponent(sessionId)}`;
    res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);

    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15000);

    legacySseSessions.set(sessionId, { res, timer });

    req.on('close', () => {
      clearInterval(timer);
      legacySseSessions.delete(sessionId);
    });
  });

  app.post('/messages', (req: Request, res: Response) => {
    setMcpCorsHeaders(res);
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const sseSession = sessionId ? legacySseSessions.get(sessionId) : undefined;

    const payload = req.body;
    const rpcResponse =
      payload && typeof payload === 'object'
        ? processJsonRpcRequest(payload as JsonRpcRequest)
        : {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: expected JSON-RPC object.' },
          };

    if (!rpcResponse) {
      res.status(202).end();
      return;
    }

    if (sseSession && !sseSession.res.writableEnded) {
      sseSession.res.write(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`);
      res.status(202).send('Accepted');
      return;
    }

    res.json(rpcResponse);
  });
}
