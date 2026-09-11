import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ZoomSurface } from './ZoomSurface';
// Keep both halves on the compatibility build for Safari engines without new Map APIs.
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfViewer({ url }: { url: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const task = getDocument({ url });
    let active = true;
    setError(null); setDocument(null);
    void task.promise.then(pdf => { if (active) { setDocument(pdf); setPage(1); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; void task.destroy(); };
  }, [url]);
  useEffect(() => {
    let active = true; setPdfPage(null);
    void document?.getPage(page).then(value => { if (active) setPdfPage(value); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [document, page]);
  const bounds = pdfPage?.getViewport({ scale: 1 });
  return <div className="lh-pdf-viewer">
    {error ? <p role="alert">Could not render PDF: {error}. Try downloading it.</p> : !document ? <p role="status">Loading PDF…</p> : <>
      <nav aria-label="PDF pages">
        <button aria-label="Previous" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={20} /></button>
        <span aria-live="polite">{page} / {document.numPages}</span>
        <button aria-label="Next" disabled={page === document.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={20} /></button>
      </nav>
      {pdfPage && bounds ? <ZoomSurface label="PDF gestures" fit="width" aspectRatio={bounds.width / bounds.height} resetKey={`${url}:${page}`}
        onSwipe={direction => setPage(value => Math.max(1, Math.min(document.numPages, value + (direction === 'next' ? 1 : -1))))}>
        {size => <div className="lh-pdf-page"><PdfCanvas page={pdfPage} pageNumber={page} {...size} onError={setError} /></div>}
      </ZoomSurface> : <p role="status">Loading page…</p>}
    </>}
  </div>;
}

function PdfCanvas({ page, pageNumber, width, height, renderScale, onError }: {
  page: PDFPageProxy; pageNumber: number; width: number; height: number; renderScale: number; onError(error: string): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    // Transform the existing bitmap during a gesture. Render a sharper replacement
    // only once it settles, offscreen, keeping canvas allocation bounded on phones.
    const density = Math.min((window.devicePixelRatio || 1) * renderScale, Math.sqrt(8_000_000 / (width * height)));
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width * density });
    const buffer = window.document.createElement('canvas');
    buffer.width = Math.ceil(viewport.width); buffer.height = Math.ceil(viewport.height);
    const task = page.render({ canvas: buffer, viewport });
    void task.promise.then(() => {
      if (!active || !canvas.current) return;
      canvas.current.width = buffer.width; canvas.current.height = buffer.height;
      canvas.current.getContext('2d')!.drawImage(buffer, 0, 0);
    }).catch(error => { if (active && error.name !== 'RenderingCancelledException') onError(error.message); });
    return () => { active = false; task.cancel(); };
  }, [page, width, height, renderScale, onError]);
  return <canvas ref={canvas} style={{ width, height }} aria-label={`PDF page ${pageNumber}`} role="img" />;
}
