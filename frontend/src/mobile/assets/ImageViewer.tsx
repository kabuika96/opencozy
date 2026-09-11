import { useState } from 'react';
import { ZoomSurface } from './ZoomSurface';
export default function ImageViewer({ url, alt, onError }: { url: string; alt: string; onError(): void }) {
  const [aspectRatio, setAspectRatio] = useState(1);
  return <ZoomSurface label="Image gestures" aspectRatio={aspectRatio} resetKey={url}>
    {() => <img className="lh-asset-image" src={url} alt={alt} draggable={false} onLoad={event => setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || 1)} onError={onError} />}
  </ZoomSurface>;
}
