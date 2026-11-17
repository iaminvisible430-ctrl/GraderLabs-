// Robust client-side file type detection, image optimization, and document text extraction

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const ACCEPTED_DOCUMENT_EXTENSIONS =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.txt,.csv,.md,.json,.docx';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase().trim();
}

export function inferMimeType(file: File): string {
  const rawType = (file.type || '').toLowerCase().trim();
  if (rawType === 'application/x-pdf') return 'application/pdf';
  if (rawType === 'image/jpg') return 'image/jpeg';

  if (rawType && rawType !== 'application/octet-stream' && rawType !== 'binary/octet-stream') {
    return rawType;
  }

  const ext = getFileExtension(file.name);
  if (ext && EXTENSION_MIME_MAP[ext]) {
    return EXTENSION_MIME_MAP[ext];
  }

  return '';
}

export async function detectMagicMimeType(file: File): Promise<string> {
  try {
    const headerSlice = file.slice(0, 16);
    const buf = new Uint8Array(await headerSlice.arrayBuffer());
    if (buf.length >= 4) {
      // %PDF
      if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
        return 'application/pdf';
      }
      // PNG: 89 50 4E 47
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return 'image/png';
      }
      // JPEG: FF D8 FF
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return 'image/jpeg';
      }
      // GIF: GIF8
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
        return 'image/gif';
      }
      // BMP: BM
      if (buf[0] === 0x42 && buf[1] === 0x4d) {
        return 'image/bmp';
      }
      // WEBP: RIFF....WEBP
      if (
        buf.length >= 12 &&
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
      ) {
        return 'image/webp';
      }
      // ZIP container (DOCX if .docx extension)
      if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
        const ext = getFileExtension(file.name);
        if (ext === 'docx') return DOCX_MIME;
      }
    }
  } catch {
    // Ignore slice read failures
  }
  return '';
}

export async function resolveEffectiveMimeType(file: File): Promise<string> {
  const inferred = inferMimeType(file);
  if (inferred) return inferred;
  const magic = await detectMagicMimeType(file);
  if (magic) return magic;
  return 'text/plain';
}

export function isPdfFile(file: File | null, resolvedMime?: string): boolean {
  if (!file) return false;
  const mime = resolvedMime || inferMimeType(file);
  return mime === 'application/pdf' || getFileExtension(file.name) === 'pdf';
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function isTextLikeMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-yaml' ||
    mime === DOCX_MIME
  );
}

async function inflateDeflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser does not support DecompressionStream for .docx extraction.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const safeCopy = new Uint8Array(compressed.byteLength);
  safeCopy.set(compressed);
  await writer.write(safeCopy);
  await writer.close();
  const decompressed = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(decompressed);
}

/**
 * Lightweight zero-dependency .docx text extractor using Central Directory ZIP headers
 * and native Web DecompressionStream.
 */
export async function extractDocxText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate End of Central Directory (0x06054b50) near end of file
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid or corrupted .docx archive.');
  }

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const decoder = new TextDecoder('utf-8');

  let cursor = cdOffset;
  let documentXml = '';

  for (let entryIdx = 0; entryIdx < totalEntries && cursor + 46 <= bytes.length; entryIdx++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const entryName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (entryName === 'word/document.xml') {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error('Corrupted .docx entry header.');
      }
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const rawData = bytes.subarray(dataStart, dataStart + compressedSize);

      let xmlBytes: Uint8Array;
      if (method === 0) {
        xmlBytes = rawData;
      } else if (method === 8) {
        xmlBytes = await inflateDeflateRaw(rawData);
      } else {
        throw new Error(`Unsupported .docx compression method (${method}). Please export as PDF.`);
      }
      documentXml = decoder.decode(xmlBytes);
      break;
    }
  }

  if (!documentXml) {
    throw new Error('Could not find document body inside .docx file.');
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(documentXml, 'application/xml');
  const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));
  if (paragraphs.length === 0) {
    // Fallback strip tags
    return documentXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const lines: string[] = [];
  for (const p of paragraphs) {
    const textNodes = Array.from(p.getElementsByTagName('w:t'));
    const lineText = textNodes.map((n) => n.textContent || '').join('');
    if (lineText.trim().length > 0) {
      lines.push(lineText);
    }
  }

  const output = lines.join('\n').trim();
  if (!output) {
    throw new Error('The .docx document appears empty or contains only embedded images. Export to PDF for visual grading.');
  }
  return output;
}

export async function readDocumentAsText(file: File, resolvedMime: string): Promise<string> {
  if (resolvedMime === DOCX_MIME || getFileExtension(file.name) === 'docx') {
    return extractDocxText(file);
  }

  // Guard against accidental binary reading as text
  const headBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  let nulCount = 0;
  for (let i = 0; i < headBytes.length; i++) {
    if (headBytes[i] === 0) nulCount++;
  }
  if (nulCount > 4) {
    throw new Error(
      `Unsupported binary file format (${file.name}). Please upload a PDF, PNG/JPG/WebP image, DOCX, or plain text file.`
    );
  }

  const text = await file.text();
  if (resolvedMime === 'application/json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read file "${file.name}".`));
  });
}

const GEMINI_NATIVE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);

/**
 * Optimizes huge camera scans (>2.5MB) or non-standard raster formats (BMP/GIF/SVG)
 * into a crisp JPEG/PNG so Gemini Vision API payloads stay fast and within limits.
 */
export async function optimizeImageForApi(
  file: File,
  resolvedMime: string
): Promise<{ mimeType: string; data: string }> {
  const MAX_DIRECT_BYTES = 2.5 * 1024 * 1024;
  const needsFormatConversion = !GEMINI_NATIVE_IMAGE_MIMES.has(resolvedMime);

  if (!needsFormatConversion && file.size <= MAX_DIRECT_BYTES) {
    return { mimeType: resolvedMime, data: await fileToBase64(file) };
  }

  // Re-encode via canvas when format needs conversion or file is oversized
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const MAX_DIM = 2400;
        let targetW = img.naturalWidth || 1200;
        let targetH = img.naturalHeight || 1600;
        if (targetW > MAX_DIM || targetH > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / targetW, MAX_DIM / targetH);
          targetW = Math.round(targetW * ratio);
          targetH = Math.round(targetH * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable.');

        // White background handles transparent PNG/SVG cleanly
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        URL.revokeObjectURL(objectUrl);
        resolve({
          mimeType: 'image/jpeg',
          data: dataUrl.split(',')[1] || '',
        });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        if (!needsFormatConversion) {
          try {
            resolve({ mimeType: resolvedMime, data: await fileToBase64(file) });
          } catch (e) {
            reject(e);
          }
        } else {
          reject(err);
        }
      }
    };
    img.onerror = async () => {
      URL.revokeObjectURL(objectUrl);
      if (!needsFormatConversion) {
        try {
          resolve({ mimeType: resolvedMime, data: await fileToBase64(file) });
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Unable to decode image "${file.name}". Try converting to PNG, JPG, or PDF.`));
      }
    };
    img.src = objectUrl;
  });
}
