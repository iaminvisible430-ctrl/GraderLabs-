import React, { useState, useEffect } from 'react';
import { playSound } from '../utils/sound';

interface McpInfoPayload {
  name: string;
  version: string;
  streamableHttpUrl: string;
  sseUrl: string;
  tools: Array<{ name: string; description: string }>;
  historyCount: number;
  workspaceUpdatedAt: string | null;
}

interface McpConnectModalProps {
  onClose: () => void;
  mountedSummary: {
    questionPaper: string | null;
    answerKey: string | null;
    studentSheet: string | null;
  };
  historyCount: number;
}

export const McpConnectModal: React.FC<McpConnectModalProps> = ({
  onClose,
  mountedSummary,
  historyCount,
}) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [info, setInfo] = useState<McpInfoPayload | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/mcp/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) setInfo(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const mcpUrl = origin ? `${origin}/mcp` : info?.streamableHttpUrl || '/mcp';
  const sseUrl = origin ? `${origin}/sse` : info?.sseUrl || '/sse';
  const isPrivateDevPreview = mcpUrl.includes('://ais-dev-');
  const publicSharedMcpUrl = isPrivateDevPreview
    ? mcpUrl.replace('://ais-dev-', '://ais-pre-')
    : mcpUrl;
  const staticClientId = 'graderlabs-mcp-client';

  const clientJsonSnippet = JSON.stringify(
    {
      mcpServers: {
        graderlabs: {
          url: mcpUrl,
          transport: 'streamable-http',
        },
      },
    },
    null,
    2
  );

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      playSound('success');
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#040209]/85 backdrop-blur-xl animate-fade-in">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar liquid-glass border-glow rounded-3xl p-5 sm:p-7 bg-[#0d071d]/95 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-purple-500/20">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-[10px] font-mono text-emerald-300 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>MCP + OAUTH 2.1 DCR ACTIVE · EXTERNAL AI MODE</span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white glow-text">
              Connect External AI via Model Context Protocol (MCP)
            </h3>
            <p className="text-xs text-purple-200/75 mt-1 leading-relaxed">
              Connect Claude, ChatGPT, Cursor, or any MCP client. The connected AI uses its{' '}
              <span className="text-white font-semibold">own intelligence &amp; vision</span> to read mounted
              Studio pages, grade live into Student Report Studio, and build persistent Studio Evaluation History
              without using this app&apos;s server LLM keys.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              playSound('click');
              onClose();
            }}
            className="px-3 py-1.5 rounded-xl bg-purple-950/70 border border-purple-500/30 text-xs text-purple-200 hover:text-white shrink-0"
          >
            Close
          </button>
        </div>

        {/* Cloud Run Private Preview Warning */}
        {isPrivateDevPreview && (
          <div className="mt-4 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-400/40 text-xs space-y-2">
            <p className="font-semibold text-amber-200">
              Connecting from Cloud AI (Claude.ai / ChatGPT)? Use the Shared App URL below:
            </p>
            <p className="text-amber-100/80 leading-relaxed">
              The <code className="text-amber-200">ais-dev-*</code> URL requires your Google login cookies, so
              external cloud servers cannot reach it. Publish/Share this app in AI Studio and paste the{' '}
              <code className="text-emerald-300">ais-pre-*</code> URL into Claude&apos;s Custom Connector:
            </p>
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#070312] border border-amber-400/25">
              <code className="text-[11px] font-mono text-emerald-300 break-all select-all">
                {publicSharedMcpUrl}
              </code>
              <button
                type="button"
                onClick={() => copyValue('shared_mcp', publicSharedMcpUrl)}
                className="px-2.5 py-1 rounded-lg bg-emerald-600/30 border border-emerald-400/40 text-[11px] font-mono text-emerald-100 hover:bg-emerald-600/50 transition shrink-0"
              >
                {copiedField === 'shared_mcp' ? 'Copied!' : 'Copy Shared URL'}
              </button>
            </div>
          </div>
        )}

        {/* Endpoint URLs */}
        <div className="mt-4 space-y-3">
          <div className="p-3.5 rounded-2xl bg-[#070312] border border-purple-500/25">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-mono font-semibold text-purple-300 uppercase">
                Streamable HTTP MCP URL (Recommended)
              </span>
              <button
                type="button"
                onClick={() => copyValue('mcp', mcpUrl)}
                className="px-2.5 py-1 rounded-lg bg-purple-600/30 border border-purple-400/40 text-[11px] font-mono text-purple-100 hover:bg-purple-600/50 transition"
              >
                {copiedField === 'mcp' ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
            <code className="block text-xs font-mono text-emerald-300 break-all select-all">{mcpUrl}</code>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#070312] border border-purple-500/25">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-mono font-semibold text-purple-300 uppercase">
                Legacy HTTP + SSE Endpoint URL
              </span>
              <button
                type="button"
                onClick={() => copyValue('sse', sseUrl)}
                className="px-2.5 py-1 rounded-lg bg-purple-600/30 border border-purple-400/40 text-[11px] font-mono text-purple-100 hover:bg-purple-600/50 transition"
              >
                {copiedField === 'sse' ? 'Copied!' : 'Copy SSE URL'}
              </button>
            </div>
            <code className="block text-xs font-mono text-fuchsia-300 break-all select-all">{sseUrl}</code>
          </div>

          {/* Claude / ChatGPT OAuth 2.1 + DCR Info */}
          <div className="p-3.5 rounded-2xl bg-[#070312] border border-purple-500/25 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-semibold text-purple-300 uppercase">
                Claude / ChatGPT Custom Connector Settings (OAuth 2.1 + DCR)
              </span>
              <button
                type="button"
                onClick={() => copyValue('client_id', staticClientId)}
                className="px-2.5 py-1 rounded-lg bg-purple-600/30 border border-purple-400/40 text-[11px] font-mono text-purple-100 hover:bg-purple-600/50 transition"
              >
                {copiedField === 'client_id' ? 'Copied ID!' : 'Copy Client ID'}
              </button>
            </div>
            <div className="text-[11px] text-purple-100/85 space-y-1 leading-relaxed">
              <div>
                <span className="text-purple-400 font-mono">Auth Method:</span> OAuth 2.1 + Dynamic Client
                Registration (<code className="text-emerald-300">/register</code>)
              </div>
              <div>
                <span className="text-purple-400 font-mono">OAuth Client ID:</span> Leave{' '}
                <strong className="text-white">blank</strong> (auto-DCR recommended) or enter{' '}
                <code className="text-emerald-300 select-all">{staticClientId}</code>
              </div>
              <div>
                <span className="text-purple-400 font-mono">OAuth Client Secret:</span> Leave{' '}
                <strong className="text-white">blank</strong> (public PKCE client)
              </div>
            </div>
          </div>
        </div>

        {/* Client Config Snippet */}
        <div className="mt-4 p-3.5 rounded-2xl bg-[#070312] border border-purple-500/25">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-mono font-semibold text-purple-300 uppercase">
              MCP Client Configuration (JSON)
            </span>
            <button
              type="button"
              onClick={() => copyValue('json', clientJsonSnippet)}
              className="px-2.5 py-1 rounded-lg bg-purple-600/30 border border-purple-400/40 text-[11px] font-mono text-purple-100 hover:bg-purple-600/50 transition"
            >
              {copiedField === 'json' ? 'Copied JSON!' : 'Copy Config'}
            </button>
          </div>
          <pre className="text-[11px] font-mono text-purple-100/90 overflow-x-auto leading-relaxed">
            {clientJsonSnippet}
          </pre>
        </div>

        {/* Synced Workspace & History Snapshot */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-2xl bg-[#110826]/80 border border-purple-500/20">
            <p className="text-[10px] font-mono text-purple-300/70 uppercase mb-1.5">
              Synced Studio Documents
            </p>
            <ul className="text-xs space-y-1 text-purple-100/90">
              <li className="truncate">
                <span className="text-purple-400 font-mono">QP:</span>{' '}
                {mountedSummary.questionPaper || 'None mounted'}
              </li>
              <li className="truncate">
                <span className="text-purple-400 font-mono">AK:</span>{' '}
                {mountedSummary.answerKey || 'None mounted'}
              </li>
              <li className="truncate">
                <span className="text-purple-400 font-mono">SS:</span>{' '}
                {mountedSummary.studentSheet || 'None mounted'}
              </li>
            </ul>
          </div>
          <div className="p-3.5 rounded-2xl bg-[#110826]/80 border border-purple-500/20 flex flex-col justify-between">
            <div>
              <p className="text-[10px] font-mono text-purple-300/70 uppercase mb-1">
                Studio Evaluation History Access
              </p>
              <p className="text-2xl font-extrabold font-mono text-white">
                {info?.historyCount ?? historyCount}{' '}
                <span className="text-xs font-normal text-purple-300/70">Saved Report(s)</span>
              </p>
            </div>
            <p className="text-[11px] text-purple-300/65 mt-1">
              Accessible via <code className="text-purple-200">list_evaluation_history</code> &amp;{' '}
              <code className="text-purple-200">graderlabs://history</code>
            </p>
          </div>
        </div>

        {/* Available Tools */}
        {info?.tools && info.tools.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-mono font-semibold text-purple-300 uppercase mb-2">
              Exposed MCP Tools ({info.tools.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {info.tools.map((t) => (
                <div
                  key={t.name}
                  className="p-2.5 rounded-xl bg-[#090418] border border-purple-500/20"
                >
                  <p className="text-xs font-mono font-semibold text-emerald-300">{t.name}</p>
                  <p className="text-[11px] text-purple-200/65 line-clamp-2 mt-0.5">
                    {t.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
