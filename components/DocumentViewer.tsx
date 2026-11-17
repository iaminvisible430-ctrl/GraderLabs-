import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Annotation } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, EyeIcon, XCircleIcon } from './Icons';
import { loadPdfDocument } from '../utils/pdfUtils';
import {
  resolveEffectiveMimeType,
  isImageMime,
  readDocumentAsText,
} from '../utils/fileUtils';

export interface ViewerAnnotationItem {
  id: string | number;
  box: Annotation;
  score: number;
  full_marks: number;
  question_text?: string;
  student_answer?: string;
  feedback?: string;
  confidence?: number;
  fixer_note?: string;
}

interface DocumentViewerProps {
  file: File | null;
  previewUrl: string | null;
  mimeType?: string;
  annotations?: ViewerAnnotationItem[];
  activeQuestionId: number | string | null;
  recentQuestionId?: number | string | null;
  isLiveEvaluating?: boolean;
  onQuestionClick?: (id: number | string | null) => void;
  showAnnotations: boolean;
  targetPage?: number;
  emptyMessage?: string;
  scrollMode?: boolean;
  header?: React.ReactNode;
}

type OverlayDisplayMode = 'clean' | 'scores' | 'off';

interface NormalizedBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  page_number: number;
}

interface PlacedAnnotation {
  item: ViewerAnnotationItem;
  box: NormalizedBox;
  badgeX: number;
  badgeY: number;
  badgeW: number;
  badgeH: number;
  needsLeader: boolean;
  anchorX: number;
  anchorY: number;
}

function formatQLabel(id: number | string): string {
  const raw = String(id).trim();
  if (!raw) return 'Q?';
  return /^q\s*/i.test(raw) ? `Q${raw.replace(/^q\s*/i, '')}` : `Q${raw}`;
}

function normalizeBox(box: Annotation): NormalizedBox | null {
  let ymin = Number(box.ymin);
  let xmin = Number(box.xmin);
  let ymax = Number(box.ymax);
  let xmax = Number(box.xmax);

  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  if (ymin === 0 && xmin === 0 && ymax === 0 && xmax === 0) return null;

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

  const pageNum =
    Number.isFinite(Number(box.page_number)) && Number(box.page_number) >= 1
      ? Math.round(Number(box.page_number))
      : 1;

  return { xmin, ymin, xmax, ymax, page_number: pageNum };
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad = 3
): boolean {
  return ax < bx + bw + pad && ax + aw + pad > bx && ay < by + bh + pad && ay + ah + pad > by;
}

function computeCollisionFreePlacements(
  pageAnns: { item: ViewerAnnotationItem; box: NormalizedBox }[],
  pageWidthPx: number,
  pageHeightPx: number,
  displayMode: OverlayDisplayMode
): PlacedAnnotation[] {
  const safeW = Math.max(240, pageWidthPx);
  const safeH = Math.max(240, pageHeightPx);

  const sorted = [...pageAnns].sort((a, b) => {
    if (Math.abs(a.box.ymin - b.box.ymin) > 12) return a.box.ymin - b.box.ymin;
    return a.box.xmin - b.box.xmin;
  });

  const placedBadges: { x: number; y: number; w: number; h: number }[] = [];
  const results: PlacedAnnotation[] = [];
  const EDGE_MARGIN = 4;
  const GAP_X = (5 / safeW) * 1000;
  const GAP_Y = (4 / safeH) * 1000;

  for (const ann of sorted) {
    const qLabel = formatQLabel(ann.item.id);
    const label =
      displayMode === 'scores' ? `${qLabel} • ${ann.item.score}/${ann.item.full_marks}` : qLabel;

    const badgePxW =
      displayMode === 'scores' ? Math.max(58, label.length * 7.0 + 16) : Math.max(30, label.length * 7.2 + 20);
    const badgePxH = 20;
    const badgeW = Math.min(260, (badgePxW / safeW) * 1000);
    const badgeH = Math.min(80, (badgePxH / safeH) * 1000);

    const { xmin, ymin, xmax, ymax } = ann.box;

    const rawCandidates: [number, number][] = [
      [xmin - badgeW - GAP_X, ymin],
      [xmax + GAP_X, ymin],
      [xmin, ymin - badgeH - GAP_Y],
      [xmax - badgeW, ymin - badgeH - GAP_Y],
      [xmin, ymax + GAP_Y],
      [xmax - badgeW, ymax + GAP_Y],
      [xmin - badgeW - GAP_X, ymax - badgeH],
      [xmax + GAP_X, ymax - badgeH],
      [xmax - badgeW - GAP_X, ymin + GAP_Y],
      [xmin + GAP_X, ymin + GAP_Y],
    ];

    const clampCandidate = (cx: number, cy: number): [number, number] => [
      Math.max(EDGE_MARGIN, Math.min(1000 - badgeW - EDGE_MARGIN, cx)),
      Math.max(EDGE_MARGIN, Math.min(1000 - badgeH - EDGE_MARGIN, cy)),
    ];

    const overlapsAnyBadge = (cx: number, cy: number) =>
      placedBadges.some((p) => rectsOverlap(cx, cy, badgeW, badgeH, p.x, p.y, p.w, p.h, 3));

    const overlapsAnyBox = (cx: number, cy: number) =>
      sorted.some((other) =>
        rectsOverlap(
          cx,
          cy,
          badgeW,
          badgeH,
          other.box.xmin,
          other.box.ymin,
          other.box.xmax - other.box.xmin,
          other.box.ymax - other.box.ymin,
          1
        )
      );

    const overlapsOtherBoxes = (cx: number, cy: number) =>
      sorted.some(
        (other) =>
          String(other.item.id) !== String(ann.item.id) &&
          rectsOverlap(
            cx,
            cy,
            badgeW,
            badgeH,
            other.box.xmin,
            other.box.ymin,
            other.box.xmax - other.box.xmin,
            other.box.ymax - other.box.ymin,
            1
          )
      );

    let chosen: [number, number] | null = null;

    for (const [rx, ry] of rawCandidates) {
      const [cx, cy] = clampCandidate(rx, ry);
      if (!overlapsAnyBadge(cx, cy) && !overlapsAnyBox(cx, cy)) {
        chosen = [cx, cy];
        break;
      }
    }

    if (!chosen) {
      for (const [rx, ry] of rawCandidates) {
        const [cx, cy] = clampCandidate(rx, ry);
        if (!overlapsAnyBadge(cx, cy) && !overlapsOtherBoxes(cx, cy)) {
          chosen = [cx, cy];
          break;
        }
      }
    }

    if (!chosen) {
      for (const [rx, ry] of rawCandidates) {
        const [cx, cy] = clampCandidate(rx, ry);
        if (!overlapsAnyBadge(cx, cy)) {
          chosen = [cx, cy];
          break;
        }
      }
    }

    if (!chosen) {
      const baseX =
        xmin >= badgeW + 10
          ? clampCandidate(xmin - badgeW - GAP_X, ymin)[0]
          : clampCandidate(xmax + GAP_X, ymin)[0];
      for (let step = 1; step <= 16; step++) {
        const delta = step * (badgeH + GAP_Y);
        const down = clampCandidate(baseX, ymin + delta);
        if (!overlapsAnyBadge(down[0], down[1])) {
          chosen = down;
          break;
        }
        const up = clampCandidate(baseX, ymin - delta);
        if (!overlapsAnyBadge(up[0], up[1])) {
          chosen = up;
          break;
        }
      }
    }

    if (!chosen) {
      chosen = clampCandidate(xmin - badgeW - GAP_X, ymin);
    }

    const [badgeX, badgeY] = chosen;
    placedBadges.push({ x: badgeX, y: badgeY, w: badgeW, h: badgeH });

    const badgeCenterX = badgeX + badgeW / 2;
    const badgeCenterY = badgeY + badgeH / 2;
    const anchorX = Math.max(xmin, Math.min(xmax, badgeCenterX));
    const anchorY = Math.max(ymin, Math.min(ymax, badgeCenterY));
    const dist = Math.hypot(badgeCenterX - anchorX, badgeCenterY - anchorY);

    results.push({
      item: ann.item,
      box: ann.box,
      badgeX,
      badgeY,
      badgeW,
      badgeH,
      needsLeader: dist > Math.max(badgeH * 1.4, 26),
      anchorX,
      anchorY,
    });
  }

  return results;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  file,
  previewUrl,
  mimeType,
  annotations = [],
  activeQuestionId,
  recentQuestionId = null,
  isLiveEvaluating = false,
  onQuestionClick,
  showAnnotations,
  targetPage,
  emptyMessage = 'No document available',
  scrollMode = false,
  header,
}) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [resolvedMime, setResolvedMime] = useState<string>(mimeType || '');
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState<number>(840);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [pdfPageDimensions, setPdfPageDimensions] = useState<Record<number, { width: number; height: number }>>({});
  const [overlayMode, setOverlayMode] = useState<OverlayDisplayMode>(isLiveEvaluating ? 'scores' : 'clean');
  const [hoveredQuestionId, setHoveredQuestionId] = useState<number | string | null>(null);

  useEffect(() => {
    if (isLiveEvaluating) {
      setOverlayMode('scores');
    }
  }, [isLiveEvaluating]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Measure available preview container width for automatic mobile/desktop fit-to-width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerWidth(w);
    };
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const isCompactViewport = containerWidth < 640;
  const maxPageFitWidth = Math.max(260, Math.min(880, containerWidth - (isCompactViewport ? 20 : 48)));

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;
    let createdFallbackUrl: string | null = null;

    // Always clear previous document state when switching files/tabs
    setPdfDoc(null);
    setNumPages(0);
    setPageNum(1);
    setTextContent(null);
    setError(null);
    setImageNaturalSize(null);
    setPdfPageDimensions({});
    setFallbackImageUrl(null);

    if (!file && !previewUrl) {
      setResolvedMime('');
      setIsLoading(false);
      return;
    }

    const loadDoc = async () => {
      setIsLoading(true);
      try {
        if (file && file.size === 0) {
          throw new Error(`The file "${file.name}" is empty (0 bytes).`);
        }

        const effectiveMime = file ? await resolveEffectiveMimeType(file) : (mimeType || '').toLowerCase();
        if (cancelled) return;
        setResolvedMime(effectiveMime);

        if (effectiveMime === 'application/pdf') {
          let doc: PDFDocumentProxy | null = null;
          if (file) {
            const buffer = await file.arrayBuffer();
            if (cancelled) return;
            doc = await loadPdfDocument(new Uint8Array(buffer));
          } else if (previewUrl) {
            doc = await loadPdfDocument(previewUrl);
          }
          if (cancelled) {
            if (doc) await doc.destroy().catch(() => {});
            return;
          }
          if (doc) {
            loadedDoc = doc;
            setPdfDoc(doc);
            setNumPages(doc.numPages);
            setPageNum(1);
          }
        } else if (isImageMime(effectiveMime)) {
          if (!previewUrl && file) {
            createdFallbackUrl = URL.createObjectURL(file);
            if (!cancelled) setFallbackImageUrl(createdFallbackUrl);
          }
        } else if (file) {
          const text = await readDocumentAsText(file, effectiveMime);
          if (cancelled) return;
          setTextContent(text);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Document load error:', err);
          setError(err?.message || 'Failed to load document.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadDoc();

    return () => {
      cancelled = true;
      if (createdFallbackUrl) {
        URL.revokeObjectURL(createdFallbackUrl);
      }
      if (loadedDoc) {
        loadedDoc.destroy().catch(() => {});
      }
    };
  }, [file, previewUrl, mimeType]);

  useEffect(() => {
    if (!scrollMode && targetPage && targetPage >= 1 && targetPage <= numPages) {
      setPageNum(targetPage);
    }
    if (scrollMode && targetPage && targetPage >= 1 && containerRef.current) {
      const pageElement = containerRef.current.querySelector(`[data-page-number="${targetPage}"]`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [targetPage, numPages, scrollMode]);

  useEffect(() => {
    if (activeQuestionId === null || activeQuestionId === undefined || !containerRef.current) return;
    const timer = setTimeout(() => {
      const targetEl = containerRef.current?.querySelector(
        `[data-annotation-qid="${CSS.escape(String(activeQuestionId))}"]`
      );
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [activeQuestionId, pageNum]);

  const normalizedAnnotations = useMemo(() => {
    return annotations
      .map((a) => {
        const norm = normalizeBox(a.box);
        if (!norm) return null;
        return { item: a, box: norm };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }, [annotations]);

  const activeAnnotation = useMemo(() => {
    if (activeQuestionId === null || activeQuestionId === undefined) return null;
    return annotations.find((a) => String(a.id) === String(activeQuestionId)) || null;
  }, [annotations, activeQuestionId]);

  const activeIndex = useMemo(() => {
    if (!activeAnnotation) return -1;
    return annotations.findIndex((a) => String(a.id) === String(activeAnnotation.id));
  }, [annotations, activeAnnotation]);

  useEffect(() => {
    if (!activeAnnotation || annotations.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        onQuestionClick?.(null);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (activeIndex < annotations.length - 1) {
          e.preventDefault();
          onQuestionClick?.(annotations[activeIndex + 1].id);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (activeIndex > 0) {
          e.preventDefault();
          onQuestionClick?.(annotations[activeIndex - 1].id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeAnnotation, activeIndex, annotations, onQuestionClick]);

  const getPageAnnotations = (pNum: number) => {
    if (!showAnnotations || overlayMode === 'off') return [];
    return normalizedAnnotations.filter((a) => {
      if (resolvedMime === 'application/pdf') {
        const maxP = numPages || 1;
        const clampedPage = Math.max(1, Math.min(maxP, a.box.page_number || 1));
        return clampedPage === pNum;
      }
      return pNum === 1;
    });
  };

  const imageDisplaySize = useMemo(() => {
    if (!imageNaturalSize) return null;
    const { width, height } = imageNaturalSize;
    const maxH = isCompactViewport ? 560 : 760;
    const fitRatio = Math.min(1, maxPageFitWidth / width, maxH / height);
    const baseWidth = Math.max(240, Math.round(width * fitRatio));
    const displayWidth = Math.round(baseWidth * scale);
    const displayHeight = Math.round((displayWidth * height) / width);
    return { displayWidth, displayHeight };
  }, [imageNaturalSize, scale, maxPageFitWidth, isCompactViewport]);

  const renderAnnotationOverlay = (pNum: number, pageWidthPx: number, pageHeightPx: number) => {
    const pageAnns = getPageAnnotations(pNum);
    if (pageAnns.length === 0) return null;

    const placed = computeCollisionFreePlacements(pageAnns, pageWidthPx, pageHeightPx, overlayMode);

    return (
      <div className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 10 }}>
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
          viewBox="0 0 1000 1000"
        >
          {placed.map((ann, idx) => {
            const isActive = activeQuestionId !== null && String(activeQuestionId) === String(ann.item.id);
            const isRecent = recentQuestionId !== null && String(recentQuestionId) === String(ann.item.id);
            const isHovered = hoveredQuestionId !== null && String(hoveredQuestionId) === String(ann.item.id);
            const isCorrect = ann.item.score === ann.item.full_marks;
            const isPartial = ann.item.score > 0 && ann.item.score < ann.item.full_marks;

            const statusColor = isCorrect ? '#10b981' : isPartial ? '#f59e0b' : '#ef4444';
            const markingBg = isCorrect
              ? 'rgba(16, 185, 129, 0.16)'
              : isPartial
              ? 'rgba(245, 158, 11, 0.16)'
              : 'rgba(239, 68, 68, 0.16)';
            const hoverBg = isCorrect
              ? 'rgba(16, 185, 129, 0.07)'
              : isPartial
              ? 'rgba(245, 158, 11, 0.07)'
              : 'rgba(239, 68, 68, 0.07)';

            const x = ann.box.xmin;
            const y = ann.box.ymin;
            const w = ann.box.xmax - ann.box.xmin;
            const h = ann.box.ymax - ann.box.ymin;

            return (
              <g
                key={`ann-box-${pNum}-${ann.item.id}-${idx}`}
                className="pointer-events-auto cursor-pointer animate-fade-in"
                onMouseEnter={() => setHoveredQuestionId(ann.item.id)}
                onMouseLeave={() => setHoveredQuestionId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onQuestionClick?.(isActive ? null : ann.item.id);
                }}
              >
                {(isActive || isRecent || isHovered || overlayMode === 'scores') && ann.needsLeader && (
                  <line
                    x1={ann.badgeX + ann.badgeW / 2}
                    y1={ann.badgeY + ann.badgeH / 2}
                    x2={ann.anchorX}
                    y2={ann.anchorY}
                    stroke={statusColor}
                    strokeWidth={isActive || isRecent ? 2 : 1.2}
                    strokeDasharray="3 2"
                    vectorEffect="non-scaling-stroke"
                    opacity={isActive || isRecent ? 0.95 : 0.65}
                  />
                )}
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx="2"
                  ry="2"
                  fill={isActive || isRecent ? markingBg : isHovered ? hoverBg : 'transparent'}
                  stroke={statusColor}
                  strokeOpacity={isActive || isRecent ? 1 : isHovered ? 0.9 : overlayMode === 'scores' ? 0.75 : 0.35}
                  strokeWidth={isActive || isRecent ? 2.5 : isHovered ? 2 : 1.25}
                  strokeDasharray={isActive || isRecent || isHovered || overlayMode === 'scores' ? undefined : '4 3'}
                  vectorEffect="non-scaling-stroke"
                  className="transition-all duration-150"
                />
              </g>
            );
          })}
        </svg>

        {placed.map((ann, idx) => {
          const isActive = activeQuestionId !== null && String(activeQuestionId) === String(ann.item.id);
          const isRecent = recentQuestionId !== null && String(recentQuestionId) === String(ann.item.id);
          const isHovered = hoveredQuestionId !== null && String(hoveredQuestionId) === String(ann.item.id);
          const isCorrect = ann.item.score === ann.item.full_marks;
          const isPartial = ann.item.score > 0 && ann.item.score < ann.item.full_marks;

          const dotColor = isCorrect ? 'bg-emerald-400' : isPartial ? 'bg-amber-400' : 'bg-red-400';
          const qLabel = formatQLabel(ann.item.id);

          const activeBg = isCorrect
            ? 'bg-emerald-600 border-emerald-200 ring-2 ring-emerald-400/70'
            : isPartial
            ? 'bg-amber-600 border-amber-200 ring-2 ring-amber-400/70'
            : 'bg-red-600 border-red-200 ring-2 ring-red-400/70';

          const scoreBg = isCorrect
            ? 'bg-emerald-900/95 hover:bg-emerald-800 border-white/25'
            : isPartial
            ? 'bg-amber-900/95 hover:bg-amber-800 border-white/25'
            : 'bg-red-900/95 hover:bg-red-800 border-white/25';

          const cleanPinBg = 'bg-[#140a2b]/90 hover:bg-[#1e1040] border-purple-300/35';

          return (
            <button
              key={`ann-tag-${pNum}-${ann.item.id}-${idx}`}
              type="button"
              data-annotation-qid={String(ann.item.id)}
              onMouseEnter={() => setHoveredQuestionId(ann.item.id)}
              onMouseLeave={() => setHoveredQuestionId(null)}
              onClick={(e) => {
                e.stopPropagation();
                onQuestionClick?.(isActive ? null : ann.item.id);
              }}
              title={`${qLabel} • ${ann.item.score}/${ann.item.full_marks} (Click to inspect)`}
              style={{
                left: `${(ann.badgeX / 1000) * 100}%`,
                top: `${(ann.badgeY / 1000) * 100}%`,
                zIndex: isActive ? 30 : isRecent ? 28 : isHovered ? 25 : 20,
              }}
              className={`animate-fade-in absolute pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] leading-tight font-mono font-bold text-white whitespace-nowrap shadow-md border backdrop-blur-sm transition-transform duration-150 hover:scale-105 ${
                isActive
                  ? `${activeBg} scale-105`
                  : isRecent
                  ? `${scoreBg} ring-2 ring-purple-300/80 scale-105`
                  : overlayMode === 'scores'
                  ? scoreBg
                  : cleanPinBg
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-white' : dotColor}`} />
              <span>
                {overlayMode === 'scores' || isActive || isRecent
                  ? `${qLabel} • ${ann.item.score}/${ann.item.full_marks}`
                  : qLabel}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderActiveInspector = () => {
    if (!activeAnnotation) return null;
    const isCorrect = activeAnnotation.score === activeAnnotation.full_marks;
    const isPartial = activeAnnotation.score > 0 && activeAnnotation.score < activeAnnotation.full_marks;

    const markingBgClass = isCorrect
      ? 'bg-emerald-500/15 border-emerald-400/45 text-emerald-200'
      : isPartial
      ? 'bg-amber-500/15 border-amber-400/45 text-amber-200'
      : 'bg-rose-500/15 border-rose-400/45 text-rose-200';

    const accentBarClass = isCorrect
      ? 'bg-gradient-to-r from-emerald-500 to-purple-500'
      : isPartial
      ? 'bg-gradient-to-r from-amber-500 to-purple-500'
      : 'bg-gradient-to-r from-rose-500 to-purple-500';

    const qLabel = formatQLabel(activeAnnotation.id);
    const hasPrev = activeIndex > 0;
    const hasNext = activeIndex >= 0 && activeIndex < annotations.length - 1;

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0 border-t border-purple-500/30 bg-[#0b0618]/95 backdrop-blur-xl text-[#f5f3ff] shadow-[0_-14px_38px_rgba(0,0,0,0.65)] z-30 animate-fade-in max-h-[42vh] overflow-y-auto custom-scrollbar"
      >
        <div className={`h-1 w-full ${accentBarClass}`} />
        <div className="max-w-5xl mx-auto px-3 sm:px-5 py-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-3 py-1 rounded-xl border font-mono font-bold text-xs sm:text-sm tabular-nums ${markingBgClass}`}>
                {qLabel} • {activeAnnotation.score} / {activeAnnotation.full_marks} Marks
              </span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-purple-950/90 border border-purple-400/30 text-purple-200">
                {isCorrect ? 'Full Marks' : isPartial ? 'Partial Credit' : 'Incorrect / Omitted'}
              </span>
              {typeof activeAnnotation.confidence === 'number' && (
                <span className="text-[11px] font-mono text-purple-300/75 tabular-nums">
                  {Math.round(activeAnnotation.confidence * 100)}% Conf.
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {annotations.length > 1 && (
                <div className="flex items-center bg-[#150c2b] border border-purple-500/30 rounded-xl p-0.5 mr-1">
                  <button
                    type="button"
                    disabled={!hasPrev}
                    onClick={() => hasPrev && onQuestionClick?.(annotations[activeIndex - 1].id)}
                    className="p-1.5 rounded-lg hover:bg-purple-600/30 disabled:opacity-30 transition-colors min-w-[34px] min-h-[34px] flex items-center justify-center"
                    title="Previous Question (Left Arrow)"
                  >
                    <ChevronLeftIcon className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono px-2 text-purple-200 tabular-nums">
                    {activeIndex + 1}/{annotations.length}
                  </span>
                  <button
                    type="button"
                    disabled={!hasNext}
                    onClick={() => hasNext && onQuestionClick?.(annotations[activeIndex + 1].id)}
                    className="p-1.5 rounded-lg hover:bg-purple-600/30 disabled:opacity-30 transition-colors min-w-[34px] min-h-[34px] flex items-center justify-center"
                    title="Next Question (Right Arrow)"
                  >
                    <ChevronRightIcon className="w-4 h-4" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => onQuestionClick?.(null)}
                className="p-1.5 rounded-full text-purple-300/75 hover:text-white hover:bg-purple-500/20 transition-colors min-w-[34px] min-h-[34px] flex items-center justify-center"
                title="Close inspector (Esc)"
              >
                <XCircleIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {(activeAnnotation.question_text || activeAnnotation.student_answer !== undefined || activeAnnotation.feedback) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
              {activeAnnotation.question_text && (
                <div className="bg-[#130a26]/80 border border-purple-500/20 rounded-xl p-2.5">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-purple-300/65 mb-1">
                    Question
                  </p>
                  <p className="text-purple-100 line-clamp-3 leading-relaxed">{activeAnnotation.question_text}</p>
                </div>
              )}
              <div className={`border rounded-xl p-2.5 ${markingBgClass}`}>
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-85 mb-1">
                  Student Answer (OCR)
                </p>
                <p className="font-mono text-white whitespace-pre-wrap break-words max-h-20 overflow-y-auto custom-scrollbar leading-relaxed">
                  {activeAnnotation.student_answer || <span className="italic opacity-65">(No answer detected)</span>}
                </p>
              </div>
              {activeAnnotation.feedback && (
                <div className="bg-[#130a26]/80 border border-purple-500/20 rounded-xl p-2.5">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-purple-300 mb-1">
                    Marking Feedback
                  </p>
                  <p className="text-purple-100/90 max-h-20 overflow-y-auto custom-scrollbar leading-relaxed">
                    {activeAnnotation.feedback}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeAnnotation.fixer_note && (
            <div className="bg-amber-950/35 border border-amber-400/35 rounded-xl px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
              <span className="font-mono font-bold text-[10px] uppercase tracking-wider text-amber-300 shrink-0">
                Speed Fixer
              </span>
              <span className="truncate">{activeAnnotation.fixer_note}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const activeImageSrc = previewUrl || fallbackImageUrl;

  return (
    <div className="w-full h-full bg-[#070510] flex flex-col overflow-hidden">
      {(pdfDoc || (isImageMime(resolvedMime) && activeImageSrc) || textContent !== null) && (
        <div
          className={`flex-shrink-0 min-h-[3rem] py-2 px-3 bg-[#0c071b]/95 backdrop-blur-xl border-b border-purple-500/20 flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-purple-100 z-20 ${
            scrollMode ? 'sticky top-0' : ''
          }`}
        >
          {!scrollMode && pdfDoc && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                disabled={pageNum <= 1}
                className="p-2 hover:bg-purple-600/25 rounded-lg disabled:opacity-35 transition-all min-w-[36px] min-h-[36px] flex items-center justify-center"
                aria-label="Previous page"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="font-medium font-mono text-xs sm:text-sm min-w-[78px] text-center tabular-nums">
                Page {pageNum}/{numPages}
              </span>
              <button
                type="button"
                onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
                disabled={pageNum >= numPages}
                className="p-2 hover:bg-purple-600/25 rounded-lg disabled:opacity-35 transition-all min-w-[36px] min-h-[36px] flex items-center justify-center"
                aria-label="Next page"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
              <div className="w-px h-5 bg-purple-500/25 mx-1" />
            </div>
          )}

          {scrollMode && pdfDoc && (
            <span className="font-medium font-mono text-xs text-purple-300/80 px-1.5 tabular-nums">
              {numPages} {numPages === 1 ? 'Page' : 'Pages'}
            </span>
          )}

          <div className="flex items-center gap-1 bg-[#140a29] border border-purple-500/25 rounded-xl px-1 py-0.5">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
              className="p-1.5 hover:bg-purple-600/30 rounded-lg transition-all min-w-[34px] min-h-[34px] flex items-center justify-center"
              aria-label="Zoom out"
            >
              <ZoomOutIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setScale(1.0)}
              title="Reset zoom to fit screen"
              className="font-medium font-mono text-xs min-w-[46px] text-center tabular-nums text-purple-200 hover:text-white"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}
              className="p-1.5 hover:bg-purple-600/30 rounded-lg transition-all min-w-[34px] min-h-[34px] flex items-center justify-center"
              aria-label="Zoom in"
            >
              <ZoomInIcon className="w-4 h-4" />
            </button>
          </div>

          {showAnnotations && annotations.length > 0 && (
            <div className="flex items-center bg-[#140a29] border border-purple-500/25 rounded-xl p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setOverlayMode('clean')}
                className={`px-2.5 py-1.5 rounded-lg transition-colors min-h-[32px] ${
                  overlayMode === 'clean'
                    ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.6)]'
                    : 'text-purple-200/75 hover:text-white'
                }`}
                title="Clean margin pins — click any answer to inspect marks"
              >
                Pins
              </button>
              <button
                type="button"
                onClick={() => setOverlayMode('scores')}
                className={`px-2.5 py-1.5 rounded-lg transition-colors min-h-[32px] ${
                  overlayMode === 'scores'
                    ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.6)]'
                    : 'text-purple-200/75 hover:text-white'
                }`}
                title="Show all score badges"
              >
                Scores
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverlayMode('off');
                  onQuestionClick?.(null);
                }}
                className={`px-2.5 py-1.5 rounded-lg transition-colors min-h-[32px] ${
                  overlayMode === 'off' ? 'bg-purple-900 text-white' : 'text-purple-200/75 hover:text-white'
                }`}
                title="Hide all overlays to view raw sheet"
              >
                Hide
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        onClick={() => activeQuestionId && onQuestionClick?.(null)}
        className="flex-grow flex flex-col overflow-auto p-2.5 sm:p-5 relative custom-scrollbar bg-[#05030b] items-center"
      >
        {header && (
          <div className="w-full max-w-5xl mb-5" onClick={(e) => e.stopPropagation()}>
            {header}
          </div>
        )}

        {isLoading && (
          <div className="w-full max-w-2xl space-y-3 my-auto p-4">
            <div className="h-6 rounded-xl skeleton-box w-1/2 mx-auto" />
            <div className="h-64 rounded-2xl skeleton-box w-full" />
          </div>
        )}
        {error && (
          <div className="text-rose-300 bg-rose-950/50 px-5 py-4 rounded-2xl border border-rose-500/35 shadow-lg self-center my-auto text-sm">
            {error}
          </div>
        )}

        {!isLoading && !error && (
          <div className={`${scrollMode ? 'flex flex-col items-center space-y-5 w-full' : 'inline-block align-middle my-auto'}`}>
            {resolvedMime === 'application/pdf' && pdfDoc ? (
              scrollMode ? (
                Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
                  const dims = pdfPageDimensions[p] || { width: maxPageFitWidth * scale, height: maxPageFitWidth * 1.3 * scale };
                  return (
                    <div
                      key={p}
                      className="relative shadow-[0_20px_50px_rgba(0,0,0,0.85)] rounded-md ring-1 ring-purple-500/20 mx-auto"
                      data-page-number={p}
                      style={{ width: 'fit-content' }}
                    >
                      <PDFPageRenderer
                        pdfDoc={pdfDoc}
                        pageNum={p}
                        scale={scale}
                        maxFitWidth={maxPageFitWidth}
                        isCompactViewport={isCompactViewport}
                        onDimensions={(w, h) =>
                          setPdfPageDimensions((prev) =>
                            prev[p]?.width === w && prev[p]?.height === h ? prev : { ...prev, [p]: { width: w, height: h } }
                          )
                        }
                      />
                      {renderAnnotationOverlay(p, dims.width, dims.height)}
                      <div className="absolute bottom-2 right-2 bg-[#0c061a]/80 border border-purple-400/25 text-purple-100 text-[10px] font-mono px-2 py-0.5 rounded-full backdrop-blur-sm pointer-events-none z-20 tabular-nums">
                        Page {p}
                      </div>
                    </div>
                  );
                })
              ) : (
                (() => {
                  const dims = pdfPageDimensions[pageNum] || {
                    width: maxPageFitWidth * scale,
                    height: maxPageFitWidth * 1.3 * scale,
                  };
                  return (
                    <div
                      className="relative shadow-[0_20px_50px_rgba(0,0,0,0.85)] rounded-md ring-1 ring-purple-500/20 mx-auto"
                      style={{ width: 'fit-content' }}
                    >
                      <PDFPageRenderer
                        key={pageNum}
                        pdfDoc={pdfDoc}
                        pageNum={pageNum}
                        scale={scale}
                        maxFitWidth={maxPageFitWidth}
                        isCompactViewport={isCompactViewport}
                        onDimensions={(w, h) =>
                          setPdfPageDimensions((prev) =>
                            prev[pageNum]?.width === w && prev[pageNum]?.height === h
                              ? prev
                              : { ...prev, [pageNum]: { width: w, height: h } }
                          )
                        }
                      />
                      {renderAnnotationOverlay(pageNum, dims.width, dims.height)}
                    </div>
                  );
                })()
              )
            ) : isImageMime(resolvedMime) && activeImageSrc ? (
              <div
                className="relative shadow-[0_20px_50px_rgba(0,0,0,0.85)] rounded-md ring-1 ring-purple-500/20 mx-auto"
                style={{
                  width: imageDisplaySize ? `${imageDisplaySize.displayWidth}px` : 'fit-content',
                }}
              >
                <img
                  src={activeImageSrc}
                  alt="Document"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) {
                      setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                    }
                  }}
                  onError={() => {
                    setError(
                      `Unable to display image "${file?.name || 'document'}". Try converting HEIC/TIFF files to PNG, JPG, WebP, or PDF.`
                    );
                  }}
                  style={{
                    width: imageDisplaySize ? `${imageDisplaySize.displayWidth}px` : 'auto',
                    height: 'auto',
                  }}
                  className="block bg-white rounded-sm"
                />
                {renderAnnotationOverlay(
                  1,
                  imageDisplaySize?.displayWidth ?? maxPageFitWidth,
                  imageDisplaySize?.displayHeight ?? Math.round(maxPageFitWidth * 1.25)
                )}
              </div>
            ) : textContent !== null ? (
              <div className="liquid-glass border-glow text-purple-100 p-5 sm:p-8 whitespace-pre-wrap font-mono text-xs sm:text-sm leading-relaxed max-w-3xl w-full overflow-auto max-h-[82vh] rounded-2xl">
                {textContent}
              </div>
            ) : (
              <div className="text-purple-300/55 flex flex-col items-center justify-center h-72 min-w-[260px] self-center text-center px-4">
                <EyeIcon className="w-16 h-16 mb-4 stroke-1 text-purple-400/50" />
                <p className="text-base sm:text-lg font-medium">{emptyMessage}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {renderActiveInspector()}
    </div>
  );
};

const PDFPageRenderer: React.FC<{
  pdfDoc: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  maxFitWidth: number;
  isCompactViewport: boolean;
  onDimensions?: (width: number, height: number) => void;
}> = React.memo(({ pdfDoc, pageNum, scale, maxFitWidth, isCompactViewport, onDimensions }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    setPageError(null);

    const renderPage = async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
            await renderTaskRef.current.promise;
          } catch {
            // Expected RenderingCancelledException when cancelling prior render
          }
          renderTaskRef.current = null;
        }
        if (cancelled) return;

        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;

        const baseViewport = page.getViewport({ scale: 1.0 });
        const fitWidth = Math.min(baseViewport.width * 1.25, maxFitWidth);
        const displayWidth = Math.max(220, Math.round(fitWidth * scale));
        const displayHeight = Math.round((displayWidth * baseViewport.height) / baseViewport.width);

        onDimensions?.(displayWidth, displayHeight);

        const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
        const maxRenderScale = isCompactViewport ? 1.85 : 2.6;
        const desiredRenderScale = (displayWidth / baseViewport.width) * dpr;
        const renderScale = Math.min(maxRenderScale, Math.max(1.35, desiredRenderScale));
        const viewport = page.getViewport({ scale: renderScale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        canvas.className = 'bg-white rounded-sm';

        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err: any) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          console.error('PDF page render error:', err);
          setPageError(`Unable to render page ${pageNum}.`);
        }
      }
    };

    renderPage();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfDoc, pageNum, scale, maxFitWidth, isCompactViewport]);

  if (pageError) {
    return (
      <div className="p-6 bg-rose-950/60 border border-rose-500/40 rounded-lg text-xs text-rose-200 font-mono">
        {pageError}
      </div>
    );
  }

  return <canvas ref={canvasRef} />;
});
