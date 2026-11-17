import React, { useState, useRef, useEffect } from 'react';
import type { BoundingBox } from '../types';
import { TrashIcon } from './Icons';
import { playSound } from '../utils/sound';
import { loadPdfDocument } from '../utils/pdfUtils';
import { resolveEffectiveMimeType, isImageMime } from '../utils/fileUtils';

interface OMRTemplateEditorProps {
  templateFile: File;
  initialBoxes: BoundingBox[];
  onSave: (boxes: BoundingBox[]) => void;
  onClose: () => void;
}

type DragMode =
  | 'draw'
  | 'drag'
  | 'resize-tl'
  | 'resize-t'
  | 'resize-tr'
  | 'resize-r'
  | 'resize-br'
  | 'resize-b'
  | 'resize-bl'
  | 'resize-l'
  | 'none';

export const OMRTemplateEditor: React.FC<OMRTemplateEditorProps> = ({
  templateFile,
  initialBoxes,
  onSave,
  onClose,
}) => {
  const [boxes, setBoxes] = useState<BoundingBox[]>(initialBoxes);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragInfo = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startBox: BoundingBox;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setLoadError(null);
    setImageUrl('');
    setImageSize({ width: 0, height: 0 });

    const loadTemplate = async () => {
      try {
        const mime = await resolveEffectiveMimeType(templateFile);
        if (!active) return;

        if (mime === 'application/pdf') {
          const data = new Uint8Array(await templateFile.arrayBuffer());
          const doc = await loadPdfDocument(data);
          try {
            const page = await doc.getPage(1);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas unsupported');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const renderTask = page.render({ canvasContext: ctx, viewport });
            await renderTask.promise;
            if (!active) return;
            const dataUrl = canvas.toDataURL('image/png');
            setImageUrl(dataUrl);
            setImageSize({ width: viewport.width, height: viewport.height });
          } finally {
            await doc.destroy().catch(() => {});
          }
        } else if (isImageMime(mime)) {
          objectUrl = URL.createObjectURL(templateFile);
          const image = new Image();
          image.src = objectUrl;
          image.onload = () => {
            if (!active) return;
            setImageUrl(objectUrl);
            setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
          };
          image.onerror = () => {
            if (active) setLoadError('Could not decode this image file for OMR editing.');
          };
        } else {
          setLoadError('OMR Template Editor supports PDF or Image files (PNG, JPG, WebP, GIF, BMP).');
        }
      } catch (err: any) {
        console.error('Failed to load file for OMR template editor:', err);
        if (active) setLoadError(err?.message || 'Could not load template document.');
      }
    };

    loadTemplate();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [templateFile]);

  const getSVGPoint = (e: MouseEvent | React.MouseEvent): { x: number; y: number } => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svgPoint = svgRef.current.createSVGPoint();
    svgPoint.x = e.clientX;
    svgPoint.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const transformedPoint = svgPoint.matrixTransform(ctm.inverse());
    return { x: transformedPoint.x, y: transformedPoint.y };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragInfo.current) return;
    const currentPos = getSVGPoint(e);
    const dx = currentPos.x - dragInfo.current.startX;
    const dy = currentPos.y - dragInfo.current.startY;

    setBoxes((prev) =>
      prev.map((b) => {
        if (b.id !== dragInfo.current!.startBox.id) return b;

        let { x, y, width, height } = dragInfo.current!.startBox;
        const mode = dragInfo.current!.mode;

        if (mode === 'drag') {
          return { ...b, x: x + dx, y: y + dy };
        } else if (mode === 'draw') {
          width = dx;
          height = dy;
        } else if (mode.startsWith('resize-')) {
          if (mode.includes('l')) {
            width -= dx;
            x += dx;
          }
          if (mode.includes('r')) {
            width += dx;
          }
          if (mode.includes('t')) {
            height -= dy;
            y += dy;
          }
          if (mode.includes('b')) {
            height += dy;
          }
        }

        if (width < 0) {
          x += width;
          width = -width;
        }
        if (height < 0) {
          y += height;
          height = -height;
        }

        return { ...b, x, y, width, height };
      })
    );
  };

  const handleMouseUp = () => {
    if (!dragInfo.current) return;
    const wasDrawing = dragInfo.current.mode === 'draw';
    dragInfo.current = null;

    setBoxes((prev) => {
      const nextBoxes = [...prev];
      const tempBoxIndex = nextBoxes.findIndex((b) => b.id.startsWith('temp-'));
      if (tempBoxIndex > -1) {
        const tempBox = nextBoxes[tempBoxIndex];
        if (wasDrawing && (tempBox.width < 5 || tempBox.height < 5)) {
          return prev.filter((b) => !b.id.startsWith('temp-'));
        }
        const newId = crypto.randomUUID();
        nextBoxes[tempBoxIndex] = { ...tempBox, id: newId };
        setSelectedBoxId(newId);
      }
      return nextBoxes;
    });
  };

  const handleMouseDown = (e: React.MouseEvent, mode: DragMode, boxId?: string) => {
    e.stopPropagation();
    const startPos = getSVGPoint(e);
    const targetBox = boxes.find((b) => b.id === boxId);

    if (mode === 'draw' && e.target !== svgRef.current) return;

    dragInfo.current = {
      mode,
      startX: startPos.x,
      startY: startPos.y,
      startBox:
        mode === 'draw'
          ? { id: `temp-${Date.now()}`, question_id: '', x: startPos.x, y: startPos.y, width: 0, height: 0 }
          : { ...targetBox! },
    };

    if (mode === 'draw') {
      setBoxes((prev) => [...prev, dragInfo.current!.startBox]);
    }

    const onMouseMove = (moveEvent: MouseEvent) => handleMouseMove(moveEvent);
    const onMouseUp = () => {
      handleMouseUp();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleBoxChange = (id: string, field: 'question_id', value: string) => {
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  const removeBox = (id: string) => {
    playSound('click');
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    if (selectedBoxId === id) setSelectedBoxId(null);
  };

  const handleSave = () => {
    playSound('success');
    onSave(boxes);
  };

  const getHandlePoints = (box: BoundingBox) => {
    const { x, y, width, height } = box;
    return [
      { name: 'resize-tl', x, y, cursor: 'nwse-resize' },
      { name: 'resize-t', x: x + width / 2, y, cursor: 'ns-resize' },
      { name: 'resize-tr', x: x + width, y, cursor: 'nesw-resize' },
      { name: 'resize-l', x, y: y + height / 2, cursor: 'ew-resize' },
      { name: 'resize-r', x: x + width, y: y + height / 2, cursor: 'ew-resize' },
      { name: 'resize-bl', x, y: y + height, cursor: 'nesw-resize' },
      { name: 'resize-b', x: x + width / 2, y: y + height, cursor: 'ns-resize' },
      { name: 'resize-br', x: x + width, y: y + height, cursor: 'nwse-resize' },
    ];
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      aria-modal="true"
      role="dialog"
    >
      <div className="liquid-glass border-glow border-glow-active w-full h-full max-w-7xl max-h-[94vh] flex flex-col overflow-hidden text-white rounded-2xl sm:rounded-3xl bg-[#080412]/95">
        <header className="px-4 sm:px-6 py-3.5 border-b border-purple-500/20 flex justify-between items-center gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold shimmer-text">Define OMR Answer Areas</h2>
            <p className="text-[11px] font-mono text-purple-300/65">
              VECTOR ROI CALIBRATION • {boxes.length} REGIONS
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              playSound('click');
              onClose();
            }}
            className="w-9 h-9 rounded-full bg-purple-950/70 border border-purple-500/30 flex items-center justify-center text-purple-300 hover:text-white text-lg"
            aria-label="Close OMR template editor"
          >
            &times;
          </button>
        </header>

        <div className="flex-grow flex flex-col lg:flex-row overflow-hidden">
          <main className="flex-grow bg-[#05020b] overflow-auto custom-scrollbar p-3 sm:p-5 flex items-center justify-center min-h-[40vh]">
            {loadError ? (
              <div className="text-center text-rose-300 p-6 text-sm max-w-md">{loadError}</div>
            ) : imageSize.width > 0 && imageUrl ? (
              <div
                className="relative shadow-[0_18px_50px_rgba(0,0,0,0.85)] rounded-lg overflow-hidden border border-purple-500/25"
                style={{
                  width: '100%',
                  maxWidth: `${imageSize.width}px`,
                  aspectRatio: `${imageSize.width}/${imageSize.height}`,
                }}
              >
                <img
                  src={imageUrl}
                  alt="OMR Template"
                  className="absolute inset-0 w-full h-full object-contain select-none"
                />
                <svg
                  ref={svgRef}
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                  viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                  preserveAspectRatio="none"
                  onMouseDown={(e) => handleMouseDown(e, 'draw')}
                >
                  {boxes.map((box) => {
                    const isSelected = selectedBoxId === box.id;
                    return (
                      <g key={box.id} onClick={() => setSelectedBoxId(box.id)}>
                        <rect
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          onMouseDown={(e) => handleMouseDown(e, 'drag', box.id)}
                          className={`fill-purple-500/25 stroke-purple-400 hover:stroke-purple-200 ${
                            isSelected ? 'stroke-[3]' : 'stroke-2'
                          }`}
                          style={{ cursor: 'move' }}
                        />
                        {isSelected &&
                          getHandlePoints(box).map((handle) => (
                            <circle
                              key={handle.name}
                              cx={handle.x}
                              cy={handle.y}
                              r={Math.max(4, Math.min(box.width, box.height, 18) / 2)}
                              onMouseDown={(e) => handleMouseDown(e, handle.name as DragMode, box.id)}
                              className="fill-white stroke-purple-600 stroke-2"
                              style={{ cursor: handle.cursor }}
                            />
                          ))}
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div className="w-full max-w-md space-y-3 p-6">
                <div className="h-6 rounded skeleton-box w-2/3 mx-auto" />
                <div className="h-48 rounded-2xl skeleton-box w-full" />
              </div>
            )}
          </main>

          <aside className="w-full lg:w-80 bg-[#0b0618] border-t lg:border-t-0 lg:border-l border-purple-500/20 flex flex-col max-h-[38vh] lg:max-h-none">
            <div className="p-4 border-b border-purple-500/20">
              <h3 className="font-bold text-sm text-white">Answer Areas ({boxes.length})</h3>
              <p className="text-[11px] text-purple-200/65 mt-1">
                Drag across the sheet to define an OMR region, then assign its Question Number.
              </p>
            </div>
            <div className="flex-grow overflow-y-auto custom-scrollbar p-3 space-y-2.5">
              {boxes.length === 0 && (
                <p className="text-center text-xs text-purple-300/60 p-4 font-mono">
                  0 areas defined yet.
                </p>
              )}
              {boxes.map((box) => (
                <div
                  key={box.id}
                  className={`p-3 rounded-xl border transition-colors ${
                    selectedBoxId === box.id
                      ? 'bg-purple-600/20 border-purple-400'
                      : 'bg-[#120a26] border-purple-500/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor={`q-${box.id}`} className="font-semibold text-xs text-purple-200">
                      Question ID
                    </label>
                    <button
                      type="button"
                      onClick={() => removeBox(box.id)}
                      className="text-purple-300/60 hover:text-rose-400 p-1"
                      aria-label="Remove box"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    id={`q-${box.id}`}
                    type="text"
                    placeholder="e.g., 1, 2a"
                    value={box.question_id}
                    onChange={(e) => handleBoxChange(box.id, 'question_id', e.target.value)}
                    onClick={() => setSelectedBoxId(box.id)}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-[#070312] text-white border border-purple-500/30 focus:outline-none focus:border-purple-400 placeholder:text-purple-300/40"
                  />
                </div>
              ))}
            </div>
            <div className="p-3 sm:p-4 border-t border-purple-500/20 flex gap-2.5 bg-[#090414]">
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  onClose();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl border border-purple-500/30 bg-[#140a29] text-xs font-semibold text-purple-100 hover:bg-purple-900/40 min-h-[42px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 btn-quantix py-2.5 px-4 rounded-xl text-xs font-semibold text-white min-h-[42px]"
              >
                Save Regions
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
