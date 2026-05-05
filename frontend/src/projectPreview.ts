import type { WiredPreview } from "./types";

export function hasPublishedPreviewTarget(preview: WiredPreview): boolean {
  return preview.publishedOrigins.some((origin) => (
    origin.source === "target" && origin.status === "published" && Boolean(origin.publishedUrl)
  ));
}

export function isBrowserLocalPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost"
      || hostname === "0.0.0.0"
      || hostname === "::1"
      || hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

export function previewNeedsPublishedTarget(preview: WiredPreview): boolean {
  return !hasPublishedPreviewTarget(preview) && (
    preview.requestedPublishedOrigins.length > 0 || isBrowserLocalPreviewUrl(preview.target.url)
  );
}

export function canOpenWiredPreviewFrame(preview: WiredPreview): boolean {
  return hasPublishedPreviewTarget(preview) || !isBrowserLocalPreviewUrl(preview.target.url);
}

export function readWiredPreviewOpenUrl(preview: WiredPreview): string {
  return preview.publishedOrigins.find((origin) => (
    origin.source === "target" && origin.status === "published" && origin.publishedUrl
  ))?.publishedUrl ?? preview.target.url;
}

export function orderPreviewsWithAttachedFirst(previews: WiredPreview[], attachedPreview: WiredPreview | null): WiredPreview[] {
  if (!attachedPreview) {
    return previews;
  }

  return [
    attachedPreview,
    ...previews.filter((preview) => preview.id !== attachedPreview.id)
  ];
}
