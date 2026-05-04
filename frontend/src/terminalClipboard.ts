export function normalizeTerminalInput(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
}

export function normalizeTerminalCopyText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

type ClipboardTextarea = {
  value: string;
  style: Record<string, string>;
  select: () => void;
  setAttribute: (name: string, value: string) => void;
  setSelectionRange: (start: number, end: number) => void;
};

type ClipboardDocument = {
  body?: {
    appendChild: (node: ClipboardTextarea) => unknown;
    removeChild: (node: ClipboardTextarea) => unknown;
  };
  createElement?: (tagName: "textarea") => ClipboardTextarea;
  execCommand?: (command: "copy") => boolean;
};

type ClipboardEnvironment = {
  document?: ClipboardDocument | null;
  navigator?: {
    clipboard?: ClipboardWriter | null;
  } | null;
};

function writeTextThroughSelection(text: string, document: ClipboardDocument | null | undefined): boolean {
  const body = document?.body;
  const textarea = document?.createElement?.("textarea");
  if (!body || !textarea || !document?.execCommand) {
    return false;
  }

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0.01";

  body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } finally {
    body.removeChild(textarea);
  }
}

export async function writeTerminalClipboardText(
  value: string,
  environment: ClipboardEnvironment = globalThis as ClipboardEnvironment
): Promise<boolean> {
  const text = normalizeTerminalCopyText(value);
  if (!text) {
    return false;
  }

  try {
    await environment.navigator?.clipboard?.writeText(text);
    if (environment.navigator?.clipboard) {
      return true;
    }
  } catch {
    // Fall back to a selected textarea for iOS/Safari and non-secure LAN origins.
  }

  return writeTextThroughSelection(text, environment.document);
}
