import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share, X } from 'lucide-react';
import { fetchAssetAccess, type FileAsset } from '../api';
import { fileSize } from '../attachments/useAttachmentDrafts';
import { useAssetDialog } from './useAssetDialog';

// Files must be materialized before the tap that invokes the native share sheet.
// Fetching inside that tap can outlive Safari's transient user activation.
const maxShareBytes = 250 * 1024 * 1024;

export function AssetShareButton({ assets, label }: { assets: FileAsset[]; label: string }) {
  const [selection, setSelection] = useState<FileAsset[] | null>(null);
  return <>
    <button className="lh-asset-share-button" type="button" aria-label={label} onClick={() => setSelection([...assets])}><Share size={20} strokeWidth={1.7} /></button>
    {selection ? <AssetShareDialog assets={selection} onClose={() => setSelection(null)} /> : null}
  </>;
}

function AssetShareDialog({ assets, onClose }: { assets: FileAsset[]; onClose(): void }) {
  const dialog = useAssetDialog();
  const [files, setFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFiles(null); setError(null); setUnsupported(false); setProgress(0);
    void (async () => {
      if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
        setUnsupported(true); return;
      }
      const total = assets.reduce((sum, asset) => sum + asset.size, 0);
      if (total > maxShareBytes) throw new Error('Share up to 250 MiB at once. Open the list to share smaller files individually, or download a file from its preview.');
      const prepared: File[] = [];
      for (const asset of assets) {
        controller.signal.throwIfAborted();
        const access = await fetchAssetAccess(asset.id);
        controller.signal.throwIfAborted();
        const response = await fetch(access.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not prepare ${asset.name}. Try again.`);
        const blob = await response.blob();
        if (blob.size !== asset.size) throw new Error(`Could not load the complete file ${asset.name}. Try again.`);
        prepared.push(new File([blob], asset.name, { type: asset.mediaType || blob.type || 'application/octet-stream' }));
        controller.signal.throwIfAborted();
        setProgress(prepared.length);
      }
      if (!navigator.canShare({ files: prepared })) { setUnsupported(true); return; }
      setFiles(prepared);
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not prepare files. Try again.'); });
    return () => controller.abort();
  }, [assets, attempt]);

  async function share() {
    if (!files || sharing) return;
    setSharing(true); setError(null);
    try {
      // No await before share: this call belongs directly to the user's tap.
      await navigator.share({ files });
      onClose();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') onClose();
      else setError('Sharing could not open or finish. Try Share again, or download from the file preview.');
    } finally { setSharing(false); }
  }

  return createPortal(<dialog ref={dialog} className="lh-asset-share-dialog" aria-label="Share files"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!sharing) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!sharing) onClose(); } }}>
    <header tabIndex={-1}><strong>{assets.length === 1 ? 'Share file' : `Share ${assets.length} files`}</strong><button type="button" aria-label="Close sharing" disabled={sharing} onClick={onClose}><X size={22} /></button></header>
    <p className="lh-share-selection">{assets.length === 1 ? assets[0]!.title : assets.map(asset => asset.title).join(', ')}</p>
    <small>{fileSize(assets.reduce((sum, asset) => sum + asset.size, 0))} · Original {assets.length === 1 ? 'file' : 'files'}</small>
    {unsupported ? <p role="status">Native sharing isn’t available for these files in this browser. Open a file preview and use Download{assets.length > 1 ? ', or try sharing files individually' : ''}.</p>
      : <>
        {error ? <p role="alert">{error}</p> : <p role="status">{files ? 'Ready to share with an app or save to Files.' : `Preparing files… ${progress} of ${assets.length}`}</p>}
        <button className="lh-share-primary" type="button" disabled={sharing || (!files && !error)}
          onClick={() => { if (error && !files) setAttempt(value => value + 1); else void share(); }}>
          {error && !files ? 'Retry' : sharing ? 'Sharing…' : assets.length === 1 ? 'Share file' : `Share ${assets.length} files`}
        </button>
      </>}
  </dialog>, document.body);
}
