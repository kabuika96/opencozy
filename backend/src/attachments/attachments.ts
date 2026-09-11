import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const maxAttachmentBytes = 20 * 1024 * 1024;
export const maxMessageAttachments = 10;
export type MessageAttachment = { id: string; name: string; size: number; mediaType: string };
export type HarnessAttachment = MessageAttachment & { path: string };
const idPattern = /^[a-f0-9-]{36}$/;

export function publicAttachment({ id, name, size, mediaType }: HarnessAttachment): MessageAttachment {
  return { id, name, size, mediaType };
}

// The client supplies ids, never host paths. Each directory belongs to one Thread.
export class AttachmentStorage {
  constructor(private readonly directory: string) {}

  async save(threadId: string, name: string, bytes: Buffer): Promise<HarnessAttachment> {
    const id = randomUUID();
    const directory = join(this.directory, threadId, id);
    let safeName = name.replace(/[\\/\x00-\x1f\x7f]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "file";
    while (Buffer.byteLength(safeName) > 200) safeName = Array.from(safeName).slice(0, -1).join("");
    const attachment = { id, name: safeName, size: bytes.length, mediaType: imageMediaType(bytes), path: join(directory, safeName) };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(attachment.path, bytes, { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, ".metadata.json"), JSON.stringify(publicAttachment(attachment)), { flag: "wx", mode: 0o600 });
      return attachment;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async get(threadId: string, id: string): Promise<HarnessAttachment | null> {
    if (!idPattern.test(id)) return null;
    try {
      const directory = join(this.directory, threadId, id);
      const metadata = JSON.parse(await readFile(join(directory, ".metadata.json"), "utf8")) as MessageAttachment;
      return { ...metadata, path: join(directory, metadata.name) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

function imageMediaType(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}
