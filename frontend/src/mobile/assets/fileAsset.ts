import type { FileAsset } from '../api';

export function asFileAsset(value: unknown): FileAsset | null {
  if (!value || typeof value !== 'object') return null;
  const asset = value as FileAsset;
  return typeof asset.id === 'string' && typeof asset.title === 'string' && typeof asset.name === 'string'
    && ['text', 'html', 'pdf', 'image', 'video', 'audio', 'file'].includes(asset.kind) ? asset : null;
}
