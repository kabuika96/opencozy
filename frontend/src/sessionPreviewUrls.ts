const GLOBAL_PREVIEW_URL_KEY = "opencozy.previewUrl";
const SESSION_PREVIEW_URL_KEY_PREFIX = `${GLOBAL_PREVIEW_URL_KEY}.session.`;

type PreviewStorageReader = Pick<Storage, "getItem">;
type PreviewStorageWriter = Pick<Storage, "removeItem" | "setItem">;

export function defaultPreviewUrl(): string {
  return "";
}

export function normalizePreviewUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Preview URL is required.");
  }

  const url = new URL(/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Preview URL must use http or https.");
  }

  return url.href;
}

export function sessionPreviewUrlKey(sessionId: string): string {
  return `${SESSION_PREVIEW_URL_KEY_PREFIX}${encodeURIComponent(sessionId)}`;
}

export function readSessionPreviewUrl(storage: PreviewStorageReader, sessionId: string | null): string {
  if (!sessionId) {
    return storage.getItem(GLOBAL_PREVIEW_URL_KEY) || defaultPreviewUrl();
  }

  return storage.getItem(sessionPreviewUrlKey(sessionId)) || defaultPreviewUrl();
}

export function writeSessionPreviewUrl(storage: PreviewStorageWriter, sessionId: string | null, url: string): void {
  storage.setItem(sessionId ? sessionPreviewUrlKey(sessionId) : GLOBAL_PREVIEW_URL_KEY, url);
}

export function removeSessionPreviewUrl(storage: PreviewStorageWriter, sessionId: string): void {
  storage.removeItem(sessionPreviewUrlKey(sessionId));
}
