import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  createMobileTerminal,
  forwardTerminalTapFromOverlay,
  isMobileTerminalEnvironment,
  selectTerminalRangeFromPoints,
  type MobileTerminalTapPoint
} from "@opencozy/mobile-xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Monitor,
  PencilLine,
  Plus,
  Settings,
  X
} from "lucide-react";
import {
  closeOpenCozySession,
  createOpenCozySession,
  getCodexCapabilities,
  getWanTunnelStatus,
  listOpenCozySessions,
  updateOpenCozySession
} from "./api";
import { buildOpenCozySessionSocketUrl } from "./appUrls";
import { bindKeyboardReserve } from "./keyboardReserve";
import {
  getMobileInputGeometry,
  getMobileInputSelectionRects,
  type MobileInputGeometry,
  type MobileInputSelectionRect
} from "./mobileInputGeometry";
import {
  createMobileInputBridgeSelectionPatch,
  createMobileInputBridgeState,
  type MobileInputBridgeState
} from "./mobileInputBridge";
import {
  readMobileTerminalPreferences,
  writeMobileTerminalPreference,
  type MobileTerminalPreferenceKey,
  type MobileTerminalPreferences
} from "./mobileTerminalPreferences";
import { bindOuterScrollLock } from "./outerScrollLock";
import { getSessionLoadingCopy, type SessionLoadingCopy, type SessionLoadingPhase } from "./sessionLoading";
import {
  normalizePreviewUrl,
  readSessionPreviewUrl,
  removeSessionPreviewUrl,
  writeSessionPreviewUrl
} from "./sessionPreviewUrls";
import {
  addSessionTabPreference,
  readLastCodexThreadId,
  readSessionTabPreferences,
  reconcileSessionTabPreferences,
  removeSessionTabPreference,
  writeLastCodexThreadId,
  writeSessionTabPreferences,
  type SessionTabPreferences
} from "./sessionTabPreferences";
import { truncateSessionTabName } from "./sessionTabs";
import { normalizeTerminalCopyText, writeTerminalClipboardText } from "./terminalClipboard";
import { shouldShowArrowPad } from "./terminalControls";
import { createTerminalOutputDrain } from "./terminalOutputDrain";
import { bindTerminalTouchScroll } from "./terminalTouchScroll";
import { getTerminalVisualCursorStyle } from "./terminalVisualCursor";
import type {
  OpenCozySessionMode,
  OpenCozySessionSummary,
  WanTunnelStatus
} from "./types";

type Overlay = "editSessionTitle" | "preview" | "settings" | null;
type TerminalPhase = Exclude<SessionLoadingPhase, "initializing"> | "ready";

type TerminalMessage =
  | { type: "output"; data: string }
  | { type: "status"; session: OpenCozySessionSummary }
  | { type: "exit"; exitCode: number };

const DEVICE_ID_KEY = "opencozy.deviceId";
const SESSION_NAME_MAX_LENGTH = 80;
const TERMINAL_WRITE_CHUNK_SIZE = 32_000;
const TERMINAL_INPUT_ZONE_HEIGHT = 202;
const TERMINAL_FONT_SIZE = 14;
const MOBILE_INPUT_FONT_SIZE = 16;
const MOBILE_INPUT_SCALE = TERMINAL_FONT_SIZE / MOBILE_INPUT_FONT_SIZE;
const PREVIEW_AGENT_TIP = "Please expose the app preview for this project on the LAN and send me the full URL reachable from my iPhone so I can paste it into OpenCozy Preview.";
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

function rememberCodexThreadForDevice(deviceId: string, session: OpenCozySessionSummary): void {
  if (session.codexThreadId) {
    writeLastCodexThreadId(window.localStorage, deviceId, session.codexThreadId);
  }
}

function isInputZoneTap(point: MobileTerminalTapPoint, element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return point.clientY >= rect.bottom - Math.min(TERMINAL_INPUT_ZONE_HEIGHT, rect.height);
}

function applyMobileInputGeometry(input: HTMLTextAreaElement, geometry: MobileInputGeometry): void {
  input.style.bottom = "auto";
  input.style.fontSize = `${MOBILE_INPUT_FONT_SIZE}px`;
  input.style.height = `${geometry.height / MOBILE_INPUT_SCALE}px`;
  input.style.left = `${geometry.left}px`;
  input.style.lineHeight = `${geometry.lineHeight / MOBILE_INPUT_SCALE}px`;
  input.style.textIndent = `${geometry.textIndent / MOBILE_INPUT_SCALE}px`;
  input.style.top = `${geometry.top}px`;
  input.style.transform = `scale(${MOBILE_INPUT_SCALE})`;
  input.style.width = `${geometry.width / MOBILE_INPUT_SCALE}px`;
}

function inputSelectionRectsEqual(left: MobileInputSelectionRect[], right: MobileInputSelectionRect[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftRect, index) => {
    const rightRect = right[index];
    return rightRect !== undefined
      && leftRect.height === rightRect.height
      && leftRect.left === rightRect.left
      && leftRect.top === rightRect.top
      && leftRect.width === rightRect.width;
  });
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

function readWanTunnelSummary(status: WanTunnelStatus | null, loading: boolean, error: string | null): { detail: string; state: string } {
  if (loading && !status) {
    return { detail: "Checking local configuration", state: "Checking" };
  }

  if (error) {
    return { detail: error, state: "Unavailable" };
  }

  if (!status) {
    return { detail: "Open settings again to refresh tunnel state", state: "Unknown" };
  }

  if (!status.config.backendLocalOnly) {
    return { detail: "Backend is not localhost-only", state: "Needs config" };
  }

  if (!status.tailscale.cliAvailable) {
    return { detail: "Tailscale CLI is not installed", state: "Not installed" };
  }

  if (!status.tailscale.daemonReachable) {
    return { detail: status.tailscale.error || "Tailscale daemon is not reachable", state: "Offline" };
  }

  if (!status.tailscale.serveConfigured) {
    return { detail: "Tailscale node is enrolled, Serve is not configured", state: "Serve off" };
  }

  return { detail: status.tailscale.httpsOrigin || "Tailscale Serve is configured", state: "Ready" };
}

function readLanAccessHosts(status: WanTunnelStatus | null): string {
  if (!status) {
    return "Unknown";
  }

  const tailnetSuffix = status.tailscale.tailnetSuffix;
  const lanHosts = status.config.allowedHosts.filter((host) => !tailnetSuffix || !host.endsWith(tailnetSuffix));
  return joinOrNone(lanHosts);
}

function readWanAccessOrigin(status: WanTunnelStatus | null): string {
  if (!status) {
    return "Unknown";
  }

  if (!status.tailscale.cliAvailable) {
    return "Tailscale not installed";
  }

  if (!status.tailscale.daemonReachable) {
    return "Tailscale offline";
  }

  if (!status.tailscale.serveConfigured) {
    return "Serve off";
  }

  return status.tailscale.httpsOrigin ?? "Configured";
}

function readBackendAccess(status: WanTunnelStatus | null): string {
  if (!status) {
    return "Unknown";
  }

  const address = `${status.config.backendHost}:${status.config.backendPort}`;
  return status.config.backendLocalOnly ? `Localhost only (${address})` : `Exposed bind (${address})`;
}

function joinOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
}

function TerminalPane({
  preferences,
  session,
  onSessionUpdate
}: {
  preferences: MobileTerminalPreferences;
  session: OpenCozySessionSummary;
  onSessionUpdate: (session: OpenCozySessionSummary) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const keyboardInputRef = useRef<HTMLTextAreaElement | null>(null);
  const touchLayerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const visualCursorRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const followBottomRef = useRef(true);
  const inputBridgeRef = useRef<MobileInputBridgeState>(createMobileInputBridgeState());
  const selectionAnchorRef = useRef<MobileTerminalTapPoint | null>(null);
  const [terminalPhase, setTerminalPhase] = useState<TerminalPhase>("connecting");
  const [followBottomPaused, setFollowBottomPaused] = useState(false);
  const [inputSelectionRects, setInputSelectionRects] = useState<MobileInputSelectionRect[]>([]);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [selectionCopyText, setSelectionCopyText] = useState<string | null>(null);
  const [showReturnToBottom, setShowReturnToBottom] = useState(false);

  const syncVisualCursor = useCallback(() => {
    const cursor = visualCursorRef.current;
    const element = elementRef.current;
    const keyboardInput = keyboardInputRef.current;
    const terminal = terminalRef.current;
    const screen = element?.querySelector<HTMLElement>(".xterm-screen");
    if (!element || !terminal || !screen) {
      return;
    }

    const hostRect = element.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    let hasActiveInputSelection = false;
    if (keyboardInput && screenRect.width > 0 && screenRect.height > 0) {
      const inputGeometry = getMobileInputGeometry({
        cols: terminal.cols,
        cursorX: terminal.buffer.active.cursorX,
        cursorY: terminal.buffer.active.cursorY,
        hostLeft: hostRect.left,
        hostTop: hostRect.top,
        inputCursor: inputBridgeRef.current.cursor,
        inputLength: inputBridgeRef.current.value.length,
        rows: terminal.rows,
        screenHeight: screenRect.height,
        screenLeft: screenRect.left,
        screenTop: screenRect.top,
        screenWidth: screenRect.width
      });

      if (inputGeometry) {
        applyMobileInputGeometry(keyboardInput, inputGeometry);
      }

      const selectionStart = keyboardInput.selectionStart ?? keyboardInput.value.length;
      const selectionEnd = keyboardInput.selectionEnd ?? selectionStart;
      const isKeyboardInputActive = document.activeElement === keyboardInput;
      hasActiveInputSelection = isKeyboardInputActive && selectionStart !== selectionEnd;
      const nextSelectionRects = isKeyboardInputActive
        ? getMobileInputSelectionRects({
          cols: terminal.cols,
          cursorX: terminal.buffer.active.cursorX,
          cursorY: terminal.buffer.active.cursorY,
          hostLeft: hostRect.left,
          hostTop: hostRect.top,
          inputCursor: inputBridgeRef.current.cursor,
          inputLength: keyboardInput.value.length,
          rows: terminal.rows,
          screenHeight: screenRect.height,
          screenLeft: screenRect.left,
          screenTop: screenRect.top,
          screenWidth: screenRect.width,
          selectionEnd,
          selectionStart
        })
        : [];
      setInputSelectionRects((currentSelectionRects) => (
        inputSelectionRectsEqual(currentSelectionRects, nextSelectionRects)
          ? currentSelectionRects
          : nextSelectionRects
      ));
    }

    if (!cursor) {
      return;
    }

    if (hasActiveInputSelection) {
      cursor.style.display = "none";
      return;
    }

    const buffer = terminal.buffer.active;
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

  const pauseFollowBottom = useCallback(() => {
    if (!followBottomRef.current) {
      return;
    }

    followBottomRef.current = false;
    setFollowBottomPaused(true);
    setShowReturnToBottom(true);
  }, []);

  const resumeFollowBottom = useCallback(() => {
    followBottomRef.current = true;
    setFollowBottomPaused(false);
    setShowReturnToBottom(false);

    const terminal = terminalRef.current;
    terminal?.scrollToBottom();
    if (terminal && terminal.rows > 0) {
      terminal.refresh(0, terminal.rows - 1);
    }
    syncVisualCursor();
  }, [syncVisualCursor]);

  const focusKeyboard = useCallback(() => {
    keyboardInputRef.current?.focus({ preventScroll: true });
  }, []);

  const sendInput = useCallback((data: string): boolean => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
      return true;
    }
    return false;
  }, []);

  const copyTerminalSelection = useCallback(() => {
    const selection = normalizeTerminalCopyText(terminalRef.current?.getSelection() || selectionCopyText || "");
    if (!selection) {
      setSelectionCopyText(null);
      return;
    }

    void writeTerminalClipboardText(selection).then((copied) => {
      if (!copied) {
        return;
      }

      terminalRef.current?.clearSelection();
      setSelectionCopyText(null);
    });
  }, [selectionCopyText]);

  const resetKeyboardInput = useCallback((target: HTMLTextAreaElement) => {
    inputBridgeRef.current = createMobileInputBridgeState();
    setInputSelectionRects([]);
    target.value = "";
    window.requestAnimationFrame(syncVisualCursor);
  }, [syncVisualCursor]);

  const applyKeyboardInput = useCallback((target: HTMLTextAreaElement) => {
    const selectionStart = target.selectionStart ?? target.value.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    const patch = createMobileInputBridgeSelectionPatch(
      inputBridgeRef.current,
      target.value,
      selectionStart,
      selectionEnd
    );
    if (!patch) {
      window.requestAnimationFrame(syncVisualCursor);
      return;
    }

    inputBridgeRef.current = patch.state;
    if (patch.data) {
      sendInput(patch.data);
    }
    window.requestAnimationFrame(syncVisualCursor);
  }, [sendInput, syncVisualCursor]);

  const handleKeyboardKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      const data = ctrlKeyData(event.key);
      if (data) {
        event.preventDefault();
        resetKeyboardInput(event.currentTarget);
        sendInput(data);
        return;
      }
    }

    const keyData: Record<string, string> = {
      Enter: TERMINAL_KEYS.enter,
      Escape: TERMINAL_KEYS.escape,
      Tab: TERMINAL_KEYS.tab
    };
    const data = keyData[event.key];
    if (!data) {
      return;
    }

    event.preventDefault();
    resetKeyboardInput(event.currentTarget);
    sendInput(data);
  }, [resetKeyboardInput, sendInput]);

  const handleKeyboardInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      return;
    }

    applyKeyboardInput(event.currentTarget);
  }, [applyKeyboardInput]);

  const handleKeyboardSelect = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      return;
    }

    applyKeyboardInput(event.currentTarget);
  }, [applyKeyboardInput]);

  useEffect(() => {
    const input = keyboardInputRef.current;
    if (!input) {
      return;
    }

    const cleanupKeyboardReserve = bindKeyboardReserve(input, window, {
      onKeyboardHidden: () => {
        window.requestAnimationFrame(resumeFollowBottom);
      }
    });
    const handleSelectionChange = () => {
      if (document.activeElement !== input || composingRef.current) {
        return;
      }

      applyKeyboardInput(input);
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      cleanupKeyboardReserve();
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [applyKeyboardInput, resumeFollowBottom, session.id]);

  useEffect(() => {
    followBottomRef.current = true;
    setFollowBottomPaused(false);
    setShowReturnToBottom(false);
    setInputSelectionRects([]);
    setSelectionCopyText(null);
    const input = keyboardInputRef.current;
    if (input) {
      resetKeyboardInput(input);
    }
  }, [resetKeyboardInput, session.id]);

  useEffect(() => {
    const element = elementRef.current;
    const touchLayer = touchLayerRef.current;
    if (!element || !touchLayer) {
      return;
    }
    setTerminalPhase("connecting");

    const terminalOptions = {
      cursorBlink: false,
      cursorInactiveStyle: "block",
      cursorStyle: "block",
      convertEol: true,
      disableStdin: true,
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.2,
      theme: {
        background: "#070a08",
        foreground: "#f1f5ef",
        cursor: "rgba(143, 208, 165, 0)",
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
    } satisfies ConstructorParameters<typeof XtermTerminal>[0];
    const terminal = isMobileTerminalEnvironment(window)
      ? createMobileTerminal(terminalOptions)
      : new XtermTerminal(terminalOptions);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    terminalRef.current = terminal;
    const viewport = element.querySelector<HTMLElement>(".xterm-viewport");
    let scheduleResize = () => undefined;

    let disposed = false;
    let resizeFrame: number | null = null;
    let lastSentCols = 0;
    let lastSentRows = 0;
    let hasReceivedOutput = false;
    let hasPaintedOutput = false;
    let activeSocket: WebSocket | null = null;
    let reconnectDelayMs = 250;
    let reconnectTimer: number | null = null;
    const terminalInputDisposable = terminal.onData((data) => {
      sendInput(data);
    });
    const refreshTerminal = () => {
      if (terminal.rows > 0) {
        terminal.refresh(0, terminal.rows - 1);
      }
      syncVisualCursor();
    };
    const isAtBottom = () => {
      if (!viewport) {
        return terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
      }

      return viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 2;
    };
    const markAtBottom = () => {
      followBottomRef.current = true;
      setFollowBottomPaused(false);
      setShowReturnToBottom(false);
    };
    const syncReturnToBottomState = () => {
      const atBottom = isAtBottom();
      setShowReturnToBottom(!atBottom);
      if (atBottom && !terminal.hasSelection()) {
        markAtBottom();
      }
    };
    const pauseFollowBottomAfterUserScroll = () => {
      if (!isAtBottom()) {
        pauseFollowBottom();
        return;
      }

      if (!terminal.hasSelection()) {
        markAtBottom();
      }
    };
    const scrollToBottomIfFollowing = () => {
      if (followBottomRef.current) {
        terminal.scrollToBottom();
        markAtBottom();
      }
    };
    const markTerminalReady = () => {
      if (disposed || hasPaintedOutput) {
        return;
      }

      hasPaintedOutput = true;
      setTerminalPhase("ready");
    };
    const terminalOutputDrain = createTerminalOutputDrain({
      afterWrite: () => {
        scrollToBottomIfFollowing();
        syncReturnToBottomState();
        refreshTerminal();
      },
      onFirstPaint: markTerminalReady,
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      write: (data, callback) => terminal.write(data, callback),
      writeChunkSize: TERMINAL_WRITE_CHUNK_SIZE
    });
    const cleanupTouchScroll = bindTerminalTouchScroll(touchLayer, element, undefined, {
      onSelectionEnd: (point) => {
        const anchor = selectionAnchorRef.current;
        if (anchor) {
          selectTerminalRangeFromPoints({ anchor, focus: point, root: element, terminal });
        }
        selectionAnchorRef.current = null;
      },
      onSelectionMove: (point) => {
        const anchor = selectionAnchorRef.current;
        if (anchor) {
          selectTerminalRangeFromPoints({ anchor, focus: point, root: element, terminal });
        }
      },
      onSelectionStart: (point) => {
        pauseFollowBottom();
        selectionAnchorRef.current = point;
        selectTerminalRangeFromPoints({ anchor: point, focus: point, root: element, terminal });
      },
      onTap: (point) => {
        if (isInputZoneTap(point, element)) {
          focusKeyboard();
          return;
        }

        keyboardInputRef.current?.blur();
        setKeyboardFocused(false);

        if (terminal.modes.mouseTrackingMode === "none") {
          return;
        }

        forwardTerminalTapFromOverlay({
          ...point,
          overlay: touchLayer,
          root: element
        });
        terminal.textarea?.blur();
      },
      onUserScroll: pauseFollowBottomAfterUserScroll
    });
    const handleWheelScroll = (event: WheelEvent) => {
      if (!viewport) {
        if (event.deltaY < 0 || !isAtBottom()) {
          pauseFollowBottom();
        }
        return;
      }

      const deltaY = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * viewport.clientHeight
          : event.deltaY;
      const previousScrollTop = viewport.scrollTop;
      viewport.scrollTop += deltaY;

      if (viewport.scrollTop !== previousScrollTop) {
        pauseFollowBottomAfterUserScroll();
        if (event.cancelable) {
          event.preventDefault();
        }
        event.stopPropagation();
        return;
      }

      if (event.deltaY < 0 || !isAtBottom()) {
        pauseFollowBottom();
      }
    };
    touchLayer.addEventListener("wheel", handleWheelScroll, { passive: false });
    viewport?.addEventListener("scroll", pauseFollowBottomAfterUserScroll);

    const writeTerminalOutput = (data: string) => {
      terminalOutputDrain.write(data);
    };

    const scheduleCursorSync = () => {
      window.requestAnimationFrame(syncVisualCursor);
    };

    const cursorMoveDisposable = terminal.onCursorMove(scheduleCursorSync);
    const renderDisposable = terminal.onRender(scheduleCursorSync);
    const scrollDisposable = terminal.onScroll(scheduleCursorSync);
    const writeParsedDisposable = terminal.onWriteParsed(scheduleCursorSync);
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = normalizeTerminalCopyText(terminal.getSelection());
      if (selection) {
        pauseFollowBottom();
        setSelectionCopyText(selection);
        return;
      }

      setSelectionCopyText(null);
    });
    const handleCopy = (event: ClipboardEvent) => {
      const selection = normalizeTerminalCopyText(terminal.getSelection());
      if (!selection || !event.clipboardData) {
        return;
      }

      event.clipboardData.setData("text/plain", selection);
      event.preventDefault();
    };
    element.addEventListener("copy", handleCopy);

    const fitAndSendResize = () => {
      resizeFrame = null;
      if (disposed) {
        return;
      }

      fitAddon.fit();
      refreshTerminal();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && (terminal.cols !== lastSentCols || terminal.rows !== lastSentRows)) {
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

    const clearReconnectTimer = () => {
      if (reconnectTimer === null) {
        return;
      }

      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const hasConnectableSocket = () => (
      activeSocket?.readyState === WebSocket.OPEN || activeSocket?.readyState === WebSocket.CONNECTING
    );

    const connectSocket = () => {
      if (disposed || hasConnectableSocket()) {
        return;
      }

      clearReconnectTimer();
      const replayHistory = !hasReceivedOutput && !hasPaintedOutput;
      const socket = new WebSocket(buildOpenCozySessionSocketUrl(session.id, window.location, { replayHistory }));
      activeSocket = socket;
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed || activeSocket !== socket) {
          return;
        }

        lastSentCols = 0;
        lastSentRows = 0;
        reconnectDelayMs = 250;
        scheduleResize();
        if (!hasReceivedOutput && !hasPaintedOutput) {
          setTerminalPhase("waitingForOutput");
        }
      });

      socket.addEventListener("message", (event) => {
        if (disposed || activeSocket !== socket) {
          return;
        }

        const message = JSON.parse(event.data as string) as TerminalMessage;
        if (message.type === "output") {
          if (message.data.length > 0) {
            hasReceivedOutput = true;
          }
          writeTerminalOutput(message.data);
        }

        if (message.type === "status") {
          onSessionUpdate(message.session);
        }

        if (message.type === "exit") {
          writeTerminalOutput(`\r\n[OpenCozy session exited: ${message.exitCode}]\r\n`);
        }
      });

      socket.addEventListener("close", (event) => {
        if (disposed || activeSocket !== socket) {
          return;
        }

        activeSocket = null;
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        if (event.code === 1000) {
          markTerminalReady();
          return;
        }

        if (event.code === 1008) {
          writeTerminalOutput("\r\n[OpenCozy session is no longer available]\r\n");
          markTerminalReady();
          return;
        }

        if (document.visibilityState === "visible") {
          const delay = reconnectDelayMs;
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000);
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connectSocket();
          }, delay);
        }
      });
    };

    const ensureSocketConnected = () => {
      if (!hasConnectableSocket()) {
        connectSocket();
      }
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(element);

    const restoreTerminalFrame = () => {
      if (disposed) {
        return;
      }

      scheduleResize();
      scrollToBottomIfFollowing();
      window.requestAnimationFrame(refreshTerminal);
      ensureSocketConnected();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        restoreTerminalFrame();
      }
    };

    window.addEventListener("focus", restoreTerminalFrame);
    window.addEventListener("pageshow", restoreTerminalFrame);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    connectSocket();
    scheduleResize();
    scheduleCursorSync();

    return () => {
      disposed = true;
      selectionAnchorRef.current = null;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      clearReconnectTimer();
      terminalOutputDrain.dispose();
      cleanupTouchScroll();
      touchLayer.removeEventListener("wheel", handleWheelScroll);
      viewport?.removeEventListener("scroll", pauseFollowBottomAfterUserScroll);
      terminalInputDisposable.dispose();
      cursorMoveDisposable.dispose();
      renderDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      selectionDisposable.dispose();
      element.removeEventListener("copy", handleCopy);
      resizeObserver.disconnect();
      window.removeEventListener("focus", restoreTerminalFrame);
      window.removeEventListener("pageshow", restoreTerminalFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      const socket = activeSocket;
      if (socket?.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(1000, "Terminal pane disposed"), { once: true });
      } else if (socket?.readyState === WebSocket.OPEN) {
        socket.close(1000, "Terminal pane disposed");
      }

      terminal.dispose();
      if (socketRef.current === socket || socketRef.current === activeSocket) {
        socketRef.current = null;
      }
      activeSocket = null;
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    };
  }, [focusKeyboard, onSessionUpdate, pauseFollowBottom, sendInput, session.id, syncVisualCursor]);

  const showArrowPad = shouldShowArrowPad();

  return (
    <>
      <div className={`terminalOutputFrame${keyboardFocused ? " terminalOutputFrame--keyboardFocused" : ""}`}>
        <textarea
          ref={keyboardInputRef}
          className={`terminalKeyboardInput${keyboardFocused ? " terminalKeyboardInput--interactive" : ""}`}
          aria-label="Terminal keyboard input"
          autoCapitalize={preferences.autocapitalization ? "sentences" : "off"}
          autoCorrect={preferences.autocorrect ? "on" : "off"}
          inputMode="text"
          rows={6}
          spellCheck={preferences.autocorrect}
          wrap="soft"
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            applyKeyboardInput(event.currentTarget);
          }}
          onInput={handleKeyboardInput}
          onKeyDown={handleKeyboardKeyDown}
          onBlur={() => {
            setKeyboardFocused(false);
            setInputSelectionRects([]);
          }}
          onFocus={() => {
            setKeyboardFocused(true);
            window.requestAnimationFrame(syncVisualCursor);
          }}
          onSelect={handleKeyboardSelect}
        />
        <div className="terminalSurface" ref={elementRef} />
        {inputSelectionRects.length > 0 && (
          <div className="terminalInputSelectionLayer" aria-hidden="true">
            {inputSelectionRects.map((rect, index) => (
              <span
                key={index}
                className="terminalInputSelectionMark"
                style={{
                  height: `${rect.height}px`,
                  transform: `translate(${rect.left}px, ${rect.top}px)`,
                  width: `${rect.width}px`
                }}
              />
            ))}
          </div>
        )}
        <div className="terminalVisualCursor" ref={visualCursorRef} aria-hidden="true" />
        {terminalPhase !== "ready" && (
          <SessionLoadingState
            copy={getSessionLoadingCopy(session.mode, terminalPhase)}
            overlay
          />
        )}
        <div className="terminalTouchLayer" ref={touchLayerRef} aria-hidden="true" />
        {showReturnToBottom && (
          <button
            type="button"
            className="terminalReturnToBottom"
            onMouseDown={(event) => event.preventDefault()}
            onClick={resumeFollowBottom}
            aria-label="Return to bottom"
          >
            <ChevronDown size={22} />
          </button>
        )}
        {selectionCopyText && (
          <button
            type="button"
            className="terminalSelectionCopy"
            onMouseDown={(event) => event.preventDefault()}
            onClick={copyTerminalSelection}
            aria-label="Copy terminal selection"
          >
            <Copy size={15} />
            <span>Copy</span>
          </button>
        )}
        <div
          className={`terminalComposeZone${followBottomPaused ? " terminalComposeZone--followPaused" : ""}`}
          aria-hidden="true"
        />
        {showArrowPad && (
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
            <button type="button" className="arrowPadButton arrowPadEnter" onMouseDown={(event) => event.preventDefault()} onClick={() => sendInput(TERMINAL_KEYS.enter)} aria-label="Enter">
              <ChevronRight size={24} strokeWidth={2.4} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const shellRef = useRef<HTMLElement | null>(null);
  const [deviceId] = useState(getDeviceId);
  const [initialSessionTabPreferences] = useState(() => readSessionTabPreferences(window.localStorage, deviceId));
  const [sessions, setSessions] = useState<OpenCozySessionSummary[]>([]);
  const [sessionTabIds, setSessionTabIds] = useState<string[]>(() => initialSessionTabPreferences.tabIds);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => initialSessionTabPreferences.activeSessionId);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingSessionMode, setPendingSessionMode] = useState<OpenCozySessionMode | null>(null);
  const [previewUrl, setPreviewUrl] = useState(() => readSessionPreviewUrl(window.localStorage, null));
  const [previewUrlDraft, setPreviewUrlDraft] = useState("");
  const [previewUrlError, setPreviewUrlError] = useState<string | null>(null);
  const [previewUrlEditorOpen, setPreviewUrlEditorOpen] = useState(false);
  const [previewFrameLoaded, setPreviewFrameLoaded] = useState(false);
  const [previewTipCopied, setPreviewTipCopied] = useState(false);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const [terminalPreferences, setTerminalPreferences] = useState(() => readMobileTerminalPreferences());
  const [wanTunnelStatus, setWanTunnelStatus] = useState<WanTunnelStatus | null>(null);
  const [wanTunnelLoading, setWanTunnelLoading] = useState(false);
  const [wanTunnelError, setWanTunnelError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [addSessionMenuOpen, setAddSessionMenuOpen] = useState(false);
  const [confirmCloseSessionId, setConfirmCloseSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );
  const sessionTabs = useMemo(
    () => sessionTabIds.map((id) => sessionById.get(id)).filter((session): session is OpenCozySessionSummary => Boolean(session)),
    [sessionById, sessionTabIds]
  );
  const showStartPlaceholder = !loadingInitialData && !pendingSessionMode && sessionTabs.length === 0;
  const activeSession = useMemo(
    () => (activeSessionId ? sessionById.get(activeSessionId) ?? null : null),
    [activeSessionId, sessionById]
  );
  const confirmCloseSession = useMemo(
    () => (confirmCloseSessionId ? sessionById.get(confirmCloseSessionId) ?? null : null),
    [confirmCloseSessionId, sessionById]
  );
  const wanTunnelSummary = useMemo(
    () => readWanTunnelSummary(wanTunnelStatus, wanTunnelLoading, wanTunnelError),
    [wanTunnelError, wanTunnelLoading, wanTunnelStatus]
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const selectActiveSessionId = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
  }, []);

  const persistSessionTabPreferences = useCallback((preferences: SessionTabPreferences) => {
    const persisted = writeSessionTabPreferences(window.localStorage, deviceId, preferences);
    setSessionTabIds(persisted.tabIds);
    selectActiveSessionId(persisted.activeSessionId);
    return persisted;
  }, [deviceId, selectActiveSessionId]);

  useEffect(() => {
    if (loadingInitialData) {
      return;
    }

    if (activeSessionId && !sessionById.has(activeSessionId)) {
      persistSessionTabPreferences(reconcileSessionTabPreferences({ activeSessionId, tabIds: sessionTabIds }, sessions));
    }
  }, [activeSessionId, loadingInitialData, persistSessionTabPreferences, sessionById, sessions, sessionTabIds]);

  useEffect(() => {
    if (confirmCloseSessionId && !sessionById.has(confirmCloseSessionId)) {
      setConfirmCloseSessionId(null);
    }
  }, [confirmCloseSessionId, sessionById]);

  useEffect(() => {
    const nextPreviewUrl = readSessionPreviewUrl(window.localStorage, activeSessionId);
    setPreviewUrl(nextPreviewUrl);
    setPreviewUrlDraft(nextPreviewUrl);
    setPreviewUrlError(null);
    setPreviewUrlEditorOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (overlay === "preview" && previewUrl) {
      setPreviewFrameLoaded(false);
    }
  }, [overlay, previewUrl]);

  const refreshWanTunnelStatus = useCallback(async () => {
    setWanTunnelLoading(true);
    setWanTunnelError(null);

    try {
      setWanTunnelStatus(await getWanTunnelStatus());
    } catch (statusError) {
      setWanTunnelError(statusError instanceof Error ? statusError.message : "Failed to read WAN tunnel state");
    } finally {
      setWanTunnelLoading(false);
    }
  }, []);

  useEffect(() => {
    if (overlay !== "settings") {
      return;
    }

    void refreshWanTunnelStatus();
  }, [overlay, refreshWanTunnelStatus]);

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
    const restoredPreferences = readSessionTabPreferences(window.localStorage, deviceId);
    const [, sessionResult] = await Promise.all([
      getCodexCapabilities(),
      listOpenCozySessions({ deviceId, tabIds: restoredPreferences.tabIds })
    ]);
    setSessions(sessionResult);
    persistSessionTabPreferences(reconcileSessionTabPreferences(restoredPreferences, sessionResult));
  }, [deviceId, persistSessionTabPreferences]);

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
    setAddSessionMenuOpen(false);
    setConfirmCloseSessionId(null);
    setOverlay(null);

    try {
      const lastCodexThreadId = mode === "resumeLast" ? readLastCodexThreadId(window.localStorage, deviceId) : null;
      const session = await createOpenCozySession(mode, {
        deviceId,
        ...(lastCodexThreadId ? { codexThreadId: lastCodexThreadId } : {})
      });
      setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      persistSessionTabPreferences(addSessionTabPreference({ activeSessionId: activeSessionIdRef.current, tabIds: sessionTabIds }, session.id));
      rememberCodexThreadForDevice(deviceId, session);
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
    setAddSessionMenuOpen(false);
    setConfirmCloseSessionId(null);
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

  const handleSessionUpdate = useCallback((updated: OpenCozySessionSummary) => {
    setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
    if (updated.id === activeSessionIdRef.current) {
      rememberCodexThreadForDevice(deviceId, updated);
    }
  }, [deviceId]);

  const activateSessionTab = (session: OpenCozySessionSummary) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setAddSessionMenuOpen(false);
    setConfirmCloseSessionId(null);
    persistSessionTabPreferences(addSessionTabPreference({ activeSessionId, tabIds: sessionTabIds }, session.id));
    rememberCodexThreadForDevice(deviceId, session);
  };

  const closeSessionTab = async (sessionId: string) => {
    const nextPreferences = removeSessionTabPreference({ activeSessionId: activeSessionIdRef.current, tabIds: sessionTabIds }, sessionId);
    setBusy(true);
    setError(null);
    setAddSessionMenuOpen(false);
    setConfirmCloseSessionId(null);

    try {
      await closeOpenCozySession(sessionId);
      removeSessionPreviewUrl(window.localStorage, sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      persistSessionTabPreferences(nextPreferences);
      const nextSession = nextPreferences.activeSessionId ? sessionById.get(nextPreferences.activeSessionId) : null;
      if (nextSession) {
        rememberCodexThreadForDevice(deviceId, nextSession);
      }
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Failed to close session");
    } finally {
      setBusy(false);
    }
  };

  const openPreview = () => {
    if (!activeSessionId) {
      setError("Open a session tab before using preview.");
      return;
    }

    setAddSessionMenuOpen(false);
    setConfirmCloseSessionId(null);
    const sessionPreviewUrl = readSessionPreviewUrl(window.localStorage, activeSessionId);
    setPreviewUrl(sessionPreviewUrl);
    setPreviewUrlDraft(sessionPreviewUrl);
    setPreviewUrlError(null);
    setPreviewUrlEditorOpen(false);
    setPreviewTipCopied(false);
    setOverlay("preview");
  };

  const openSettings = () => {
    setAddSessionMenuOpen(false);
    setConfirmCloseSessionId(null);
    setOverlay("settings");
  };

  const openPreviewUrlEditor = () => {
    setPreviewUrlError(null);
    setPreviewUrlDraft(previewUrl);
    setPreviewUrlEditorOpen(true);
  };

  const savePreviewUrl = () => {
    if (!activeSessionId) {
      setPreviewUrlError("Open a session tab before saving preview URL.");
      return;
    }

    setPreviewUrlError(null);
    try {
      const nextUrl = normalizePreviewUrl(previewUrlDraft);
      writeSessionPreviewUrl(window.localStorage, activeSessionId, nextUrl);
      setPreviewUrl(nextUrl);
      setPreviewUrlDraft(nextUrl);
      setPreviewUrlEditorOpen(false);
    } catch (previewUrlError) {
      setPreviewUrlError(previewUrlError instanceof Error ? previewUrlError.message : "Failed to save preview URL");
    }
  };

  const copyPreviewAgentTip = () => {
    setPreviewTipCopied(false);
    void writeTerminalClipboardText(PREVIEW_AGENT_TIP).then((copied) => {
      if (!copied) {
        return;
      }

      setPreviewTipCopied(true);
      window.setTimeout(() => setPreviewTipCopied(false), 1500);
    });
  };

  const renderPreviewUrlForm = (className: string, includeInstructions: boolean) => (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        savePreviewUrl();
      }}
    >
      {includeInstructions && (
        <div className="previewEmptyCopy">
          <h2>Preview URL</h2>
          <p>Enter the local app URL for this session tab. Saved URLs stay attached to the current tab.</p>
        </div>
      )}
      <label className="field previewUrlField">
        <span>Preview URL</span>
        <input
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          placeholder="localhost:5173"
          value={previewUrlDraft}
          onChange={(event) => {
            setPreviewUrlDraft(event.currentTarget.value);
            setPreviewUrlError(null);
          }}
        />
      </label>
      {previewUrlError && <div className="previewUrlError">{previewUrlError}</div>}
      <button className="primaryButton previewSaveButton" type="submit">
        <span>Save URL</span>
      </button>
      {includeInstructions && (
        <div className="previewAgentTip">
          <div className="previewAgentTipText">
            <span>Need help finding the URL?</span>
            <p>Paste this message to your agent if you do not know how to connect.</p>
            <code>{PREVIEW_AGENT_TIP}</code>
          </div>
          <button className="previewAgentTipCopy" type="button" onClick={copyPreviewAgentTip}>
            <span>{previewTipCopied ? "Copied" : "Copy Message"}</span>
          </button>
        </div>
      )}
    </form>
  );

  const updateTerminalPreference = (key: MobileTerminalPreferenceKey, value: boolean) => {
    setTerminalPreferences(writeMobileTerminalPreference(window.localStorage, key, value));
  };

  return (
    <main className="terminalShell" ref={shellRef}>
      <div className="leftControlRail" aria-label="OpenCozy controls">
        <button className="iconButton" type="button" onClick={openSettings} aria-label="Settings">
          <Settings size={19} />
        </button>
      </div>

      {(addSessionMenuOpen || confirmCloseSession) && (
        <button
          className="sessionPromptScrim"
          type="button"
          onClick={() => {
            setAddSessionMenuOpen(false);
            setConfirmCloseSessionId(null);
          }}
          aria-label="Close session prompt"
        />
      )}

      <div className="sessionTabBar" aria-label="OpenCozy session tabs">
        <div className="sessionTabScroller" data-opencozy-scrollable="true">
          {showStartPlaceholder && (
            <div className="sessionTab active sessionTabPlaceholder" aria-current="page">
              <span className="sessionTabPlaceholderName">OpenCozy</span>
              <button className="sessionTabClose sessionTabClosePlaceholder" type="button" disabled aria-label="No session to close">
                <X size={14} />
              </button>
            </div>
          )}
          {sessionTabs.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div className={isActive ? "sessionTab active" : "sessionTab"} key={session.id}>
                <button
                  className="sessionTabName"
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      openSessionTitleEditor();
                      return;
                    }
                    activateSessionTab(session);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={isActive ? `Edit ${session.name}` : `Switch to ${session.name}`}
                >
                  <span>{truncateSessionTabName(session.name)}</span>
                </button>
                <button
                  className="sessionTabClose"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setAddSessionMenuOpen(false);
                    setConfirmCloseSessionId(session.id);
                  }}
                  disabled={busy}
                  aria-label={`Close ${session.name}`}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          className={addSessionMenuOpen ? "sessionTabAdd active" : "sessionTabAdd"}
          type="button"
          onClick={() => {
            setConfirmCloseSessionId(null);
            setAddSessionMenuOpen((open) => !open);
          }}
          disabled={busy}
          aria-expanded={addSessionMenuOpen}
          aria-haspopup="menu"
          aria-label="Add session"
        >
          <Plus size={20} />
        </button>
      </div>

      {addSessionMenuOpen && (
        <div className="sessionAddMenu" role="menu" aria-label="Add session">
          <button type="button" role="menuitem" onClick={() => void startSession("new")} disabled={busy}>
            <span>New Session</span>
            <ChevronRight size={16} />
          </button>
          <button type="button" role="menuitem" onClick={() => void startSession("resume")} disabled={busy}>
            <span>Resume Session</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      {confirmCloseSession && (
        <div className="sessionCloseConfirm" role="dialog" aria-label={`Close ${confirmCloseSession.name}`}>
          <div className="sessionCloseText">
            <span>Close session?</span>
            <p>{truncateSessionTabName(confirmCloseSession.name)}</p>
          </div>
          <div className="sessionCloseActions">
            <button type="button" onClick={() => setConfirmCloseSessionId(null)}>
              Cancel
            </button>
            <button className="danger" type="button" onClick={() => void closeSessionTab(confirmCloseSession.id)} disabled={busy}>
              Close
            </button>
          </div>
        </div>
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
        {sessionTabs.length > 0 ? (
          sessionTabs.map((session) => (
            <div
              className={session.id === activeSessionId ? "terminalPaneSlot active" : "terminalPaneSlot"}
              key={session.id}
              aria-hidden={session.id !== activeSessionId}
            >
              <TerminalPane preferences={terminalPreferences} session={session} onSessionUpdate={handleSessionUpdate} />
            </div>
          ))
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
          <div className="startSessionState">
            <div className="startSessionIntro">
              <h1>Sessions</h1>
              <p>Sessions are globally shared and can be accessed from any device connected to the harness environment.</p>
            </div>
            <div className="startSessionOptions">
              <button className="startSessionButton" type="button" onClick={() => void startSession("new")} disabled={busy}>
                <span className="startSessionButtonLabel">
                  <span className="startSessionButtonText">New Session</span>
                </span>
                <ChevronRight className="startSessionChevron" size={18} />
              </button>
              <button className="startSessionButton" type="button" onClick={() => void startSession("resume")} disabled={busy}>
                <span className="startSessionButtonLabel">
                  <span className="startSessionButtonText">Resume Session</span>
                </span>
                <ChevronRight className="startSessionChevron" size={18} />
              </button>
            </div>
          </div>
        )}
      </section>

      {overlay === "preview" && (
        <div className="previewEdgeDock" role="group" aria-label="Preview controls">
          <button
            className="previewEdgeDockButton"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openPreviewUrlEditor}
            aria-label="Edit preview URL"
          >
            <PencilLine size={18} />
          </button>
          <button
            className="previewEdgeDockButton"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPreviewUrlEditorOpen(false);
              setPreviewUrlError(null);
              setOverlay(null);
            }}
            aria-label="Close preview"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {activeSessionId && overlay !== "preview" && overlay !== "settings" && overlay !== "editSessionTitle" && (
        <button
          className="terminalControlButton previewDockButton"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openPreview}
          aria-label="Preview"
        >
          <Monitor size={19} />
        </button>
      )}

      {overlay && (
        <button
          className={overlay === "settings" ? "scrim scrimSubtle" : "scrim"}
          type="button"
          onClick={() => setOverlay(null)}
          aria-label="Close panel"
        />
      )}

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
              <span>Save Title</span>
            </button>
          </form>
        </section>
      )}

      {overlay === "settings" && (
        <section className="settingsPage" data-opencozy-scrollable="true" aria-label="Settings">
          <header className="settingsPageHeader">
            <h2>Settings</h2>
            <button
              className="iconButton"
              type="button"
              onClick={() => setOverlay(null)}
              aria-label="Close settings"
            >
              <X size={18} />
            </button>
          </header>
          <div className="settingsPageContent">
            <section className="settingsSection" aria-labelledby="keyboardSettingsTitle">
              <div className="settingsSectionHeader">
                <h3 id="keyboardSettingsTitle">Keyboard</h3>
                <p>Native keyboard behavior for terminal input on this device.</p>
              </div>
              <div className="settingsList" role="group" aria-label="Keyboard settings">
                <label className="settingRow">
                  <span className="settingText">
                    <span className="settingLabel">Autocorrect</span>
                    <span className="settingHint">Use spelling fixes and typing suggestions while composing.</span>
                  </span>
                  <span className="settingSwitchWrap">
                    <input
                      className="settingSwitchInput"
                      type="checkbox"
                      checked={terminalPreferences.autocorrect}
                      onChange={(event) => updateTerminalPreference("autocorrect", event.currentTarget.checked)}
                    />
                    <span className={terminalPreferences.autocorrect ? "settingSwitch active" : "settingSwitch"} aria-hidden="true">
                      <span className="settingSwitchThumb" />
                    </span>
                  </span>
                </label>
                <label className="settingRow">
                  <span className="settingText">
                    <span className="settingLabel">Autocapitalization</span>
                    <span className="settingHint">Let the keyboard capitalize sentence starts automatically.</span>
                  </span>
                  <span className="settingSwitchWrap">
                    <input
                      className="settingSwitchInput"
                      type="checkbox"
                      checked={terminalPreferences.autocapitalization}
                      onChange={(event) => updateTerminalPreference("autocapitalization", event.currentTarget.checked)}
                    />
                    <span className={terminalPreferences.autocapitalization ? "settingSwitch active" : "settingSwitch"} aria-hidden="true">
                      <span className="settingSwitchThumb" />
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="settingsSection" aria-labelledby="accessSettingsTitle">
              <div className="settingsSectionHeader settingsSectionHeaderWithAction">
                <span>
                  <h3 id="accessSettingsTitle">Access</h3>
                  <p>LAN and enrolled Tailscale devices use the same OpenCozy service.</p>
                </span>
                <button className="settingsTextButton" type="button" onClick={() => void refreshWanTunnelStatus()} disabled={wanTunnelLoading}>
                  Refresh
                </button>
              </div>
              <div className="accessStatus" role="status" aria-live="polite">
                <span className={wanTunnelStatus?.tailscale.serveConfigured ? "accessStatusDot accessStatusDotReady" : "accessStatusDot"} aria-hidden="true" />
                <span className="accessStatusText">
                  <strong>{wanTunnelSummary.state}</strong>
                  <span>{wanTunnelSummary.detail}</span>
                </span>
              </div>
              <dl className="accessSummaryList">
                <div>
                  <dt>WAN</dt>
                  <dd>{readWanAccessOrigin(wanTunnelStatus)}</dd>
                </div>
                <div>
                  <dt>LAN</dt>
                  <dd>{readLanAccessHosts(wanTunnelStatus)}</dd>
                </div>
                <div>
                  <dt>Backend</dt>
                  <dd>{readBackendAccess(wanTunnelStatus)}</dd>
                </div>
              </dl>
              <details className="settingsDetails">
                <summary>
                  <span>Diagnostics</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </summary>
                <dl className="settingsDefinitionList">
                  <div>
                    <dt>OpenCozy origin</dt>
                    <dd>{wanTunnelStatus?.tailscale.httpsOrigin ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt>Frontend target</dt>
                    <dd>{wanTunnelStatus?.config.serveTarget ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Allowed hosts</dt>
                    <dd>{joinOrNone(wanTunnelStatus?.config.allowedHosts ?? [])}</dd>
                  </div>
                  <div>
                    <dt>Tailscale node</dt>
                    <dd>{wanTunnelStatus?.tailscale.nodeName ?? "Not enrolled"}</dd>
                  </div>
                  <div>
                    <dt>Tailscale IPs</dt>
                    <dd>{joinOrNone(wanTunnelStatus?.tailscale.ips ?? [])}</dd>
                  </div>
                  <div>
                    <dt>Tailscale socket</dt>
                    <dd>{wanTunnelStatus?.config.tailscaleSocket ?? "Default"}</dd>
                  </div>
                  <div>
                    <dt>Serve config</dt>
                    <dd>{wanTunnelStatus?.tailscale.serveStatus ?? "Unknown"}</dd>
                  </div>
                </dl>
              </details>
            </section>
          </div>
        </section>
      )}

      {overlay === "preview" && (
        <section className="previewSheet" data-opencozy-scrollable="true" aria-label="App preview">
          {previewUrlEditorOpen && previewUrl && renderPreviewUrlForm("previewUrlEditor", false)}
          {previewUrl ? (
            <>
              {!previewFrameLoaded && <div className="previewFrameLoading" aria-hidden="true" />}
              <iframe
                className={previewFrameLoaded ? "previewFrame" : "previewFrame previewFrame--loading"}
                src={previewUrl}
                title="App preview"
                onLoad={() => setPreviewFrameLoaded(true)}
              />
            </>
          ) : (
            <div className="previewEmptyState">{renderPreviewUrlForm("previewEmptyForm", true)}</div>
          )}
        </section>
      )}
    </main>
  );
}
