import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import { fetchAssetAccess, fetchFileAsset, type FileAsset } from '../api';
import { fileSize } from '../attachments/useAttachmentDrafts';
import ImageViewer from './ImageViewer';
import { AssetShareButton } from './AssetShareButton';
import { useAssetDialog } from './useAssetDialog';
import { isolatedHtml } from './htmlPreview';
const PdfViewer = lazy(() => import('./PdfViewer'));
const maxTextPreview = 4 * 1024 * 1024;

export default function FileAssetViewer({ asset: original, onClose }: { asset: FileAsset; onClose(): void }) {
  const dialog = useAssetDialog();
  const headerDrag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [textSize, setTextSize] = useState(16);
  const [htmlZoom, setHtmlZoom] = useState(1);
  const [asset, setAsset] = useState(original);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError(null); setUrl(null); setText(null);
    void (async () => {
      const [metadata, access] = await Promise.all([fetchFileAsset(original.id), fetchAssetAccess(original.id)]);
      if (!active) return;
      setAsset(metadata); setUrl(access.url);
      if (metadata.kind === 'text' || metadata.kind === 'html') {
        const response = await fetch(access.url, { signal: controller.signal, headers: { Range: `bytes=0-${maxTextPreview - 1}` } });
        if (!response.ok && metadata.size !== 0) throw new Error('Could not load file content');
        const content = metadata.size === 0 ? '' : await response.text();
        if (active) setText(content);
      }
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not open this file'); });
    return () => { active = false; controller.abort(); };
  }, [original.id, revision]);
  return createPortal(<dialog ref={dialog} className="lh-asset-viewer" aria-label={`File preview: ${asset.title}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="lh-asset-viewer-header" tabIndex={-1}><div className="lh-asset-viewer-heading" role="group" aria-label="Swipe down to close preview"
      onPointerDown={event => { if (!event.isPrimary) { headerDrag.current = null; return; } headerDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerUp={event => { const start = headerDrag.current; headerDrag.current = null; if (start?.id === event.pointerId && event.clientY - start.y > 90 && Math.abs(event.clientX - start.x) < (event.clientY - start.y) * .65) onClose(); }}
      onPointerCancel={() => { headerDrag.current = null; }}><strong>{asset.title}</strong><small>{asset.name} · {fileSize(asset.size)}</small></div>
      <AssetShareButton assets={[asset]} label="Share file" />
      {url ? <a href={`${url}&download=1`} download={asset.name} aria-label="Download file"><Download size={20} /></a> : null}
      <button type="button" aria-label="Close file preview" onClick={onClose}><X size={22} /></button>
    </header>
    {asset.source?.type === 'openwrite' ? <details className="lh-asset-source" aria-label="OpenWrite record source">
      <summary>OpenWrite · {asset.source.status} when shared</summary>
      <span>Snapshot from {new Date(asset.source.capturedAt).toLocaleString()} · revision {asset.source.revision}</span>
      {asset.source.statusReason ? <span>{asset.source.statusReason}</span> : null}
      <span>OpenWrite manages this record. Ask for the latest record to check for changes.</span>
    </details> : null}
    {asset.kind === 'text' ? <div className="lh-reading-controls" role="toolbar" aria-label="Text size">
      <button aria-label="Smaller text" disabled={textSize <= 14} onClick={() => setTextSize(value => value - 2)}>A−</button>
      <span>{textSize}px</span>
      <button aria-label="Larger text" disabled={textSize >= 24} onClick={() => setTextSize(value => value + 2)}>A+</button>
    </div> : asset.kind === 'html' ? <div className="lh-reading-controls" role="toolbar" aria-label="HTML zoom">
      <button aria-label="Zoom out" disabled={htmlZoom <= 1} onClick={() => setHtmlZoom(value => value - .25)}>−</button>
      <output aria-label="Zoom level">{Math.round(htmlZoom * 100)}%</output>
      <button aria-label="Zoom in" disabled={htmlZoom >= 2} onClick={() => setHtmlZoom(value => value + .25)}>+</button>
    </div> : null}
    <main className={`lh-asset-viewer-content${['pdf', 'image', 'html'].includes(asset.kind) ? ' lh-asset-canvas-content' : ''}`}>
      {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry preview</button></div> : !url ? <p role="status">Loading file…</p> : <>
        {asset.kind === 'image' ? <ImageViewer url={url} alt={asset.description || asset.title} onError={() => setError('This image format could not be displayed. You can still download the file.')} /> : null}
        {asset.kind === 'video' ? <video controls playsInline preload="metadata" src={url} onError={() => setError('This video codec is not supported by your browser. Download the file to open it in another player.')} /> : null}
        {asset.kind === 'audio' ? <audio controls preload="metadata" src={url} onError={() => setError('This audio codec is not supported by your browser. Download the file to open it in another player.')} /> : null}
        {asset.kind === 'pdf' ? <Suspense fallback={<p role="status">Loading PDF…</p>}><PdfViewer url={url} /></Suspense> : null}
        {asset.kind === 'text' ? text === null ? <p role="status">Loading text…</p> : <pre className="lh-asset-text" style={{ fontSize: textSize }}>{text}</pre> : null}
        {asset.kind === 'html' ? text === null ? <p role="status">Loading HTML…</p> : <div className="lh-html-frame"><iframe className="lh-asset-html" title={asset.title} sandbox="" referrerPolicy="no-referrer" style={{ width: `${100 / htmlZoom}%`, height: `${100 / htmlZoom}%`, transform: `scale(${htmlZoom})`, transformOrigin: '0 0' }} srcDoc={isolatedHtml(text)} /></div> : null}
        {asset.kind === 'file' ? <p>This format is available to download.</p> : null}
        {(asset.kind === 'text' || asset.kind === 'html') && asset.size > maxTextPreview ? <p className="lh-asset-note">Showing the first 4 MiB. Download for the complete file.</p> : null}
      </>}
    </main>
  </dialog>, document.body);
}
