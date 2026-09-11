import { lazy, Suspense, useEffect, useState } from 'react';
import { FileText, Image, Film, Music, File, Layers, X } from 'lucide-react';
import { fetchAssetAccess, type FileAsset } from '../api';
import { fileSize } from '../attachments/useAttachmentDrafts';
import './assets.css';
import { createPortal } from 'react-dom';
import { asFileAsset } from './fileAsset';
import { AssetShareButton } from './AssetShareButton';
import { useAssetDialog } from './useAssetDialog';
const AssetViewer = lazy(() => import('./FileAssetViewer'));

export function FileAssetCard({ value, assets: grouped }: { value?: unknown; assets?: FileAsset[] }) {
  const [selected, setSelected] = useState<FileAsset | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const fallback = asFileAsset(value);
  const assets = grouped ?? (fallback ? [fallback] : []);
  if (!assets.length) return null;
  const first = assets[0]!;
  return <article className={`lh-file-asset${assets.length > 1 ? ' lh-file-stack' : ''}`}>
    <AssetTile asset={first} stack={assets.length > 1 ? assets : undefined} onOpen={() => {
      if (assets.length > 1) setListOpen(true); else setSelected(first);
    }} />
    {listOpen ? <AssetList assets={assets} onSelect={setSelected} onClose={() => setListOpen(false)} /> : null}
    {selected ? <Suspense fallback={<small role="status">Opening file…</small>}><AssetViewer asset={selected} onClose={() => setSelected(null)} /></Suspense> : null}
  </article>;
}

function AssetTile({ asset, stack, onOpen }: { asset: FileAsset; stack?: FileAsset[]; onOpen(): void }) {
  const Icon = stack ? Layers : asset.kind === 'image' ? Image : asset.kind === 'video' ? Film : asset.kind === 'audio' ? Music : asset.kind === 'file' ? File : FileText;
  return <div className="lh-asset-card-frame">
    <button className="lh-asset-card" type="button" aria-label={stack ? `Open ${stack.length} files` : `Open file: ${asset.title}`} onClick={onOpen}>
      {!stack && asset.kind === 'image' ? <ImageThumbnail asset={asset} /> : <Icon aria-hidden="true" size={28} strokeWidth={1.5} />}
      {stack ? <span className="lh-asset-card-copy"><strong>{stack.length} files</strong><span>{stack.map(value => value.title).join(', ')}</span><small>Tap to view all · {fileSize(stack.reduce((sum, value) => sum + value.size, 0))}</small></span> :
      <span className="lh-asset-card-copy"><strong>{asset.title}</strong><span>{asset.description || asset.name}</span>{asset.source?.type === 'openwrite' ? <small>OpenWrite · {asset.source.status} when shared</small> : null}<small>{asset.kind.toUpperCase()} · {fileSize(asset.size)} · Tap to view</small></span>}
    </button>
    <AssetShareButton assets={stack ?? [asset]} label={stack ? `Share all ${stack.length} files` : `Share file: ${asset.title}`} />
  </div>;
}

function AssetList({ assets, onSelect, onClose }: { assets: FileAsset[]; onSelect(asset: FileAsset): void; onClose(): void }) {
  const dialog = useAssetDialog();
  return createPortal(<dialog ref={dialog} className="lh-asset-viewer" aria-label="File list"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="lh-asset-viewer-header" tabIndex={-1}><div><strong>{assets.length} files</strong><small>Tap a file to preview</small></div>
      <AssetShareButton assets={assets} label={`Share all ${assets.length} files`} />
      <button type="button" aria-label="Close file list" onClick={onClose}><X size={22} /></button>
    </header>
    <ul className="lh-asset-viewer-content lh-asset-list">{assets.map(asset => <li key={asset.id}><AssetTile asset={asset} onOpen={() => onSelect(asset)} /></li>)}</ul>
  </dialog>, document.body);
}
function ImageThumbnail({ asset }: { asset: FileAsset }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let active = true; void fetchAssetAccess(asset.id).then(access => { if (active) setUrl(access.url); }).catch(() => {}); return () => { active = false; }; }, [asset.id]);
  return url ? <img className="lh-asset-thumbnail" src={url} alt="" onError={() => setUrl(null)} /> : <Image aria-hidden="true" size={28} strokeWidth={1.5} />;
}
