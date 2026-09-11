import { useState } from "react";
import { Paperclip } from "lucide-react";
import { downloadAttachment, type MessageAttachment } from "../api";
import { fileSize } from "./useAttachmentDrafts";

export function MessageAttachments({ threadId, value }: { threadId: string; value: unknown }) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  if (!Array.isArray(value)) return null;
  const files = value.filter((file): file is MessageAttachment => Boolean(file && typeof file.id === "string" && typeof file.name === "string" && typeof file.size === "number"));
  if (!files.length) return null;
  return <>
    <ul className="lh-message-attachments" aria-label="Message files">{files.map(file => <li key={file.id}>
      <button type="button" disabled={downloading} onClick={async () => {
        setError(null); setDownloading(true);
        try { await downloadAttachment(threadId, file); } catch (error) { setError(error instanceof Error ? error.message : "Download failed"); }
        finally { setDownloading(false); }
      }}><Paperclip aria-hidden="true" size={14} /><span>{file.name}</span><small>{fileSize(file.size)}</small></button>
    </li>)}</ul>
    {error ? <small role="alert">{error}</small> : null}
  </>;
}
