import { useEffect, useRef, useState } from "react";
import { uploadAttachment, type MessageAttachment } from "../api";

export type AttachmentDraft = {
  key: string;
  name: string;
  size: number;
  attachment?: MessageAttachment;
  file?: File;
  error?: string;
};
const storageKey = "liteharness.attachmentDrafts.v1";
const maxFiles = 10;
const maxBytes = 20 * 1024 * 1024;

export function useAttachmentDrafts() {
  const [drafts, setDrafts] = useState<Record<string, AttachmentDraft[]>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { return {}; }
  });
  const current = useRef(drafts);
  function update(change: (value: typeof drafts) => typeof drafts) {
    current.current = change(current.current);
    setDrafts(current.current);
    // Only completed uploads can survive a reload; File objects stay in memory.
    const saved = Object.fromEntries(Object.entries(current.current).map(([key, files]) => [key, files.filter(file => file.attachment).map(({ file: _file, ...rest }) => rest)]));
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* In-memory drafts still work. */ }
  }
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => { for (const controller of controllers.current.values()) controller.abort(); }, []);

  async function upload(draftKey: string, threadId: string, draft: AttachmentDraft) {
    if (!draft.file) return;
    const controller = new AbortController();
    controllers.current.set(draft.key, controller);
    update(value => ({ ...value, [draftKey]: (value[draftKey] ?? []).map(file => file.key === draft.key ? { ...file, error: undefined } : file) }));
    try {
      const attachment = await uploadAttachment(threadId, draft.file, controller.signal);
      update(value => ({ ...value, [draftKey]: (value[draftKey] ?? []).map(file => file.key === draft.key ? { key: file.key, name: attachment.name, size: attachment.size, attachment } : file) }));
    } catch (error) {
      if (!controller.signal.aborted) update(value => ({ ...value, [draftKey]: (value[draftKey] ?? []).map(file => file.key === draft.key ? { ...file, error: error instanceof Error ? error.message : "Upload failed" } : file) }));
    } finally { controllers.current.delete(draft.key); }
  }
  return {
    drafts,
    add(draftKey: string, threadId: string, files: File[]) {
      if ((current.current[draftKey]?.length ?? 0) + files.length > maxFiles) throw new Error("Attach up to 10 files per message.");
      if (files.some(file => file.size > maxBytes)) throw new Error("Each file must be 20 MiB or smaller.");
      const next = files.map(file => ({ key: crypto.randomUUID(), name: file.name, size: file.size, file }));
      update(value => ({ ...value, [draftKey]: [...(value[draftKey] ?? []), ...next] }));
      for (const file of next) void upload(draftKey, threadId, file);
    },
    retry: upload,
    remove(draftKey: string, key: string) {
      controllers.current.get(key)?.abort();
      update(value => ({ ...value, [draftKey]: (value[draftKey] ?? []).filter(file => file.key !== key) }));
    },
    take(draftKey: string) {
      const files = current.current[draftKey] ?? [];
      update(value => ({ ...value, [draftKey]: [] }));
      return files;
    },
    restore(draftKey: string, files: AttachmentDraft[]) {
      update(value => ({ ...value, [draftKey]: [...files, ...(value[draftKey] ?? [])] }));
    },
  };
}

export function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
