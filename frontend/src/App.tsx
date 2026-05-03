import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Check,
  ExternalLink,
  Feather,
  List,
  Menu,
  Plus,
  Save,
  SendHorizontal,
  Square,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import {
  closeOpenCozySession,
  createApp,
  createOpenCozySession,
  deleteApp,
  getCodexCapabilities,
  listApps,
  listOpenCozySessions,
  updateApp,
  updateOpenCozySession
} from "./api";
import { buildLaunchUrl, normalizeAppPath } from "./appUrls";
import { bindKeyboardReserve } from "./keyboardReserve";
import { bindOuterScrollLock } from "./outerScrollLock";
import { getSessionLoadingCopy, type SessionLoadingCopy, type SessionLoadingPhase } from "./sessionLoading";
import { normalizeTerminalInput } from "./terminalClipboard";
import { bindTerminalTouchScroll } from "./terminalTouchScroll";
import { getTerminalVisualCursorStyle } from "./terminalVisualCursor";
import type {
  AppShortcut,
  AppShortcutInput,
  OpenCozySessionMode,
  ShortcutProtocol,
  OpenCozySessionSummary
} from "./types";

type AppForm = {
  id: string | null;
  name: string;
  protocol: ShortcutProtocol;
  host: string;
  port: string;
  path: string;
};

type Overlay = "addApp" | "editSessionTitle" | "openApp" | null;
type TerminalPhase = Exclude<SessionLoadingPhase, "initializing"> | "ready";

type TerminalMessage =
  | { type: "output"; data: string }
  | { type: "status"; session: OpenCozySessionSummary }
  | { type: "exit"; exitCode: number };

const LAST_SESSION_KEY = "opencozy.lastOpenCozySessionId";
const DEVICE_ID_KEY = "opencozy.deviceId";
const LAST_CODEX_THREAD_KEY = "opencozy.lastCodexThreadId";
const SESSION_NAME_MAX_LENGTH = 80;
const TERMINAL_WRITE_CHUNK_SIZE = 32_000;
const ARROW_KEYS = {
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D"
};
const TERMINAL_KEYS = {
  enter: "\r",
  escape: "\u001b",
  tab: "\t",
  interrupt: "\u0003"
};

function ctrlKeyData(key: string): string | null {
  if (key.length !== 1) {
    return null;
  }

  const code = key.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) {
    return null;
  }

  return String.fromCharCode(code - 64);
}

const defaultForm = (): AppForm => ({
  id: null,
  name: "",
  protocol: "http",
  host: window.location.hostname || "127.0.0.1",
  port: "5173",
  path: "/"
});

function createDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getDeviceId(): string {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const deviceId = createDeviceId();
  window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function rememberSession(session: OpenCozySessionSummary): void {
  window.localStorage.setItem(LAST_SESSION_KEY, session.id);
  if (session.codexThreadId) {
    window.localStorage.setItem(LAST_CODEX_THREAD_KEY, session.codexThreadId);
  }
}

function toAppInput(form: AppForm): AppShortcutInput {
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be 1 to 65535");
  }

  return {
    name: form.name.trim(),
    protocol: form.protocol,
    host: form.host.trim(),
    port,
    path: normalizeAppPath(form.path)
  };
}

function wsUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/open-cozy-sessions/${sessionId}/socket`;
}

async function readTextFromClipboard(): Promise<string | null> {
  if (!navigator.clipboard?.readText) {
    return null;
  }

  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function SessionLoadingState({
  copy,
  overlay = false
}: {
  copy: SessionLoadingCopy;
  overlay?: boolean;
}) {
  return (
    <div className={overlay ? "terminalLoadingState terminalLoadingState--overlay" : "terminalLoadingState"} role="status" aria-live="polite">
      <span className="terminalLoadingSpinner" aria-hidden="true" />
      <span className="terminalLoadingText">
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </span>
    </div>
  );
}

function TerminalPane({
  session,
  onError,
  onSessionUpdate
}: {
  session: OpenCozySessionSummary;
  onError: (message: string) => void;
  onSessionUpdate: (session: OpenCozySessionSummary) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const keyboardInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pasteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const touchLayerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const visualCursorRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const [pasteConfirmOpen, setPasteConfirmOpen] = useState(false);
  const [pastePanelOpen, setPastePanelOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [terminalPhase, setTerminalPhase] = useState<TerminalPhase>("connecting");

  const syncVisualCursor = useCallback(() => {
    const cursor = visualCursorRef.current;
    const element = elementRef.current;
    const terminal = terminalRef.current;
    const screen = element?.querySelector<HTMLElement>(".xterm-screen");
    if (!cursor || !element || !terminal || !screen) {
      return;
    }

    const buffer = terminal.buffer.active;
    const hostRect = element.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const style = getTerminalVisualCursorStyle({
      baseY: buffer.baseY,
      cols: terminal.cols,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      hostLeft: hostRect.left,
      hostTop: hostRect.top,
      rows: terminal.rows,
      screenHeight: screenRect.height,
      screenLeft: screenRect.left,
      screenTop: screenRect.top,
      screenWidth: screenRect.width,
      viewportY: buffer.viewportY
    });

    cursor.style.display = style.display;
    if (style.display === "none") {
      return;
    }

    cursor.style.height = style.height;
    cursor.style.transform = style.transform;
    cursor.style.width = style.width;
  }, []);

  const focusKeyboard = useCallback(() => {
    const terminal = terminalRef.current;
    terminal?.scrollToBottom();
    if (terminal && terminal.rows > 0) {
      terminal.refresh(0, terminal.rows - 1);
    }
    syncVisualCursor();
    keyboardInputRef.current?.focus({ preventScroll: true });
  }, [syncVisualCursor]);

  const sendInput = useCallback((data: string): boolean => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
      return true;
    }
    return false;
  }, []);

  const sendTerminalInput = useCallback((data: string) => {
    if (data && !sendInput(data)) {
      onError("Terminal is not connected.");
    }
  }, [onError, sendInput]);

  const closePastePanel = useCallback(() => {
    setPasteConfirmOpen(false);
    setPastePanelOpen(false);
    setPasteText("");
  }, []);

  const closePasteConfirmation = useCallback(() => {
    setPasteConfirmOpen(false);
  }, []);

  const openPasteConfirmation = useCallback(() => {
    setPasteConfirmOpen(true);
  }, []);

  const handleConfirmPaste = useCallback(async () => {
    setPasteConfirmOpen(false);
    const text = await readTextFromClipboard();
    if (text === null) {
      setPastePanelOpen(true);
      return;
    }

    const data = normalizeTerminalInput(text);
    if (data) {
      sendTerminalInput(data);
      focusKeyboard();
    }
  }, [focusKeyboard, sendTerminalInput]);

  const handleSendManualPaste = useCallback(() => {
    sendTerminalInput(normalizeTerminalInput(pasteText));
    closePastePanel();
    focusKeyboard();
  }, [closePastePanel, focusKeyboard, pasteText, sendTerminalInput]);

  const flushKeyboardInput = useCallback((target: HTMLTextAreaElement) => {
    const data = normalizeTerminalInput(target.value);
    target.value = "";
    if (data) {
      sendInput(data);
    }
  }, [sendInput]);

  const handleKeyboardKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      const data = ctrlKeyData(event.key);
      if (data) {
        event.preventDefault();
        event.currentTarget.value = "";
        sendInput(data);
        return;
      }
    }

    const keyData: Record<string, string> = {
      ArrowDown: ARROW_KEYS.down,
      ArrowLeft: ARROW_KEYS.left,
      ArrowRight: ARROW_KEYS.right,
      ArrowUp: ARROW_KEYS.up,
      Backspace: "\u007f",
      Delete: "\u001b[3~",
      Enter: TERMINAL_KEYS.enter,
      Escape: TERMINAL_KEYS.escape,
      Tab: TERMINAL_KEYS.tab
    };
    const data = keyData[event.key];
    if (!data) {
      return;
    }

    event.preventDefault();
    event.currentTarget.value = "";
    sendInput(data);
  }, [sendInput]);

  const handleKeyboardInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      return;
    }

    flushKeyboardInput(event.currentTarget);
  }, [flushKeyboardInput]);

  useEffect(() => {
    const input = keyboardInputRef.current;
    if (!input) {
      return;
    }

    return bindKeyboardReserve(input);
  }, [session.id]);

  useEffect(() => {
    if (!pasteConfirmOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPasteConfirmOpen(false);
    }, 2600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pasteConfirmOpen]);

  useEffect(() => {
    if (!pastePanelOpen) {
      return;
    }

    const input = pasteInputRef.current;
    if (!input) {
      return;
    }

    const cleanupKeyboardReserve = bindKeyboardReserve(input);
    const focusFrame = window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      cleanupKeyboardReserve();
    };
  }, [pastePanelOpen]);

  useEffect(() => {
    const element = elementRef.current;
    const touchLayer = touchLayerRef.current;
    if (!element || !touchLayer) {
      return;
    }
    setTerminalPhase("connecting");

    const terminal = new Terminal({
      cursorBlink: true,
      cursorInactiveStyle: "block",
      cursorStyle: "block",
      convertEol: true,
      disableStdin: true,
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: "#070a08",
        foreground: "#f1f5ef",
        cursor: "#8fd0a5",
        selectionBackground: "#2f6f58",
        black: "#070a08",
        red: "#e06d5f",
        green: "#8fd0a5",
        yellow: "#d9b95f",
        blue: "#83aee5",
        magenta: "#c096e3",
        cyan: "#7fd1ca",
        white: "#f1f5ef"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    terminalRef.current = terminal;
    let scheduleResize = () => undefined;
    const cleanupTouchScroll = bindTerminalTouchScroll(touchLayer, element);

    let disposed = false;
    let resizeFrame: number | null = null;
    let lastSentCols = 0;
    let lastSentRows = 0;
    let hasOutput = false;
    let pendingTerminalOutput = "";
    let writingTerminalOutput = false;
    const socket = new WebSocket(wsUrl(session.id));
    socketRef.current = socket;
    const terminalInputDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    const refreshTerminal = () => {
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
      syncVisualCursor();
    };

    const drainTerminalOutput = () => {
      if (disposed) {
        return;
      }

      const chunk = pendingTerminalOutput.slice(0, TERMINAL_WRITE_CHUNK_SIZE);
      pendingTerminalOutput = pendingTerminalOutput.slice(chunk.length);
      if (!chunk) {
        writingTerminalOutput = false;
        terminal.scrollToBottom();
        refreshTerminal();
        return;
      }

      writingTerminalOutput = true;
      terminal.write(chunk, () => {
        terminal.scrollToBottom();
        refreshTerminal();
        window.requestAnimationFrame(drainTerminalOutput);
      });
    };

    const writeTerminalOutput = (data: string) => {
      pendingTerminalOutput += data;
      if (!writingTerminalOutput) {
        drainTerminalOutput();
      }
    };

    const scheduleCursorSync = () => {
      window.requestAnimationFrame(syncVisualCursor);
    };

    const cursorMoveDisposable = terminal.onCursorMove(scheduleCursorSync);
    const renderDisposable = terminal.onRender(scheduleCursorSync);
    const scrollDisposable = terminal.onScroll(scheduleCursorSync);
    const writeParsedDisposable = terminal.onWriteParsed(scheduleCursorSync);

    const fitAndSendResize = () => {
      resizeFrame = null;
      if (disposed) {
        return;
      }

      fitAddon.fit();
      refreshTerminal();
      if (socket.readyState === WebSocket.OPEN && (terminal.cols !== lastSentCols || terminal.rows !== lastSentRows)) {
        lastSentCols = terminal.cols;
        lastSentRows = terminal.rows;
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    };

    scheduleResize = () => {
      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = window.requestAnimationFrame(fitAndSendResize);
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(element);

    const restoreTerminalFrame = () => {
      if (disposed) {
        return;
      }

      scheduleResize();
      terminal.scrollToBottom();
      window.requestAnimationFrame(refreshTerminal);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        restoreTerminalFrame();
      }
    };

    window.addEventListener("focus", restoreTerminalFrame);
    window.addEventListener("pageshow", restoreTerminalFrame);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    socket.addEventListener("open", () => {
      if (disposed) {
        return;
      }
      scheduleResize();
      if (!hasOutput) {
        setTerminalPhase("waitingForOutput");
      }
    });
    socket.addEventListener("message", (event) => {
      if (disposed) {
        return;
      }

      const message = JSON.parse(event.data as string) as TerminalMessage;
      if (message.type === "output") {
        if (message.data.length > 0) {
          hasOutput = true;
          setTerminalPhase("ready");
        }
        writeTerminalOutput(message.data);
      }

      if (message.type === "status") {
        onSessionUpdate(message.session);
      }

      if (message.type === "exit") {
        setTerminalPhase("ready");
        writeTerminalOutput(`\r\n[OpenCozy session exited: ${message.exitCode}]\r\n`);
      }
    });
    socket.addEventListener("close", (event) => {
      if (!disposed) {
        setTerminalPhase("ready");
      }
      if (!disposed && event.code !== 1000) {
        terminal.writeln(`\r\n[OpenCozy socket closed: ${event.code || "no code"}]`);
      }
    });

    scheduleResize();
    scheduleCursorSync();

    return () => {
      disposed = true;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      cleanupTouchScroll();
      terminalInputDisposable.dispose();
      cursorMoveDisposable.dispose();
      renderDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      resizeObserver.disconnect();
      window.removeEventListener("focus", restoreTerminalFrame);
      window.removeEventListener("pageshow", restoreTerminalFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(1000, "Terminal pane disposed"), { once: true });
      } else if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "Terminal pane disposed");
      }

      terminal.dispose();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    };
  }, [onSessionUpdate, session.id, syncVisualCursor]);

  return (
    <>
      <div className="terminalOutputFrame">
        <textarea
          ref={keyboardInputRef}
          className="terminalKeyboardInput"
          aria-label="Terminal keyboard input"
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="text"
          rows={1}
          spellCheck={false}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            flushKeyboardInput(event.currentTarget);
          }}
          onInput={handleKeyboardInput}
          onKeyDown={handleKeyboardKeyDown}
        />
        <div className="terminalSurface" ref={elementRef} />
        <div className="terminalVisualCursor" ref={visualCursorRef} aria-hidden="true" />
        {terminalPhase !== "ready" && (
          <SessionLoadingState
            copy={getSessionLoadingCopy(session.mode, terminalPhase)}
            overlay
          />
        )}
        <div className="terminalTouchLayer" ref={touchLayerRef} aria-hidden="true" />
        {pastePanelOpen && (
          <div className="terminalPastePanel" data-opencozy-scrollable="true">
            <textarea
              ref={pasteInputRef}
              className="terminalPasteInput"
              aria-label="Paste terminal input"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Paste"
              spellCheck={false}
              value={pasteText}
              onChange={(event) => setPasteText(event.currentTarget.value)}
            />
            <div className="terminalPasteActions">
              <button type="button" className="terminalControlButton" onMouseDown={(event) => event.preventDefault()} onClick={handleSendManualPaste} disabled={!pasteText} aria-label="Send pasted text">
                <SendHorizontal size={18} />
              </button>
              <button type="button" className="terminalControlButton" onMouseDown={(event) => event.preventDefault()} onClick={closePastePanel} aria-label="Close paste field">
                <X size={18} />
              </button>
            </div>
          </div>
        )}
        <div className="floatingTerminalControls">
          <div className="terminalPasteControl">
            {pasteConfirmOpen && (
              <div className="terminalPasteConfirm" role="group" aria-label="Confirm paste">
                <span>Paste?</span>
                <button type="button" className="terminalControlButton terminalControlButton--small" onMouseDown={(event) => event.preventDefault()} onClick={() => void handleConfirmPaste()} aria-label="Confirm paste">
                  <Check size={16} />
                </button>
                <button type="button" className="terminalControlButton terminalControlButton--small" onMouseDown={(event) => event.preventDefault()} onClick={closePasteConfirmation} aria-label="Cancel paste">
                  <X size={16} />
                </button>
              </div>
            )}
            <button type="button" className="terminalControlButton" onMouseDown={(event) => event.preventDefault()} onClick={openPasteConfirmation} aria-label="Paste to terminal">
              <ClipboardPaste size={18} />
            </button>
          </div>
          <button type="button" className="terminalControlButton bottomFocusButton terminalControlButton--keyboard" onMouseDown={(event) => event.preventDefault()} onClick={focusKeyboard} aria-label="Scroll to bottom and focus input">
            <Feather size={19} />
          </button>
        </div>
        <div className="arrowPad" aria-label="Terminal arrow keys">
          <button type="button" className="arrowPadButton arrowPadUp" onMouseDown={(event) => event.preventDefault()} onClick={() => sendInput(ARROW_KEYS.up)} aria-label="Up">
            <ArrowUp size={19} />
          </button>
          <button type="button" className="arrowPadButton arrowPadLeft" onMouseDown={(event) => event.preventDefault()} onClick={() => sendInput(ARROW_KEYS.left)} aria-label="Left">
            <ArrowLeft size={19} />
          </button>
          <button type="button" className="arrowPadButton arrowPadDown" onMouseDown={(event) => event.preventDefault()} onClick={() => sendInput(ARROW_KEYS.down)} aria-label="Down">
            <ArrowDown size={19} />
          </button>
          <button type="button" className="arrowPadButton arrowPadRight" onMouseDown={(event) => event.preventDefault()} onClick={() => sendInput(ARROW_KEYS.right)} aria-label="Right">
            <ArrowRight size={19} />
          </button>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const shellRef = useRef<HTMLElement | null>(null);
  const [deviceId] = useState(getDeviceId);
  const [sessions, setSessions] = useState<OpenCozySessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppShortcut[]>([]);
  const [form, setForm] = useState<AppForm>(() => defaultForm());
  const [error, setError] = useState<string | null>(null);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingSessionMode, setPendingSessionMode] = useState<OpenCozySessionMode | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const cleanupOuterScroll = bindOuterScrollLock(shell);

    return () => {
      cleanupOuterScroll();
    };
  }, []);

  const refresh = useCallback(async () => {
    const [, sessionResult, appResult] = await Promise.all([
      getCodexCapabilities(),
      listOpenCozySessions(),
      listApps()
    ]);
    setSessions(sessionResult);
    setApps(appResult);

    const lastSessionId = window.localStorage.getItem(LAST_SESSION_KEY);
    if (!activeSessionIdRef.current && lastSessionId && sessionResult.some((session) => session.id === lastSessionId)) {
      setActiveSessionId(lastSessionId);
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    setLoadingInitialData(true);
    refresh()
      .catch((refreshError: unknown) => {
        if (!disposed) {
          setError(refreshError instanceof Error ? refreshError.message : "Failed to load OpenCozy");
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoadingInitialData(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [refresh]);

  const startSession = async (mode: OpenCozySessionMode) => {
    setBusy(true);
    setPendingSessionMode(mode);
    setError(null);
    setMenuOpen(false);
    setOverlay(null);

    try {
      const lastCodexThreadId = mode === "resumeLast" ? window.localStorage.getItem(LAST_CODEX_THREAD_KEY) : null;
      const session = await createOpenCozySession(mode, {
        deviceId,
        ...(lastCodexThreadId ? { codexThreadId: lastCodexThreadId } : {})
      });
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setActiveSessionId(session.id);
      rememberSession(session);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Failed to start Codex");
    } finally {
      setPendingSessionMode(null);
      setBusy(false);
    }
  };

  const openSessionTitleEditor = () => {
    if (!activeSession) {
      return;
    }

    setError(null);
    setMenuOpen(false);
    setSessionTitleDraft(activeSession.name);
    setOverlay("editSessionTitle");
  };

  const saveSessionTitle = async () => {
    if (!activeSession) {
      return;
    }

    const name = sessionTitleDraft.trim();
    if (!name) {
      setError("Session title is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await updateOpenCozySession(activeSession.id, { name });
      setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
      setOverlay(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename session");
    } finally {
      setBusy(false);
    }
  };

  const stopActiveSession = async () => {
    if (!activeSession) {
      return;
    }

    setError(null);
    try {
      await closeOpenCozySession(activeSession.id);
      setSessions((current) => current.filter((session) => session.id !== activeSession.id));
      setActiveSessionId(null);
      window.localStorage.removeItem(LAST_SESSION_KEY);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Failed to stop Codex");
    }
  };

  const handleSessionUpdate = useCallback((updated: OpenCozySessionSummary) => {
    setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
    if (updated.id === activeSessionIdRef.current) {
      rememberSession(updated);
    }
  }, []);

  const editApp = (app: AppShortcut) => {
    setForm({
      id: app.id,
      name: app.name,
      protocol: app.protocol,
      host: app.host,
      port: String(app.port),
      path: app.path
    });
    setOverlay("addApp");
  };

  const saveApp = async () => {
    setError(null);
    try {
      const input = toAppInput(form);
      if (!input.name) {
        throw new Error("Name is required");
      }
      if (!input.host) {
        throw new Error("Host is required");
      }

      const saved = form.id ? await updateApp(form.id, input) : await createApp(input);
      setApps((current) => {
        const next = current.filter((app) => app.id !== saved.id);
        return [...next, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setForm(defaultForm());
      setOverlay("openApp");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save LAN app");
    }
  };

  const removeApp = async (id: string) => {
    setError(null);
    await deleteApp(id);
    setApps((current) => current.filter((app) => app.id !== id));
    if (form.id === id) {
      setForm(defaultForm());
    }
  };

  const openAddApp = () => {
    setMenuOpen(false);
    setForm(defaultForm());
    setOverlay("addApp");
  };

  const openApps = () => {
    setMenuOpen(false);
    setOverlay("openApp");
  };

  return (
    <main className="terminalShell" ref={shellRef}>
      <div className="topFloatingControls" aria-label="OpenCozy controls">
        <div className="menuAnchor">
          <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Menu">
            <Menu size={20} />
          </button>
          {menuOpen && (
            <nav className="actionMenu" aria-label="OpenCozy menu">
              <button type="button" onClick={() => void startSession("new")} disabled={busy}>
                <Plus size={18} />
                <span>Start New</span>
              </button>
              <button type="button" onClick={() => void startSession("resume")} disabled={busy}>
                <List size={18} />
                <span>Sessions</span>
              </button>
              <button type="button" onClick={openAddApp}>
                <Save size={18} />
                <span>Add App</span>
              </button>
              <button type="button" onClick={openApps}>
                <ExternalLink size={18} />
                <span>Open App</span>
              </button>
            </nav>
          )}
        </div>

        <button className="iconButton stopButton" type="button" onClick={() => void stopActiveSession()} disabled={!activeSession} aria-label="Stop session">
          <Square size={16} />
        </button>
      </div>

      {activeSession && (
        <button className="sessionTitleButton" type="button" onClick={openSessionTitleEditor} aria-label="Edit session title">
          <span>{activeSession.name}</span>
        </button>
      )}

      {error && (
        <div className="errorBar">
          <span>{error}</span>
          <button className="iconButton small" type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}

      <section className="terminalViewport" aria-label="Codex terminal">
        {activeSession ? (
          <TerminalPane session={activeSession} onError={setError} onSessionUpdate={handleSessionUpdate} />
        ) : pendingSessionMode ? (
          <SessionLoadingState copy={getSessionLoadingCopy(pendingSessionMode, "initializing")} />
        ) : loadingInitialData ? (
          <SessionLoadingState
            copy={{
              title: "Loading OpenCozy",
              detail: "Restoring active OpenCozy Sessions."
            }}
          />
        ) : (
          <div className="terminalPlaceholder">
            <TerminalSquare size={24} />
            <button type="button" onClick={() => void startSession("new")} disabled={busy}>
              <Plus size={18} />
              <span>Start New</span>
            </button>
          </div>
        )}
      </section>

      {overlay && <button className="scrim" type="button" onClick={() => setOverlay(null)} aria-label="Close panel" />}

      {overlay === "editSessionTitle" && (
        <section className="sheet sessionNameSheet" data-opencozy-scrollable="true" aria-label="Edit OpenCozy session title">
          <header className="sheetHeader">
            <h2>Session Title</h2>
            <button className="iconButton small" type="button" onClick={() => setOverlay(null)} aria-label="Close">
              <X size={17} />
            </button>
          </header>
          <form
            className="sessionNameForm"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSessionTitle();
            }}
          >
            <label className="field">
              <span>Title</span>
              <input
                autoCapitalize="words"
                autoFocus
                maxLength={SESSION_NAME_MAX_LENGTH}
                value={sessionTitleDraft}
                onChange={(event) => setSessionTitleDraft(event.currentTarget.value)}
              />
            </label>
            <button className="primaryButton" type="submit" disabled={busy || !sessionTitleDraft.trim()}>
              <Save size={18} />
              <span>Save</span>
            </button>
          </form>
        </section>
      )}

      {overlay === "addApp" && (
        <section className="sheet" data-opencozy-scrollable="true" aria-label="Add LAN app">
          <header className="sheetHeader">
            <h2>{form.id ? "Edit App" : "Add App"}</h2>
            <button className="iconButton small" type="button" onClick={() => setOverlay(null)} aria-label="Close">
              <X size={17} />
            </button>
          </header>
          <form
            className="appForm"
            onSubmit={(event) => {
              event.preventDefault();
              void saveApp();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="field">
              <span>Protocol</span>
              <select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as ShortcutProtocol })}>
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label className="field">
              <span>Host</span>
              <input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} autoCapitalize="off" autoCorrect="off" />
            </label>
            <label className="field">
              <span>Port</span>
              <input inputMode="numeric" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} />
            </label>
            <label className="field">
              <span>Path</span>
              <input value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} autoCapitalize="off" autoCorrect="off" />
            </label>
            <button className="primaryButton" type="submit">
              <Save size={18} />
              <span>{form.id ? "Save" : "Add"}</span>
            </button>
          </form>
        </section>
      )}

      {overlay === "openApp" && (
        <section className="sheet" data-opencozy-scrollable="true" aria-label="Open LAN app">
          <header className="sheetHeader">
            <h2>Open App</h2>
            <button className="iconButton small" type="button" onClick={() => setOverlay(null)} aria-label="Close">
              <X size={17} />
            </button>
          </header>
          <div className="appGrid">
            {apps.map((app) => (
              <article className="appTile" key={app.id}>
                <div>
                  <h3>{app.name}</h3>
                  <p>{buildLaunchUrl(app)}</p>
                </div>
                <div className="tileActions">
                  <a className="iconButton launch" href={app.url} target="_blank" rel="noreferrer" aria-label={`Open ${app.name}`}>
                    <ExternalLink size={17} />
                  </a>
                  <button className="iconButton" type="button" onClick={() => editApp(app)} aria-label={`Edit ${app.name}`}>
                    <Save size={17} />
                  </button>
                  <button className="iconButton danger" type="button" onClick={() => removeApp(app.id)} aria-label={`Delete ${app.name}`}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
            {apps.length === 0 && <div className="emptyState">No LAN app shortcuts</div>}
          </div>
        </section>
      )}
    </main>
  );
}
