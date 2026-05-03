type TerminalOutputDrainOptions = {
  afterWrite: () => void;
  onFirstPaint?: () => void;
  requestFrame: (callback: () => void) => number;
  write: (data: string, callback: () => void) => void;
  writeChunkSize: number;
};

type TerminalOutputDrain = {
  dispose: () => void;
  write: (data: string) => void;
};

export function createTerminalOutputDrain({
  afterWrite,
  onFirstPaint,
  requestFrame,
  write,
  writeChunkSize
}: TerminalOutputDrainOptions): TerminalOutputDrain {
  let disposed = false;
  let hasPainted = false;
  let pendingOutput = "";
  let writingOutput = false;

  const markFirstPaint = () => {
    if (hasPainted) {
      return;
    }

    hasPainted = true;
    onFirstPaint?.();
  };

  const drain = () => {
    if (disposed) {
      return;
    }

    const chunk = pendingOutput.slice(0, writeChunkSize);
    pendingOutput = pendingOutput.slice(chunk.length);
    if (!chunk) {
      writingOutput = false;
      afterWrite();
      return;
    }

    writingOutput = true;
    write(chunk, () => {
      if (disposed) {
        return;
      }

      afterWrite();
      markFirstPaint();
      requestFrame(drain);
    });
  };

  return {
    dispose: () => {
      disposed = true;
      pendingOutput = "";
      writingOutput = false;
    },
    write: (data: string) => {
      if (!data) {
        return;
      }

      pendingOutput += data;
      if (!writingOutput) {
        drain();
      }
    }
  };
}
