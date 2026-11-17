import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore Vite ?url asset import
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Ensure Promise.withResolvers exists before pdf.mjs uses it on older browsers/WebViews
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Configure the PDF.js worker once globally
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export function formatPdfLoadError(err: unknown): string {
  const errObj = err as { name?: string; message?: string };
  const name = errObj?.name || '';
  const msg = errObj?.message || '';

  if (name === 'PasswordException' || /password/i.test(msg)) {
    return 'This PDF is password-protected. Please unlock or print it to an unprotected PDF and try again.';
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(msg)) {
    return 'This file is not a valid or complete PDF document.';
  }
  if (/missing pdf|unexpected server response|fetch/i.test(msg)) {
    return 'Could not load PDF data. Please re-upload the file and try again.';
  }
  return msg ? `Failed to load PDF: ${msg}` : 'Failed to load PDF document.';
}

export async function loadPdfDocument(
  source: Uint8Array | string
): Promise<pdfjsLib.PDFDocumentProxy> {
  const params =
    typeof source === 'string'
      ? {
          url: source,
          isEvalSupported: false,
          useSystemFonts: true,
        }
      : {
          data: source,
          isEvalSupported: false,
          useSystemFonts: true,
        };

  try {
    const task = pdfjsLib.getDocument(params);
    const doc = await task.promise;
    if (!doc || doc.numPages < 1) {
      throw new Error('PDF contains 0 pages.');
    }
    return doc;
  } catch (err) {
    throw new Error(formatPdfLoadError(err));
  }
}

export { pdfjsLib };
