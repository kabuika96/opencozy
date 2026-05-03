export type TerminalBufferLineLike = {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
};

export type TerminalBufferLike = {
  length: number;
  getLine(index: number): TerminalBufferLineLike | undefined;
};

export function readTerminalBufferText(buffer: TerminalBufferLike): string {
  const chunks: string[] = [];

  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (!line) {
      continue;
    }

    if (chunks.length > 0 && !line.isWrapped) {
      chunks.push("\n");
    }

    const nextLine = index + 1 < buffer.length ? buffer.getLine(index + 1) : undefined;
    chunks.push(line.translateToString(!nextLine?.isWrapped));
  }

  return chunks.join("").trimEnd();
}

export function normalizeTerminalInput(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
}
