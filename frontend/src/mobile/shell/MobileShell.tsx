import { fileSize, useAttachmentDrafts } from "../attachments/useAttachmentDrafts";
import {
  Plus,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  Search,
  Monitor,
  Keyboard,
  Square,
  Zap,
  Settings,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approvePreviewManifest,
  attachWiredPreviewToThread,
  cancelRun,
  closeThread,
  closeThreads,
  fetchClosedThreads,
  reopenThread,
  connectTimeline,
  createRun,
  createThread,
  deleteWiredPreview,
  detachWiredPreviewFromThread,
  discoverWorkspaceStream,
  fetchAppConfig,
  fetchHarnesses,
  fetchThreadState,
  fetchThreads,
  fetchTimeline,
  getWiredPreview,
  launchPreviewWiringThread,
  listPreviewManifests,
  listWiredPreviews,
  publishBrowserDirectPreviewServices,
  publishPreviewTarget,
  renameThread,
  respondToApproval,
  respondToInput,
  sendRunInput,
  sendAgentInput,
  updateThreadSettings,
  updateWiredPreview,
  type AppConfig,
  type ExecutionProfileSummary,
  type HarnessSummary,
  type PreviewManifest,
  type ThreadRecord,
  type TimelineEventRecord,
  type WiredPreview,
  type WiredPreviewInput,
  type WorkspaceDiscoveryStreamEvent,
} from "../api";
import {
  buildTimelineRenderEntries,
} from "../chat/timelinePresenter";
import {
  buildAgentBranches,
  timelineForAgentBranch,
} from "../chat/agentBranches";
import { AgentCommunications } from "../chat/AgentCommunications";
import { AgentTimelineNavigation } from "../chat/AgentTimelineNavigation";
import { TimelineEntry } from "../chat/TimelineEntry";
import { useTimelineScroll } from "../chat/useTimelineScroll";
import { useMobileViewport, dismissKeyboard } from "./useMobileViewport";
import { ThreadTabs, ThreadSwitcher } from "./ThreadTabs";
import { ExecutionProfilePicker, NewThreadSettings } from "./ExecutionProfilePicker";
const ProjectPreviewPicker = lazy(() => import("../preview/ProjectPreviewPicker").then(module => ({ default: module.ProjectPreviewPicker })));
import {
  canOpenWiredPreviewFrame,
  findWiredPreviewSourceConflict,
  previewNeedsPublishedTarget,
  readWiredPreviewOpenUrl,
} from "../preview/projectPreview";
const heartbeatIntervalMs = 2_000;
const missedSocketHeartbeatMs = 4_500;
const recentWorkspaceStorageKey = "liteharness.recentWorkspacePaths.v1";
const maxRecentWorkspacePaths = 8;

type WorkspaceModalTab = "recent" | "new";

type RecentWorkspaceItem = {
  displayPath: string;
  title: string;
  workspacePath: string;
};

export function MobileShell() {
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [harnesses, setHarnesses] = useState<HarnessSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => readLocalValue<string | null>("liteharness.activeThread.v1", null));
  const [timelinesByThreadId, setTimelinesByThreadId] = useState<Record<string, TimelineEventRecord[]>>({});
  const [selectedAgentBranchId, setSelectedAgentBranchId] = useState<string | null>(null);
  const [optimisticTimeline, setOptimisticTimeline] = useState<TimelineEventRecord[]>([]);
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState("");
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfileSummary[]>([]);
  const [newThreadProfileId, setNewThreadProfileId] = useState("");
  const preferredNewThreadProfileRef = useRef<string | null>(null);
  const [newThreadFastMode, setNewThreadFastMode] = useState<boolean | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [promptDraftsByThreadId, setPromptDraftsByThreadId] = useState<Record<string, string>>(() => readLocalValue("liteharness.promptDrafts.v1", {}));
  const [error, setError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingRunId, setWaitingRunId] = useState<string | null>(null);
  const [optimisticMessageInFlightId, setOptimisticMessageInFlightId] = useState<string | null>(null);
  const [socketRevision, setSocketRevision] = useState(0);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [tabManagerOpen, setTabManagerOpen] = useState(false);
  const [closedThreads, setClosedThreads] = useState<ThreadRecord[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [stoppingThreads, setStoppingThreads] = useState(false);
  const [undoThreads, setUndoThreads] = useState<ThreadRecord[]>([]);
  const closedIdsRef = useRef(new Set<string>());
  const closingIdsRef = useRef(new Set<string>());
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [renameTitle, setRenameTitle] = useState("");
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceConfigState, setWorkspaceConfigState] = useState<"loading" | "ready" | "failed">("loading");
  const workspaceConfigRequestRef = useRef(0);
  const [workspaceModalTab, setWorkspaceModalTab] = useState<WorkspaceModalTab>("recent");
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceDiscoveryEvents, setWorkspaceDiscoveryEvents] = useState<WorkspaceDiscoveryStreamEvent[]>([]);
  const [workspaceFinding, setWorkspaceFinding] = useState(false);
  const [workspaceSearchStartedAtMs, setWorkspaceSearchStartedAtMs] = useState<number | null>(null);
  const [workspaceModalError, setWorkspaceModalError] = useState<string | null>(null);
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState<string[]>(() => readRecentWorkspacePaths());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPickerOpen, setPreviewPickerOpen] = useState(false);
  const [previewFrameLoaded, setPreviewFrameLoaded] = useState(false);
  const [wiredPreviews, setWiredPreviews] = useState<WiredPreview[]>([]);
  const [previewManifests, setPreviewManifests] = useState<PreviewManifest[]>([]);
  const [wiredPreviewSearch, setWiredPreviewSearch] = useState("");
  const [wiredPreviewLoading, setWiredPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewWiringBrief, setPreviewWiringBrief] = useState("");
  const [previewManifestNameDrafts, setPreviewManifestNameDrafts] = useState<Record<string, string>>({});
  const [editingWiredPreviewId, setEditingWiredPreviewId] = useState<string | null>(null);
  const [editingWiredPreviewName, setEditingWiredPreviewName] = useState("");
  const [copiedPreviewLinkId, setCopiedPreviewLinkId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingRunStartMsByThreadId, setPendingRunStartMsByThreadId] = useState<Record<string, number>>({});
  const [localRunStartMsByRunId, setLocalRunStartMsByRunId] = useState<Record<string, number>>({});
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const contentRef = useRef<HTMLElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const surfaceKey = settingsOpen ? "settings" : workspaceModalOpen ? "workspace" : "chat";
  const { keyboardVisible } = useMobileViewport(footerRef, surfaceKey);
  const lastSocketHeartbeatAtRef = useRef(Date.now());
  const lastTimelineThreadIdRef = useRef<string | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const recoveryInFlightRef = useRef<{ promise: Promise<void>; threadId: string } | null>(null);
  const pendingRecoveryThreadIdsRef = useRef(new Set<string>());
  const workspaceInputRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceSearchControllerRef = useRef<AbortController | null>(null);
  const creatingThreadRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const copiedPreviewLinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optimisticEventCounterRef = useRef(0);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );
  const menuThread = useMemo(
    () => threads.find((thread) => thread.id === threadMenuId) ?? null,
    [threadMenuId, threads],
  );
  const draftKey = activeThreadId ? `${activeThreadId}${selectedAgentBranchId ? `:agent:${selectedAgentBranchId}` : ""}` : "";
  const attachmentDrafts = useAttachmentDrafts();
  const selectedFiles = attachmentDrafts.drafts[draftKey] ?? [];
  const filesReady = selectedFiles.every(file => Boolean(file.attachment));
  const prompt = draftKey ? promptDraftsByThreadId[draftKey] ?? "" : "";
  const timeline = activeThreadId ? timelinesByThreadId[activeThreadId] ?? [] : [];
  const visibleTimeline = useMemo(
    () => timelineWithOptimisticEvents(timeline, optimisticTimeline, activeThreadId),
    [activeThreadId, optimisticTimeline, timeline],
  );
  const agentBranches = useMemo(
    () => buildAgentBranches(
      visibleTimeline,
      activeThread?.harnessThreadId ?? activeThread?.id ?? "",
    ),
    [activeThread?.harnessThreadId, activeThread?.id, visibleTimeline],
  );
  const selectedAgent = agentBranches.find(branch => branch.id === selectedAgentBranchId) ?? null;
  const canMessageAgent = Boolean(selectedAgent && selectedAgent.status === "running" && activeThread && isActiveThreadStatus(activeThread.status));
  const selectedTimeline = useMemo(
    () => timelineForAgentBranch(visibleTimeline, selectedAgentBranchId),
    [selectedAgentBranchId, visibleTimeline],
  );
  const renderEntries = useMemo(
    () => buildTimelineRenderEntries(selectedTimeline),
    [selectedTimeline],
  );
  const viewKey = `${activeThreadId ?? "empty"}:${selectedAgentBranchId ?? "main"}`;
  const timelineScroll = useTimelineScroll(contentRef, viewKey, renderEntries, surfaceKey === "chat");
  const [entryStarts, setEntryStarts] = useState<Record<string, number>>({});
  const hiddenEntryCount = Math.min(entryStarts[viewKey] ?? Math.max(0, renderEntries.length - 100), renderEntries.length);
  useEffect(() => {
    if (renderEntries.length) setEntryStarts(current => viewKey in current ? current : { ...current, [viewKey]: Math.max(0, renderEntries.length - 100) });
  }, [viewKey, renderEntries.length]);
  const shownEntries = hiddenEntryCount ? renderEntries.slice(hiddenEntryCount) : renderEntries;

  const recentWorkspaceItems = useMemo(
    () => buildRecentWorkspaceItems({
      currentWorkspacePath: workspacePath,
      defaultWorkspacePath,
      recentWorkspacePaths,
    }),
    [defaultWorkspacePath, recentWorkspacePaths, workspacePath],
  );
  const wiredPreviewById = useMemo(
    () => new Map(wiredPreviews.map((preview) => [preview.id, preview])),
    [wiredPreviews],
  );
  const activeWiredPreview = activeThread?.wiredPreviewId
    ? wiredPreviewById.get(activeThread.wiredPreviewId) ?? null
    : null;
  const activeWiredPreviewId = activeThread?.wiredPreviewId ?? null;
  const activeWiredPreviewSourceConflict = activeWiredPreview
    ? findWiredPreviewSourceConflict(wiredPreviews, activeWiredPreview)
    : null;
  const activeWiredPreviewOpenUrl = activeWiredPreview ? readWiredPreviewOpenUrl(activeWiredPreview) : "";
  const activeWiredPreviewCanOpenFrame = activeWiredPreview
    ? canOpenWiredPreviewFrame(activeWiredPreview) && !activeWiredPreviewSourceConflict
    : false;
  const previewFrameUrl = activeWiredPreviewCanOpenFrame ? activeWiredPreviewOpenUrl : "";
  const pendingManifestByPreviewId = useMemo(() => {
    const map = new Map<string, PreviewManifest>();
    for (const manifest of previewManifests) {
      const previewId = manifest.wiredPreviewId ?? manifest.approvedWiredPreviewId;
      if (previewId) {
        map.set(previewId, manifest);
      }
    }
    return map;
  }, [previewManifests]);
  const harnessByType = useMemo(
    () => new Map(harnesses.map((harness) => [harness.type, harness])),
    [harnesses],
  );
  const fastModeSupported = Boolean(activeThread && harnessByType.get(activeThread.harnessType)?.capabilities.fastMode);
  const fastModeEnabled = Boolean(activeThread && fastModeSupported && activeThread.fastMode);

  useEffect(() => {
    let closed = false;
    let retryTimer: number | undefined;
    const load = async () => {
      try {
        await refreshInitialState(() => !closed);
        if (!closed) setStartupError(null);
      } catch (nextError) {
        if (closed) return;
        setStartupError(readError(nextError));
        retryTimer = window.setTimeout(() => { void load(); }, heartbeatIntervalMs);
      }
    };
    void load();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    setSelectedAgentBranchId(null);
  }, [activeThreadId]);

  useEffect(() => {
    writeLocalValue("liteharness.activeThread.v1", activeThreadId);
  }, [activeThreadId]);
  useEffect(() => {
    const timer = window.setTimeout(() => writeLocalValue("liteharness.promptDrafts.v1", promptDraftsByThreadId), 200);
    return () => { window.clearTimeout(timer); writeLocalValue("liteharness.promptDrafts.v1", promptDraftsByThreadId); };
  }, [promptDraftsByThreadId]);

  useEffect(() => {
    if (!undoThreads.length) return;
    const timer = window.setTimeout(() => setUndoThreads([]), 8_000);
    return () => window.clearTimeout(timer);
  }, [undoThreads]);

  useEffect(() => {
    const input = promptInputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }, [prompt, activeThreadId, surfaceKey]);

  useEffect(() => {
    const input = workspaceInputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }, [workspaceModalOpen, workspaceModalTab, workspaceQuery]);

  useEffect(() => {
    if (!activeThreadId) {
      setWaitingRunId(null);
      setOptimisticTimeline([]);
      setOptimisticMessageInFlightId(null);
      return undefined;
    }

    let closed = false;
    let reconnectTimer: number | undefined;
    if (lastTimelineThreadIdRef.current !== activeThreadId) {
      void fetchTimeline(activeThreadId).then((events) => {
        if (!closed && !closedIdsRef.current.has(activeThreadId)) {
          lastTimelineThreadIdRef.current = activeThreadId;
          setThreadTimeline(activeThreadId, (current) => mergeTimelineSnapshot(events, current));
          setConnectionError(null);
        }
      }).catch((nextError: unknown) => {
        if (closed) return;
        if (isMissingThreadError(nextError)) {
          handleMissingThread(activeThreadId);
          return;
        }
        pendingRecoveryThreadIdsRef.current.add(activeThreadId);
        setConnectionError(readError(nextError));
      });
    }

    lastSocketHeartbeatAtRef.current = Date.now();
    const disconnect = connectTimeline(activeThreadId, (event) => {
      if (closed || closedIdsRef.current.has(event.threadId)) return;
      appendTimelineEvent(event);
      const status = !event.payload.agentThreadId ? threadStatusFromEvent(event.type) : null;
      if (status) setThreads(current => current.map(thread => thread.id === event.threadId && thread.status !== status ? { ...thread, status } : thread));
    }, {
      onDisconnect: () => {
        if (closed || reconnectTimer !== undefined) return;
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          void recoverBackendStateForThread(activeThreadId).catch((nextError: unknown) => {
            if (!closed) setConnectionError(readError(nextError));
          });
        }, heartbeatIntervalMs);
      },
      onHeartbeat: (_serverTime, status) => {
        if (closed) return;
        lastSocketHeartbeatAtRef.current = Date.now();
        if (status) {
          setThreads(current => current.some(thread => thread.id === activeThreadId && thread.status !== status)
            ? current.map(thread => thread.id === activeThreadId ? { ...thread, status } : thread)
            : current);
          if (!isActiveThreadStatus(status)) setWaitingRunId(null);
        }
      },
    });

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      disconnect();
    };
  }, [activeThreadId, socketRevision]);

  useEffect(() => {
    setOptimisticTimeline((current) => removeCommittedOptimisticEvents(current, timeline));
  }, [timeline]);

  useEffect(() => {
    if (!activeThreadId) {
      return undefined;
    }

    let closed = false;
    const recover = async () => {
      if (closed) return;
      await recoverBackendStateForThread(activeThreadId);
    };
    const pulse = async () => {
      if (closed || !pendingRecoveryThreadIdsRef.current.has(activeThreadId)
        && Date.now() - lastSocketHeartbeatAtRef.current <= missedSocketHeartbeatMs) {
        return;
      }
      await recover();
    };
    const heartbeat = window.setInterval(() => {
      void pulse().catch((nextError: unknown) => {
        if (!closed) setConnectionError(readError(nextError));
      });
    }, heartbeatIntervalMs);
    const recoverNow = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void recover().catch((nextError: unknown) => {
        if (!closed) setConnectionError(readError(nextError));
      });
    };

    window.addEventListener("focus", recoverNow);
    window.addEventListener("online", recoverNow);
    document.addEventListener("visibilitychange", recoverNow);

    return () => {
      closed = true;
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", recoverNow);
      window.removeEventListener("online", recoverNow);
      document.removeEventListener("visibilitychange", recoverNow);
    };
  }, [activeThreadId]);

  useEffect(() => {
    if (!waitingRunId) return;
    const harnessResponded = timeline.some((event) => event.runId === waitingRunId && event.type !== "run.submitted");
    if (harnessResponded) {
      setWaitingRunId(null);
    }
  }, [timeline, waitingRunId]);

  useEffect(() => {
    setPreviewPickerOpen(!activeWiredPreviewId || !activeWiredPreviewCanOpenFrame);
  }, [activeWiredPreviewCanOpenFrame, activeWiredPreviewId]);

  useEffect(() => {
    const wiredPreviewId = activeThread?.wiredPreviewId;
    if (!wiredPreviewId || wiredPreviewById.has(wiredPreviewId)) {
      return undefined;
    }

    let disposed = false;
    getWiredPreview(wiredPreviewId).then((preview) => {
      if (!disposed) {
        setWiredPreviews((current) => [
          preview,
          ...current.filter((item) => item.id !== preview.id),
        ]);
      }
    }).catch((nextError: unknown) => {
      if (!disposed && previewOpen) {
        setPreviewError(readError(nextError));
      }
    });

    return () => {
      disposed = true;
    };
  }, [activeThread?.wiredPreviewId, previewOpen, wiredPreviewById]);

  useEffect(() => {
    if (previewOpen && previewFrameUrl) {
      setPreviewFrameLoaded(false);
    }
  }, [previewFrameUrl, previewOpen]);

  useEffect(() => () => {
    workspaceConfigRequestRef.current++;
    workspaceSearchControllerRef.current?.abort();
    if (copiedPreviewLinkTimerRef.current) {
      clearTimeout(copiedPreviewLinkTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (event.defaultPrevented || event.isComposing) return;
      // Native dialog cancellation must still work when an asynchronous update
      // removes/disables its focused control and key events target the body.
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (previewOpen) { setPreviewOpen(false); return; }
      if (tabManagerOpen) { setTabManagerOpen(false); return; }
      if (threadMenuId) { closeThreadMenu(); return; }
      if (workspaceModalOpen) { closeWorkspaceModal(); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (document.activeElement?.matches("input, textarea, [contenteditable='true']")) { dismissKeyboard(); return; }
      void handleCancelActiveRun();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeThread, busy, waitingRunId, previewOpen, tabManagerOpen, threadMenuId, workspaceModalOpen, settingsOpen]);

  useEffect(() => {
    if (!workspaceFinding && (!activeThread || activeThread.status !== "running" && !waitingRunId && !optimisticMessageInFlightId)) {
      return undefined;
    }
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [activeThread, optimisticMessageInFlightId, waitingRunId, workspaceFinding]);

  function setThreadTimeline(
    threadId: string,
    update: TimelineEventRecord[] | ((current: TimelineEventRecord[]) => TimelineEventRecord[]),
  ) {
    setTimelinesByThreadId((current) => {
      const currentTimeline = current[threadId] ?? [];
      const nextTimeline = typeof update === "function" ? update(currentTimeline) : update;
      return nextTimeline === currentTimeline
        ? current
        : { ...current, [threadId]: nextTimeline };
    });
  }

  function appendTimelineEvent(event: TimelineEventRecord) {
    setThreadTimeline(event.threadId, (current) => (
      current.some((existing) => existing.id === event.id)
        ? current
        : [...current, event]
    ));
  }

  function removeThreadTimeline(threadId: string) {
    setTimelinesByThreadId((current) => removeRecordKey(current, threadId));
  }

  async function refreshInitialState(isCurrent: () => boolean) {
    const [config, nextHarnesses, nextThreads] = await Promise.all([
      fetchAppConfig(),
      fetchHarnesses(),
      fetchThreads(),
    ]);
    if (!isCurrent()) return;
    applyAppConfig(config);
    setHarnesses(nextHarnesses);
    setThreads(nextThreads.filter(thread => !closedIdsRef.current.has(thread.id)));
    const currentThreadId = activeThreadIdRef.current;
    const currentThread = currentThreadId
      ? nextThreads.find((thread) => thread.id === currentThreadId)
      : null;
    const nextActiveThread = currentThread ?? nextThreads[0] ?? null;
    if (nextActiveThread) {
      if (nextActiveThread.id !== currentThreadId) {
        setActiveThreadId(nextActiveThread.id);
      }
      setWorkspacePath(nextActiveThread.workspacePath);
      return;
    }
    setActiveThreadId(null);
    setTimelinesByThreadId({});
    setWorkspacePath((current) => current.trim() ? current : config.defaultWorkspacePath);
  }

  function applyAppConfig(config: AppConfig) {
    setDefaultWorkspacePath(config.defaultWorkspacePath);
    const profiles = config.profiles ?? [];
    setExecutionProfiles(profiles);
    const profileId = profiles.find(profile => profile.id === preferredNewThreadProfileRef.current)?.id
      ?? profiles.find(profile => profile.id === config.defaultProfileId)?.id ?? profiles[0]?.id ?? "";
    if (profileId !== newThreadProfileId) setNewThreadFastMode(null);
    setNewThreadProfileId(profileId);
  }

  async function refreshWorkspaceConfig() {
    const requestId = ++workspaceConfigRequestRef.current;
    setWorkspaceConfigState("loading");
    setWorkspaceModalError(null);
    try {
      const config = await fetchAppConfig();
      if (workspaceConfigRequestRef.current !== requestId) return;
      if (!config.profiles?.length) throw new Error("No execution profiles available");
      applyAppConfig(config);
      setWorkspaceConfigState("ready");
    } catch (nextError) {
      if (workspaceConfigRequestRef.current !== requestId) return;
      setWorkspaceConfigState("failed");
      setWorkspaceModalError(readError(nextError));
    }
  }

  async function refreshBackendStateForThread(threadId: string) {
    let state;
    try {
      state = await fetchThreadState(threadId);
    } catch (nextError) {
      if (isMissingThreadError(nextError)) {
        handleMissingThread(threadId);
        return;
      }
      pendingRecoveryThreadIdsRef.current.add(threadId);
      throw nextError;
    }
    if (closedIdsRef.current.has(threadId)) return;
    setThreads((current) => {
      if (current.some((thread) => thread.id === state.thread.id)) {
        return current.map((thread) => thread.id === state.thread.id ? state.thread : thread);
      }
      return [state.thread, ...current];
    });
    setThreadTimeline(threadId, (current) => mergeTimelineSnapshot(state.timeline, current));
    pendingRecoveryThreadIdsRef.current.delete(threadId);
    if (activeThreadIdRef.current === threadId) {
      lastTimelineThreadIdRef.current = threadId;
      setConnectionError(null);
      if (state.thread.status !== "running") {
        setWaitingRunId(null);
      }
    }
  }

  async function refreshAfterOperation(threadId: string) {
    try {
      await refreshBackendStateForThread(threadId);
    } catch (nextError) {
      // The write already succeeded. Only its snapshot needs retrying.
      if (activeThreadIdRef.current === threadId) setConnectionError(readError(nextError));
    }
  }

  function recoverBackendStateForThread(threadId: string): Promise<void> {
    const currentRecovery = recoveryInFlightRef.current;
    if (currentRecovery?.threadId === threadId) {
      return currentRecovery.promise;
    }

    const promise = refreshBackendStateForThread(threadId).then(() => {
      if (activeThreadIdRef.current === threadId) {
        setConnectionError(null);
        lastSocketHeartbeatAtRef.current = Date.now();
        setSocketRevision((current) => current + 1);
      }
    }).finally(() => {
      if (recoveryInFlightRef.current?.promise === promise) {
        recoveryInFlightRef.current = null;
      }
    });
    recoveryInFlightRef.current = { promise, threadId };
    return promise;
  }

  function handleMissingThread(threadId: string) {
    writePromptDraftForThread(threadId, "");
    removeThreadTimeline(threadId);
    setThreads((current) => {
      const nextThreads = current.filter((thread) => thread.id !== threadId);
      if (activeThreadIdRef.current === threadId) {
        const nextThread = nextThreads[0] ?? null;
        activeThreadIdRef.current = nextThread?.id ?? null;
        setActiveThreadId(nextThread?.id ?? null);
        setWorkspacePath(nextThread?.workspacePath ?? defaultWorkspacePath);
        setWaitingRunId(null);
        setOptimisticMessageInFlightId(null);
      }
      return nextThreads;
    });
  }

  function handleOpenWorkspaceModal() {
    dismissKeyboard();
    const homeWorkspacePath = defaultWorkspacePath || workspacePath.trim();
    if (!homeWorkspacePath) {
      setError("Default workspace is still loading");
      return;
    }
    setError(null);
    setThreadMenuId(null);
    setWorkspaceModalTab("recent");
    setWorkspaceQuery("");
    setWorkspaceModalError(null);
    setWorkspaceDiscoveryEvents([]);
    setWorkspaceModalOpen(true);
    void refreshWorkspaceConfig();
  }

  function handleOpenSettings() {
    dismissKeyboard();
    closeThreadMenu();
    setSettingsOpen(true);
  }

  function closeWorkspaceModal() {
    if (creatingThreadRef.current) return;
    workspaceConfigRequestRef.current++;
    dismissKeyboard();
    workspaceSearchControllerRef.current?.abort();
    workspaceSearchControllerRef.current = null;
    setWorkspaceModalOpen(false);
    setWorkspaceFinding(false);
    setWorkspaceSearchStartedAtMs(null);
    setWorkspaceModalError(null);
    setWorkspaceDiscoveryEvents([]);
  }

  function rememberRecentWorkspacePath(workspacePathToRemember: string) {
    const normalizedPath = normalizeWorkspacePath(workspacePathToRemember);
    if (!normalizedPath) {
      return;
    }
    setRecentWorkspacePaths((current) => {
      const next = dedupeWorkspacePaths([normalizedPath, ...current]).slice(0, maxRecentWorkspacePaths);
      writeRecentWorkspacePaths(next);
      return next;
    });
  }

  function seedPreviewManifestNameDrafts(manifests: PreviewManifest[]) {
    setPreviewManifestNameDrafts((current) => {
      const next: Record<string, string> = {};
      for (const manifest of manifests) {
        next[manifest.id] = current[manifest.id] ?? manifest.proposedName;
      }
      return next;
    });
  }

  async function refreshWiredPreviews(search = wiredPreviewSearch) {
    setWiredPreviewLoading(true);
    setPreviewError(null);
    try {
      const [previews, manifests] = await Promise.all([
        listWiredPreviews(search),
        listPreviewManifests("pending"),
      ]);
      setWiredPreviews(previews);
      setPreviewManifests(manifests);
      seedPreviewManifestNameDrafts(manifests);
      return previews;
    } catch (nextError) {
      setPreviewError(readError(nextError));
      return [];
    } finally {
      setWiredPreviewLoading(false);
    }
  }

  function openPreview() {
    dismissKeyboard();
    if (!activeThread) {
      setError("Open a thread before using preview.");
      return;
    }
    closeThreadMenu();
    setSettingsOpen(false);
    setPreviewError(null);
    setPreviewPickerOpen(!activeWiredPreview || !activeWiredPreviewCanOpenFrame);
    setPreviewOpen(true);
    void refreshWiredPreviews();
  }

  function openPreviewPicker() {
    setPreviewError(null);
    setPreviewPickerOpen(true);
    void refreshWiredPreviews();
  }

  function showPreviewFrame() {
    if (!previewFrameUrl || !activeWiredPreviewCanOpenFrame) {
      setPreviewError("No openable preview is attached.");
      return;
    }
    setPreviewPickerOpen(false);
    setPreviewError(null);
  }

  async function attachWiredPreview(preview: WiredPreview) {
    if (!activeThreadId) {
      setPreviewError("Open a thread before attaching a preview.");
      return;
    }
    setBusy(true);
    setPreviewError(null);
    try {
      const updated = await attachWiredPreviewToThread(activeThreadId, preview.id);
      setThreads((current) => current.map((thread) => thread.id === updated.id ? updated : thread));
      setPreviewFrameLoaded(false);
      setPreviewPickerOpen(!canOpenWiredPreviewFrame(preview) || Boolean(findWiredPreviewSourceConflict(wiredPreviews, preview)));
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function detachActiveWiredPreview() {
    if (!activeThreadId) {
      setPreviewError("Open a thread before detaching a preview.");
      return;
    }
    setBusy(true);
    setPreviewError(null);
    try {
      const updated = await detachWiredPreviewFromThread(activeThreadId);
      setThreads((current) => current.map((thread) => thread.id === updated.id ? updated : thread));
      setPreviewPickerOpen(true);
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function publishMissingPreviewOrigins(preview: WiredPreview) {
    const needsTargetPublish = previewNeedsPublishedTarget(preview);
    const needsBrowserDirectPublish = preview.dependencyServices.some((service, serviceIndex) => (
      service.browserDirect
      && !preview.publishedOrigins.some((origin) => (
        origin.source === "dependency-service"
        && origin.dependencyServiceIndex === serviceIndex
        && origin.status === "published"
        && origin.publishedUrl
      ))
    ));
    if (!needsTargetPublish && !needsBrowserDirectPublish) {
      setPreviewError("No missing private origins found.");
      return;
    }

    setBusy(true);
    setPreviewError(null);
    try {
      let updatedPreview = preview;
      if (needsTargetPublish) {
        updatedPreview = (await publishPreviewTarget(preview.id)).wiredPreview;
      }
      if (needsBrowserDirectPublish) {
        updatedPreview = (await publishBrowserDirectPreviewServices(preview.id)).wiredPreview;
      }
      setWiredPreviews((current) => [
        updatedPreview,
        ...current.filter((item) => item.id !== updatedPreview.id),
      ]);
      if (activeThread?.wiredPreviewId === updatedPreview.id) {
        setPreviewFrameLoaded(false);
      }
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function approvePreviewManifestForThread(manifest: PreviewManifest) {
    if (!activeThreadId) {
      setPreviewError("Open a thread before approving a manifest.");
      return;
    }
    const name = (previewManifestNameDrafts[manifest.id] ?? manifest.proposedName).trim();
    if (!name) {
      setPreviewError("Preview name is required.");
      return;
    }

    setBusy(true);
    setPreviewError(null);
    try {
      const approval = await approvePreviewManifest(manifest.id, name);
      const updatedThread = await attachWiredPreviewToThread(activeThreadId, approval.wiredPreview.id);
      setWiredPreviews((current) => [
        approval.wiredPreview,
        ...current.filter((item) => item.id !== approval.wiredPreview.id),
      ]);
      setPreviewManifests((current) => current.filter((item) => item.id !== approval.manifest.id));
      setThreads((current) => current.map((thread) => thread.id === updatedThread.id ? updatedThread : thread));
      setPreviewFrameLoaded(false);
      setPreviewPickerOpen(
        !canOpenWiredPreviewFrame(approval.wiredPreview)
        || Boolean(findWiredPreviewSourceConflict([...wiredPreviews, approval.wiredPreview], approval.wiredPreview)),
      );
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  function previewToInput(preview: WiredPreview, name = preview.name): WiredPreviewInput {
    return {
      commands: preview.commands,
      dependencyServices: preview.dependencyServices,
      name,
      projectDirectory: preview.projectDirectory,
      requestedPublishedOrigins: preview.requestedPublishedOrigins,
      target: preview.target,
    };
  }

  function startRenamingWiredPreview(preview: WiredPreview) {
    setEditingWiredPreviewId(preview.id);
    setEditingWiredPreviewName(preview.name);
    setPreviewError(null);
  }

  async function saveWiredPreviewName(preview: WiredPreview) {
    const name = editingWiredPreviewName.trim();
    if (!name) {
      setPreviewError("Preview name is required.");
      return;
    }
    setBusy(true);
    setPreviewError(null);
    try {
      const updated = await updateWiredPreview(preview.id, previewToInput(preview, name));
      setWiredPreviews((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingWiredPreviewId(null);
      setEditingWiredPreviewName("");
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function removeWiredPreview(preview: WiredPreview) {
    setBusy(true);
    setPreviewError(null);
    try {
      await deleteWiredPreview(preview.id);
      setWiredPreviews((current) => current.filter((item) => item.id !== preview.id));
      setThreads((current) => current.map((thread) => (
        thread.wiredPreviewId === preview.id ? { ...thread, wiredPreviewId: null } : thread
      )));
      if (activeThread?.wiredPreviewId === preview.id) {
        setPreviewPickerOpen(true);
      }
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function openPreviewWiringThread(preview?: WiredPreview) {
    const projectSearchBrief = (preview ? preview.name : previewWiringBrief).trim();
    if (!projectSearchBrief) {
      setPreviewError("Describe the project before starting a wiring thread.");
      return;
    }

    setBusy(true);
    setPreviewError(null);
    try {
      const launch = await launchPreviewWiringThread({
        projectSearchBrief,
        ...(activeThreadId ? { sourceThreadId: activeThreadId } : {}),
        ...(preview ? { wiredPreviewId: preview.id } : {}),
      });
      setThreads((current) => [
        launch.thread,
        ...current.filter((thread) => thread.id !== launch.thread.id),
      ]);
      setActiveThreadId(launch.thread.id);
      setWorkspacePath(launch.thread.workspacePath);
      const launchedPreview = launch.wiredPreview;
      if (launchedPreview) {
        setWiredPreviews((current) => [
          launchedPreview,
          ...current.filter((item) => item.id !== launchedPreview.id),
        ]);
      }
      setPreviewWiringBrief("");
      setPreviewOpen(false);
    } catch (nextError) {
      setPreviewError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  function reviewPreviewManifest(manifest?: PreviewManifest) {
    if (!manifest) {
      setPreviewError("No pending manifest is available for this preview.");
      return;
    }
    setPreviewError(null);
    document.getElementById(`preview-manifest-${manifest.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  async function copyPreviewLink(preview: WiredPreview, url: string) {
    if (!window.navigator.clipboard) {
      setPreviewError("Clipboard is not available.");
      return;
    }
    setPreviewError(null);
    try {
      await window.navigator.clipboard.writeText(url);
      setCopiedPreviewLinkId(preview.id);
      if (copiedPreviewLinkTimerRef.current) {
        clearTimeout(copiedPreviewLinkTimerRef.current);
      }
      copiedPreviewLinkTimerRef.current = setTimeout(() => {
        setCopiedPreviewLinkId(null);
        copiedPreviewLinkTimerRef.current = null;
      }, 1600);
    } catch {
      setPreviewError("Failed to copy preview link.");
    }
  }

  async function handleFindWorkspace() {
    if (busy || workspaceSearchControllerRef.current) return;
    const description = workspaceQuery.trim();
    if (!description) {
      setWorkspaceModalError("Describe a workspace first");
      return;
    }
    const controller = new AbortController();
    workspaceSearchControllerRef.current = controller;
    setWorkspaceSearchStartedAtMs(Date.now());
    setWorkspaceFinding(true);
    setWorkspaceModalError(null);
    setWorkspaceDiscoveryEvents([]);
    try {
      for await (const event of discoverWorkspaceStream({ description }, { signal: controller.signal })) {
        if (controller.signal.aborted) return;
        setWorkspaceDiscoveryEvents((current) => [...current, event]);
        if (event.type === "workspace.search.failed") {
          setWorkspaceModalError(event.error ?? event.text);
        }
      }
    } catch (nextError) {
      if (!controller.signal.aborted) setWorkspaceModalError(readError(nextError));
    } finally {
      if (workspaceSearchControllerRef.current === controller) {
        workspaceSearchControllerRef.current = null;
        setWorkspaceFinding(false);
        setWorkspaceSearchStartedAtMs(null);
      }
    }
  }

  async function handleCreateThreadFromWorkspace(workspace: RecentWorkspaceItem) {
    await handleCreateThread({
      title: workspace.title,
      workspacePath: workspace.workspacePath,
    });
  }

  async function handleCreateThread(input: { title: string; workspacePath: string }) {
    if (creatingThreadRef.current || workspaceConfigState !== "ready" || !newThreadProfileId) return;
    creatingThreadRef.current = true;
    setBusy(true);
    setError(null);
    setWorkspaceModalError(null);
    try {
      const thread = await createThread({
        ...input,
        profileId: newThreadProfileId,
        fastMode: newThreadFastModeEnabled,
      });
      setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
      setActiveThreadId(thread.id);
      setWorkspacePath(thread.workspacePath);
      rememberRecentWorkspacePath(thread.workspacePath);
      creatingThreadRef.current = false;
      closeWorkspaceModal();
    } catch (nextError) {
      setWorkspaceModalError(readError(nextError));
    } finally {
      creatingThreadRef.current = false;
      setBusy(false);
    }
  }

  function closeThreadMenu() {
    setThreadMenuId(null);
  }

  function writePromptDraftForThread(threadId: string, value: string) {
    setPromptDraftsByThreadId((current) => {
      if (!value) {
        if (!(threadId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[threadId];
        return next;
      }
      if (current[threadId] === value) {
        return current;
      }
      return { ...current, [threadId]: value };
    });
  }

  async function toggleFastMode() {
    if (!activeThread || !fastModeSupported) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await updateThreadSettings(activeThread.id, {
        fastMode: !activeThread.fastMode,
      });
      setThreads((current) => current.map((thread) => thread.id === updated.id ? updated : thread));
    } catch (nextError) {
      setError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileChange(thread: ThreadRecord, profileId: string) {
    if (thread.profileId === profileId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await updateThreadSettings(thread.id, { profileId });
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (nextError) {
      setError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  function handleOpenThreadMenu(thread: ThreadRecord) {
    dismissKeyboard();
    if (threadMenuId === thread.id) {
      closeThreadMenu();
      return;
    }
    setThreadMenuId(thread.id);
    setRenameTitle(thread.title);
  }

  async function handleRenameThread(thread: ThreadRecord) {
    const title = renameTitle.trim();
    if (!title || title === thread.title) {
      closeThreadMenu();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await renameThread(thread.id, title);
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
      closeThreadMenu();
    } catch (nextError) {
      setError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  function selectThread(thread: ThreadRecord) {
    activeThreadIdRef.current = thread.id;
    setActiveThreadId(thread.id);
    setWorkspacePath(thread.workspacePath);
    setWaitingRunId(null);
    closeThreadMenu();
    setTabManagerOpen(false);
    dismissKeyboard();
  }

  async function openTabManager() {
    dismissKeyboard();
    closeThreadMenu();
    setTabManagerOpen(true);
    setClosedLoading(true);
    try { setClosedThreads(await fetchClosedThreads()); }
    catch (nextError) { setError(readError(nextError)); }
    finally { setClosedLoading(false); }
  }

  async function handleCloseThreads(requested: ThreadRecord[]) {
    const closing = requested.filter(thread => !isActiveThreadStatus(thread.status) && !closingIdsRef.current.has(thread.id));
    if (!closing.length) return;
    const ids = new Set(closing.map(thread => thread.id));
    for (const id of ids) { closingIdsRef.current.add(id); closedIdsRef.current.add(id); }
    const current = threadsRef.current;
    const index = current.findIndex(thread => thread.id === activeThreadIdRef.current);
    const remaining = current.filter(thread => !ids.has(thread.id));
    if (ids.has(activeThreadIdRef.current ?? "")) {
      const next = remaining[Math.min(Math.max(0, index), remaining.length - 1)] ?? null;
      activeThreadIdRef.current = next?.id ?? null;
      setActiveThreadId(next?.id ?? null);
      setWorkspacePath(next?.workspacePath ?? defaultWorkspacePath);
      setWaitingRunId(null);
    }
    setThreads(current => current.filter(thread => !ids.has(thread.id)));
    closeThreadMenu();
    setError(null);
    try {
      const result = closing.length === 1
        ? (await closeThread(closing[0]!.id), { closedIds: [closing[0]!.id], skippedIds: [] as string[] })
        : await closeThreads([...ids]);
      const successful = closing.filter(thread => result.closedIds.includes(thread.id));
      setUndoThreads(current => [...current.filter(thread => !ids.has(thread.id)), ...successful]);
      setClosedThreads(current => [...successful, ...current.filter(thread => !ids.has(thread.id))]);
      for (const thread of successful) { removeThreadTimeline(thread.id); timelineScroll.forgetThread(thread.id); }
      const skipped = closing.filter(thread => !result.closedIds.includes(thread.id));
      for (const thread of skipped) closedIdsRef.current.delete(thread.id);
      if (skipped.length) {
        setThreads(current => [...current, ...skipped.filter(thread => !current.some(item => item.id === thread.id))]);
        setError(`${skipped.length} working thread${skipped.length === 1 ? " stays" : "s stay"} open`);
      }
    } catch (nextError) {
      for (const id of ids) closedIdsRef.current.delete(id);
      setThreads(current => [...current, ...closing.filter(thread => !current.some(item => item.id === thread.id))]);
      if (!activeThreadIdRef.current) selectThread(closing[0]!);
      setError(readError(nextError));
    } finally { for (const id of ids) closingIdsRef.current.delete(id); }
  }

  async function handleStopAndCloseAll() {
    if (stoppingThreads) return;
    setStoppingThreads(true);
    setError(null);
    const targets = threadsRef.current;
    try {
      const results = await Promise.allSettled(targets.map(async thread => {
        if (!isActiveThreadStatus(thread.status)) return thread;
        await cancelRun(thread.id);
        return (await fetchThreadState(thread.id)).thread;
      }));
      const stopped = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const byId = new Map(stopped.map(thread => [thread.id, thread]));
      setThreads(current => current.map(thread => byId.get(thread.id) ?? thread));
      await handleCloseThreads(stopped);
      const pending = results.length - stopped.filter(thread => !isActiveThreadStatus(thread.status)).length;
      if (pending) setError(`${pending} thread${pending === 1 ? " is" : "s are"} still stopping or unreachable. Try closing again.`);
    } finally { setStoppingThreads(false); }
  }

  async function handleReopenThread(thread: ThreadRecord) {
    try {
      const reopened = await reopenThread(thread.id);
      closedIdsRef.current.delete(thread.id);
      setThreads(current => [reopened, ...current.filter(item => item.id !== reopened.id)]);
      setClosedThreads(current => current.filter(item => item.id !== reopened.id));
      setUndoThreads(current => current.filter(item => item.id !== reopened.id));
      selectThread(reopened);
    } catch (nextError) { setError(readError(nextError)); }
  }

  async function handleRun() {
    if (busy || !activeThread || (!prompt.trim() && !selectedFiles.length) || !filesReady || selectedAgentBranchId && !canMessageAgent) {
      return;
    }
    const threadId = activeThread.id;
    setBusy(true);
    setError(null);
    const submitted = prompt.trim();
    const submittedFiles = attachmentDrafts.take(draftKey);
    const attachments = submittedFiles.flatMap(file => file.attachment ? [file.attachment] : []);
    const attachmentIds = attachments.map(file => file.id);
    const submittedAtMs = Date.now();
    const steering = Boolean(selectedAgentBranchId) || isActiveThreadStatus(activeThread.status) || Boolean(waitingRunId);
    const optimisticType = steering ? "run.steered" : "run.submitted";
    const optimisticEvent = createOptimisticPromptEvent({
      attachments,
      baselinePromptCount: countPromptEventMatches(timeline, threadId, optimisticType, submitted, selectedAgentBranchId, attachments),
      agentThreadId: selectedAgentBranchId,
      counter: optimisticEventCounterRef.current += 1,
      createdAtMs: submittedAtMs,
      prompt: submitted,
      threadId,
      type: optimisticType,
    });
    setOptimisticTimeline((current) => [...current, optimisticEvent]);
    setOptimisticMessageInFlightId(optimisticEvent.id);
    writePromptDraftForThread(draftKey, "");
    try {
      if (selectedAgentBranchId) {
        const response = await sendAgentInput(threadId, selectedAgentBranchId, submitted, ...(attachmentIds.length ? [attachmentIds] : []));
        if (response.event) appendTimelineEvent(response.event);
      } else if (steering) {
        const response = await sendRunInput(threadId, submitted, ...(attachmentIds.length ? [attachmentIds] : []));
        const event = response.event;
        if (event) {
          appendTimelineEvent(event);
        }
      } else {
        setPendingRunStartMsByThreadId((current) => ({ ...current, [threadId]: submittedAtMs }));
        if (activeThreadIdRef.current === threadId) setWaitingRunId(`pending:${threadId}`);
        const run = await createRun(threadId, submitted, ...(attachmentIds.length ? [{ attachmentIds }] : []));
        setLocalRunStartMsByRunId((current) => ({ ...current, [run.id]: current[run.id] ?? submittedAtMs }));
        setPendingRunStartMsByThreadId((current) => removeRecordKey(current, threadId));
        if (activeThreadIdRef.current === threadId) setWaitingRunId(run.id);
      }
      await refreshAfterOperation(threadId);
    } catch (nextError) {
      attachmentDrafts.restore(draftKey, submittedFiles);
      setOptimisticTimeline((current) => current.filter((event) => event.id !== optimisticEvent.id));
      if (activeThreadIdRef.current === threadId) setWaitingRunId(null);
      setPendingRunStartMsByThreadId((current) => removeRecordKey(current, threadId));
      setPromptDraftsByThreadId((current) => {
        if (current[draftKey]?.trim()) {
          return current;
        }
        return { ...current, [draftKey]: submitted };
      });
      setError(readError(nextError));
    } finally {
      setBusy(false);
      setOptimisticMessageInFlightId(null);
    }
  }

  async function handleCancelActiveRun() {
    if (!activeThread || !canCancelRun || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelRun(activeThread.id);
      setWaitingRunId(null);
      await refreshAfterOperation(activeThread.id);
    } catch (nextError) {
      setError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleInputResponse(
    threadId: string,
    inputRequestId: string,
    answers: Record<string, string[]>,
  ) {
    setBusy(true);
    setError(null);
    try {
      await respondToInput(threadId, inputRequestId, answers);
      await refreshAfterOperation(threadId);
    } catch (nextError) {
      setError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprovalDecision(
    threadId: string,
    approvalId: string,
    approved: boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      await respondToApproval(threadId, approvalId, approved);
      await refreshAfterOperation(threadId);
    } catch (nextError) {
      setError(readError(nextError));
    } finally {
      setBusy(false);
    }
  }

  const timelineActions = useRef({ handleApprovalDecision, handleInputResponse });
  timelineActions.current = { handleApprovalDecision, handleInputResponse };
  const onTimelineApproval = useCallback((...args: Parameters<typeof handleApprovalDecision>) => timelineActions.current.handleApprovalDecision(...args), []);
  const onTimelineInput = useCallback((...args: Parameters<typeof handleInputResponse>) => timelineActions.current.handleInputResponse(...args), []);

  const newThreadProfile = executionProfiles.find(profile => profile.id === newThreadProfileId);
  const newThreadFastModeSupported = Boolean(harnessByType.get("codex")?.capabilities.fastMode);
  const newThreadFastModeEnabled = newThreadFastModeSupported && (newThreadFastMode ?? newThreadProfile?.fastMode ?? false);
  const canCreateThread = !busy && Boolean(newThreadProfile && (defaultWorkspacePath || workspacePath).trim());
  const canFindWorkspace = !busy && !workspaceFinding && Boolean(workspaceQuery.trim());
  const activeThreadCanRun = Boolean(activeThread) && (!selectedAgentBranchId || canMessageAgent);
  const canRun = !busy
    && activeThreadCanRun
    && filesReady
    && Boolean(prompt.trim() || selectedFiles.length);
  const canCancelRun = Boolean(activeThread && (isActiveThreadStatus(activeThread.status) || waitingRunId));
  const optimisticMessageInFlight = Boolean(
    activeThread
    && optimisticMessageInFlightId
    && optimisticTimeline.some((event) => event.id === optimisticMessageInFlightId && event.threadId === activeThread.id),
  );
  const working = Boolean(activeThread && (activeThread.status === "running" || waitingRunId || optimisticMessageInFlight));
  const activeWorkStartedAtMs = activeThread
    ? activeWorkStartMs(
      visibleTimeline,
      activeThread.id,
      waitingRunId,
      optimisticMessageInFlightId,
      pendingRunStartMsByThreadId[activeThread.id] ?? null,
      localRunStartMsByRunId,
    )
    : null;
  const workingDurationText = working
    ? formatWorkDuration(nowMs - (activeWorkStartedAtMs ?? nowMs))
    : "0s";
  const workspaceWorkingDurationText = formatWorkDuration(nowMs - (workspaceSearchStartedAtMs ?? nowMs));
  const workedDurationMs = activeThread && !working
    ? latestWorkedDurationMs(visibleTimeline, activeThread.id, localRunStartMsByRunId)
    : null;
  const workedDurationText = workedDurationMs === null ? null : formatWorkDuration(workedDurationMs);
  const composerIsSteering = Boolean(
    activeThread
    && isActiveThreadStatus(activeThread.status),
  );
  const workspacePageOpen = !settingsOpen && workspaceModalOpen;

  return (
    <div className="lh-mobile-page">
      <header className="lh-mobile-header">
        {settingsOpen ? (
          <div className="lh-mobile-settings-topbar">
            <button
              aria-label="Back to threads"
              className="lh-mobile-topbar-icon-button"
              type="button"
              onClick={() => setSettingsOpen(false)}
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.2} />
            </button>
            <h1 className="lh-mobile-settings-title">Settings</h1>
            <span aria-hidden="true" className="lh-mobile-topbar-spacer" />
          </div>
        ) : workspacePageOpen ? (
          <div className="lh-mobile-workspace-topbar">
            <button
              disabled={busy}
              aria-label="Back to threads"
              className="lh-mobile-topbar-icon-button"
              type="button"
              onClick={closeWorkspaceModal}
            >
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.2} />
            </button>
            <h1 className="lh-mobile-settings-title">New tab</h1>
            <span aria-hidden="true" className="lh-mobile-topbar-spacer" />
          </div>
        ) : (
          <ThreadTabs threads={threads} activeId={activeThreadId} canCreate={canCreateThread}
            onSelect={selectThread}
            onOptions={handleOpenThreadMenu} onManage={() => void openTabManager()}
            onCreate={handleOpenWorkspaceModal} onSettings={handleOpenSettings} />
        )}
        {!settingsOpen && !workspacePageOpen && agentBranches.length > 0 ? <>
          <AgentTimelineNavigation key={activeThreadId} branches={agentBranches} selectedBranchId={selectedAgentBranchId} onSelect={setSelectedAgentBranchId} />
          <AgentCommunications key={`${activeThreadId}:${selectedAgentBranchId ?? "main"}`} events={visibleTimeline} branches={agentBranches}
            mainThreadId={activeThread?.harnessThreadId ?? activeThread?.id ?? ""} selectedBranchId={selectedAgentBranchId} onSelect={setSelectedAgentBranchId} />
        </> : null}
      </header>
        {!settingsOpen && !workspacePageOpen && menuThread ? (
          <button
            aria-label="Close thread menu"
            className="lh-mobile-thread-menu-scrim"
            type="button"
            onClick={closeThreadMenu}
          />
        ) : null}
        {!settingsOpen && !workspacePageOpen && menuThread ? (
          <div className="lh-mobile-thread-menu" role="dialog" aria-modal="true" aria-label={`${menuThread.title} thread options`}>
            <div className="lh-mobile-thread-menu-header">
              <div className="lh-mobile-thread-menu-title">
                <span>Thread</span>
                <strong>{menuThread.title}</strong>
              </div>
              <button
                aria-label="Done"
                className="lh-mobile-thread-menu-icon-button"
                type="button"
                onClick={closeThreadMenu}
              >
                <X aria-hidden="true" size={18} strokeWidth={2.2} />
              </button>
            </div>
            <div className="lh-mobile-thread-menu-workspace">
              <span>Workspace</span>
              <code title={menuThread.workspacePath}>{displayWorkspacePath(menuThread.workspacePath, defaultWorkspacePath)}</code>
            </div>
            <ExecutionProfilePicker
              disabled={busy}
              profiles={executionProfiles}
              selectedProfileId={menuThread.profileId}
              fastMode={menuThread.fastMode}
              onSelect={(profileId) => void handleProfileChange(menuThread, profileId)}
            />
            <form
              className="lh-mobile-thread-rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRenameThread(menuThread);
              }}
            >
              <label htmlFor="liteharness-thread-title">Rename</label>
              <div>
                <input
                  id="liteharness-thread-title"
                  ref={renameInputRef}
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.currentTarget.value)}
                />
                <button
                  aria-label="Save thread name"
                  className="lh-mobile-thread-menu-save-button"
                  disabled={busy || !renameTitle.trim()}
                  type="submit"
                >
                  <Check aria-hidden="true" size={16} strokeWidth={2.3} />
                  <span>Save</span>
                </button>
              </div>
            </form>
            <button className="lh-mobile-thread-close-button" disabled={isActiveThreadStatus(menuThread.status)} type="button" onClick={() => void handleCloseThreads([menuThread])}>
              <X aria-hidden="true" size={16} /><span>Close thread</span>
            </button>
          </div>
        ) : null}


      {settingsOpen ? (
        <div className="lh-mobile-content lh-mobile-settings-content" role="main">
          <SettingsPage
            activeThread={activeThread}
            defaultWorkspacePath={defaultWorkspacePath}
            threads={threads}
          />
        </div>
      ) : workspacePageOpen ? (
        <main className="lh-mobile-content lh-mobile-settings-content" aria-label="New thread workspace">
          <div className="lh-mobile-settings-page lh-mobile-workspace-page">
            {workspaceConfigState === "ready" ? <NewThreadSettings
              disabled={busy || workspaceFinding}
              profiles={executionProfiles}
              selectedProfileId={newThreadProfileId}
              fastMode={newThreadFastModeEnabled}
              fastModeSupported={newThreadFastModeSupported}
              onFastModeChange={setNewThreadFastMode}
              onSelect={(profileId) => {
                preferredNewThreadProfileRef.current = profileId;
                setNewThreadProfileId(profileId);
                setNewThreadFastMode(null);
              }}
            /> : <div className="lh-new-thread-loading" role="status">
              <p>{workspaceConfigState === "loading" ? "Loading model settings…" : "Model settings unavailable"}</p>
              {workspaceConfigState === "failed" ? <button className="lh-mobile-tool-button lh-mobile-tool-button-text" type="button" onClick={() => void refreshWorkspaceConfig()}>Retry settings</button> : null}
            </div>}
            <div className="lh-new-thread-workspace-heading">
              <h2>Workspace</h2>
              <p>Choose a folder to start your tab.</p>
            </div>
            <div className="lh-mobile-workspace-tabs" role="tablist" aria-label="Workspace source"
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
                event.preventDefault();
                const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
                const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
                const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                tabs[index]?.click();
                tabs[index]?.focus();
              }}>
              <button
                aria-controls="liteharness-workspace-recent-panel"
                aria-selected={workspaceModalTab === "recent"}
                tabIndex={workspaceModalTab === "recent" ? 0 : -1}
                className={workspaceModalTab === "recent" ? "active" : ""}
                id="liteharness-workspace-recent-tab"
                disabled={busy}
                role="tab"
                type="button"
                onClick={() => {
                  dismissKeyboard();
                  workspaceSearchControllerRef.current?.abort();
                  workspaceSearchControllerRef.current = null;
                  setWorkspaceFinding(false);
                  setWorkspaceSearchStartedAtMs(null);
                  setWorkspaceModalTab("recent");
                  setWorkspaceModalError(null);
                  setWorkspaceDiscoveryEvents([]);
                }}
              >
                <span>Recent</span>
              </button>
              <button
                aria-controls="liteharness-workspace-new-panel"
                aria-selected={workspaceModalTab === "new"}
                tabIndex={workspaceModalTab === "new" ? 0 : -1}
                className={workspaceModalTab === "new" ? "active" : ""}
                id="liteharness-workspace-new-tab"
                disabled={busy}
                role="tab"
                type="button"
                onClick={() => {
                  setWorkspaceModalTab("new");
                  setWorkspaceModalError(null);
                }}
              >
                <span>Find workspace</span>
              </button>
            </div>
            {workspaceFinding ? (
              <div className="lh-mobile-workspace-working">
                <WorkingIndicator durationText={workspaceWorkingDurationText} />
              </div>
            ) : null}
            {workspaceModalTab === "recent" ? (
              <div
                aria-labelledby="liteharness-workspace-recent-tab"
                className="lh-mobile-workspace-recent-panel"
                id="liteharness-workspace-recent-panel"
                role="tabpanel"
              >
                {recentWorkspaceItems.length > 0 ? (
                  <div className="lh-mobile-workspace-list">
                    {recentWorkspaceItems.map((item) => (
                      <button
                        aria-label={`Create thread in ${item.title}`}
                        className="lh-mobile-workspace-list-item"
                        disabled={!canCreateThread || workspaceFinding || workspaceConfigState !== "ready"}
                        key={item.workspacePath}
                        type="button"
                        onClick={() => void handleCreateThreadFromWorkspace(item)}
                      >
                        <Folder aria-hidden="true" size={17} strokeWidth={2} />
                        <span className="lh-mobile-workspace-list-copy">
                          <strong>{item.title}</strong>
                          <code>{item.displayPath}</code>
                        </span>
                        <ChevronRight aria-hidden="true" size={16} strokeWidth={2.1} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="lh-mobile-workspace-empty">No recent directories</p>
                )}
              </div>
            ) : (
              <div
                aria-labelledby="liteharness-workspace-new-tab"
                className="lh-mobile-workspace-new-panel"
                id="liteharness-workspace-new-panel"
                role="tabpanel"
              >
                {workspaceDiscoveryEvents.length > 0 ? (
                  <div className="lh-mobile-workspace-events" aria-live="polite">
                    {workspaceDiscoveryEvents.map((event, index) => (
                      event.type === "workspace.search.found" && event.discovery ? (
                        <button
                          aria-label={`Create thread in ${event.discovery.title}`}
                          className="lh-mobile-workspace-list-item"
                          disabled={!canCreateThread || workspaceFinding || workspaceConfigState !== "ready"}
                          key={`${event.type}-${index}`}
                          type="button"
                          onClick={() => void handleCreateThread({
                            title: event.discovery.title,
                            workspacePath: event.discovery.workspacePath,
                          })}
                        >
                          <Folder aria-hidden="true" size={17} strokeWidth={2} />
                          <span className="lh-mobile-workspace-list-copy">
                            <strong>{event.discovery.title}</strong>
                            <code>{displayWorkspacePath(event.discovery.workspacePath, defaultWorkspacePath)}</code>
                            <small>{event.discovery.explanation}</small>
                          </span>
                          <ChevronRight aria-hidden="true" size={16} strokeWidth={2.1} />
                        </button>
                      ) : (
                        <div className="lh-mobile-workspace-event" key={`${event.type}-${index}`}>
                          <span aria-hidden="true" />
                          <span>{event.text}</span>
                        </div>
                      )
                    ))}
                  </div>
                ) : (
                  <div className="lh-workspace-search-empty">
                    <Search aria-hidden="true" size={24} />
                    <strong>Find a workspace</strong>
                    <p>Paste a folder path or describe a project below.</p>
                  </div>
                )}
              </div>
            )}
            {workspaceModalError ? <p role="alert" className="lh-mobile-workspace-error">{workspaceModalError}</p> : null}
            {busy ? <p className="lh-mobile-workspace-empty" role="status">Creating tab…</p> : null}
          </div>
        </main>
      ) : (
        <main
          ref={contentRef}
          className="lh-mobile-content lh-mobile-chat-content"
          aria-label="Opencozy timeline"
        >
          <div className="lh-mobile-chat-log">

            <section className="lh-mobile-timeline-stack" aria-label="Run timeline">
              {renderEntries.length === 0 ? <p className="lh-mobile-muted-line">{activeThread ? "No runs." : "No thread."}</p> : null}

              {hiddenEntryCount > 0 ? <button className="lh-load-earlier" onClick={() => { timelineScroll.preservePrepend(); setEntryStarts(current => ({ ...current, [viewKey]: Math.max(0, hiddenEntryCount - 100) })); }}>Show earlier ({hiddenEntryCount})</button> : null}
              {shownEntries.map((entry) => (
                <TimelineEntry
                  activeThread={activeThread}
                  busy={busy}
                  entry={entry}
                  key={entry.id}
                  onApprovalDecision={onTimelineApproval}
                  onInputResponse={onTimelineInput}
                />
              ))}

              {selectedAgent ? <p className="lh-mobile-muted-line">{selectedAgent.label} · {selectedAgent.status}</p> : working ? (
                <WorkingIndicator durationText={workingDurationText} />
              ) : workedDurationText ? (
                <WorkedIndicator durationText={workedDurationText} />
              ) : null}

              {error || startupError || connectionError ? <p className="lh-mobile-error">{error ?? startupError ?? connectionError}</p> : null}
              <div aria-hidden="true" className="lh-mobile-chat-bottom" />
            </section>
          </div>
        </main>
      )}

      {!settingsOpen && !workspacePageOpen && timelineScroll.showJump && activeThread ? (
        <button
          aria-label="Scroll to bottom"
          className="lh-mobile-scroll-bottom-button"
          type="button"
          onClick={timelineScroll.jumpToBottom}
        >
          <ChevronDown aria-hidden="true" size={21} strokeWidth={2.4} />
        </button>
      ) : null}

      {workspacePageOpen && workspaceModalTab === "new" ? (
        <footer ref={footerRef} className="lh-mobile-composer-footer lh-mobile-workspace-composer-footer">
          {keyboardVisible ? <div className="lh-mobile-tools-bar" role="toolbar" aria-label="Workspace tools">
            <span className="lh-composer-target">Find workspace</span>
            <button aria-label="Hide keyboard" className="lh-mobile-tool-button lh-keyboard-dismiss" type="button" onPointerDown={event => event.preventDefault()} onClick={dismissKeyboard}><Keyboard size={18} /><ChevronDown size={12} /></button>
          </div> : null}
          <form
            className="lh-mobile-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void handleFindWorkspace();
            }}
          >
            <textarea
              ref={workspaceInputRef}
              aria-label="Workspace"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="lh-mobile-composer-input"
              disabled={busy || workspaceFinding}
              enterKeyHint="enter"
              inputMode="text"
              placeholder="Project name or folder path"
              rows={1}
              value={workspaceQuery}
              onChange={(event) => {
                setWorkspaceQuery(event.currentTarget.value);
                setWorkspaceDiscoveryEvents([]);
                setWorkspaceModalError(null);
              }}
            />
            <button
              aria-disabled={!canFindWorkspace}
              aria-label="Find workspace"
              className="lh-mobile-send-button"
              disabled={!canFindWorkspace}
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={20} strokeWidth={2.4} />
            </button>
          </form>
        </footer>
      ) : null}

      {!settingsOpen && !workspacePageOpen ? (
        <footer ref={footerRef} className="lh-mobile-composer-footer">
          <div className="lh-mobile-tools-bar" role="toolbar" aria-label="Composer tools">
            <button
              aria-label="Stop run"
              className="lh-mobile-tool-button lh-mobile-tool-button-text"
              disabled={busy || !canCancelRun}
              type="button"
              onClick={() => void handleCancelActiveRun()}
            >
              <Square aria-hidden="true" size={12} fill="currentColor" /><span>{selectedAgentBranchId ? "Stop Main" : "Stop"}</span>
            </button>
            <button
              aria-label="Fast mode"
              aria-pressed={fastModeEnabled}
              className={fastModeEnabled ? "lh-mobile-tool-button lh-mobile-tool-button-text is-active" : "lh-mobile-tool-button lh-mobile-tool-button-text"}
              disabled={busy || !activeThread || !fastModeSupported}
              type="button"
              onClick={() => void toggleFastMode()}
            >
              <Zap aria-hidden="true" size={13} /><span>Fast</span>
            </button>
            <button
              aria-label="Preview"
              className="lh-mobile-tool-button lh-mobile-tool-button-preview"
              disabled={!activeThread}
              type="button"
              onClick={openPreview}
            >
              <Monitor aria-hidden="true" size={16} strokeWidth={2.1} />
            </button>
            <span className="lh-composer-target">{selectedAgent ? `To ${selectedAgent.label}` : composerIsSteering ? "Steer Codex" : "Message Codex"}</span>
            {selectedAgent ? <button className="lh-mobile-tool-button" aria-label="Return to Main" type="button" onClick={() => setSelectedAgentBranchId(null)}>Main</button> : null}
            {keyboardVisible ? <button aria-label="Hide keyboard" className="lh-mobile-tool-button lh-keyboard-dismiss" type="button" onPointerDown={event => event.preventDefault()} onClick={dismissKeyboard}><Keyboard size={18} /><ChevronDown size={12} /></button> : null}
          </div>
          {selectedFiles.length > 0 ? <ul className="lh-attachment-list" aria-label="Attached files">
            {selectedFiles.map(file => <li key={file.key}>
              <span className="lh-attachment-name">{file.name}<small>{file.error ?? (file.attachment ? fileSize(file.size) : "Uploading…")}</small></span>
              {file.error ? <button type="button" onClick={() => void attachmentDrafts.retry(draftKey, activeThreadId!, file)}>Retry</button> : null}
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => attachmentDrafts.remove(draftKey, file.key)}><X aria-hidden="true" size={16} /></button>
            </li>)}
          </ul> : null}
          <form
            className="lh-mobile-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRun();
            }}
          >
            <span className="lh-attach-button">
              <Plus aria-hidden="true" size={20} strokeWidth={1.75} />
              <input
                className="lh-attach-input"
                aria-label="Attach files"
                type="file"
                multiple
                disabled={busy || !activeThread || Boolean(selectedAgentBranchId && !canMessageAgent)}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  if (!activeThreadId || !files.length) return;
                  try { attachmentDrafts.add(draftKey, activeThreadId, files); setError(null); } catch (error) { setError(readError(error)); }
                }}
              />
            </span>
            <textarea
              ref={promptInputRef}
              aria-label="Prompt"
              autoCapitalize="sentences"
              className="lh-mobile-composer-input"
              disabled={!activeThread || Boolean(selectedAgentBranchId && !canMessageAgent)}
              enterKeyHint="enter"
              inputMode="text"
              placeholder={selectedAgent ? canMessageAgent ? `Message ${selectedAgent.label}` : "Agent finished · return to Main" : composerIsSteering
                ? "Steer Codex"
                : activeThread
                  ? "Run Codex"
                  : "No thread"}
              rows={1}
              value={prompt}
              onChange={(event) => {
                if (!activeThreadId) return;
                writePromptDraftForThread(draftKey, event.currentTarget.value);
              }}
            />
            <button
              aria-disabled={!canRun}
              aria-label={selectedAgent ? `Send to ${selectedAgent.label}` : composerIsSteering ? "Steer" : "Run"}
              className="lh-mobile-send-button"
              disabled={!canRun}
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={20} strokeWidth={2.4} />
            </button>
          </form>
        </footer>
      ) : null}

      {undoThreads.length > 0 && !tabManagerOpen ? <div className="lh-close-undo" role="status"><span>{undoThreads.length} {undoThreads.length === 1 ? "thread" : "threads"} closed</span><button onClick={() => { const restore = undoThreads; setUndoThreads([]); void Promise.all(restore.map(handleReopenThread)); }}>Undo</button><button aria-label="Dismiss undo" onClick={() => setUndoThreads([])}><X size={14} /></button></div> : null}
      {tabManagerOpen ? <ThreadSwitcher threads={threads} closedThreads={closedThreads} activeId={activeThreadId} loading={closedLoading} error={error} stopping={stoppingThreads} onStopAndCloseAll={() => void handleStopAndCloseAll()}
        onSelect={selectThread} onClose={thread => void handleCloseThreads([thread])} onReopen={thread => void handleReopenThread(thread)}
        onCloseMany={items => void handleCloseThreads(items)} onDismiss={() => setTabManagerOpen(false)} /> : null}

      {previewOpen ? (
        <div className="lh-mobile-preview-overlay" role="dialog" aria-modal="true" aria-label="App preview">
          <div className="lh-mobile-preview-edge-dock" role="group" aria-label="Preview controls">
            <button
              aria-label={previewPickerOpen ? "View preview" : "Preview configuration"}
              className="lh-mobile-preview-edge-button"
              disabled={previewPickerOpen && (!previewFrameUrl || !activeWiredPreviewCanOpenFrame)}
              type="button"
              onClick={previewPickerOpen ? showPreviewFrame : openPreviewPicker}
            >
              {previewPickerOpen ? <Monitor aria-hidden="true" size={18} /> : <Settings aria-hidden="true" size={18} />}
            </button>
            <button
              aria-label="Close preview"
              className="lh-mobile-preview-edge-button"
              type="button"
              onClick={() => {
                setPreviewPickerOpen(false);
                setPreviewError(null);
                setPreviewOpen(false);
              }}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          {previewFrameUrl && activeWiredPreviewCanOpenFrame && !previewPickerOpen ? (
            <div className="lh-mobile-preview-frame-wrap">
              {!previewFrameLoaded ? (
                <div className="lh-mobile-preview-frame-loading" role="status" aria-live="polite">
                  Loading preview...
                </div>
              ) : null}
              <iframe
                className={previewFrameLoaded ? "lh-mobile-preview-frame" : "lh-mobile-preview-frame is-loading"}
                src={previewFrameUrl}
                title="App preview"
                onLoad={() => setPreviewFrameLoaded(true)}
              />
            </div>
          ) : (
            <Suspense fallback={<p className="lh-mobile-muted-line">Loading preview…</p>}><ProjectPreviewPicker
              activePreview={activeWiredPreview}
              busy={busy}
              copiedPreviewLinkId={copiedPreviewLinkId}
              editingPreviewId={editingWiredPreviewId}
              editingPreviewName={editingWiredPreviewName}
              error={previewError}
              healthyPreviewId={previewFrameLoaded && activeWiredPreviewCanOpenFrame ? activeWiredPreviewId : null}
              loading={wiredPreviewLoading}
              pendingManifestByPreviewId={pendingManifestByPreviewId}
              previewManifestNameDrafts={previewManifestNameDrafts}
              previewManifests={previewManifests}
              previews={wiredPreviews}
              search={wiredPreviewSearch}
              wiringBrief={previewWiringBrief}
              onApproveManifest={(manifest) => void approvePreviewManifestForThread(manifest)}
              onAttachPreview={(preview) => void attachWiredPreview(preview)}
              onCancelRenamePreview={() => setEditingWiredPreviewId(null)}
              onCopyPreviewLink={(preview, url) => void copyPreviewLink(preview, url)}
              onDeletePreview={(preview) => void removeWiredPreview(preview)}
              onDetachActivePreview={() => void detachActiveWiredPreview()}
              onEditingPreviewNameChange={setEditingWiredPreviewName}
              onManifestNameDraftChange={(manifestId, value) => {
                setPreviewManifestNameDrafts((current) => ({ ...current, [manifestId]: value }));
              }}
              onOpenWiringThread={(preview) => void openPreviewWiringThread(preview)}
              onRunPreviewAction={(preview, previewState, pendingManifest) => {
                if (previewState.recoveryAction === "open-wiring-thread") {
                  void openPreviewWiringThread(preview);
                  return;
                }
                if (previewState.recoveryAction === "publish") {
                  void publishMissingPreviewOrigins(preview);
                  return;
                }
                if (previewState.recoveryAction === "review-manifest") {
                  reviewPreviewManifest(pendingManifest);
                  return;
                }
                void attachWiredPreview(preview);
              }}
              onSaveRenamePreview={(preview) => void saveWiredPreviewName(preview)}
              onSearchChange={setWiredPreviewSearch}
              onStartNewWiringThread={() => void openPreviewWiringThread()}
              onStartRenamePreview={startRenamingWiredPreview}
              onWiringBriefChange={setPreviewWiringBrief}
            /></Suspense>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WorkingIndicator({ durationText }: { durationText: string }) {
  return (
    <div className="lh-mobile-working-row" aria-live="polite">
      <span aria-hidden="true" className="lh-mobile-working-dot" />
      <span className="lh-mobile-working-text">Working</span>
      <span className="lh-mobile-working-separator" aria-hidden="true">•</span>
      <span className="lh-mobile-working-time">{durationText}</span>
    </div>
  );
}

function WorkedIndicator({ durationText }: { durationText: string }) {
  return (
    <div className="lh-mobile-worked-block" aria-live="polite">
      <div className="lh-mobile-worked-row">
        <span>Worked for</span>
        <span className="lh-mobile-working-time">{durationText}</span>
      </div>
    </div>
  );
}

function SettingsPage({ activeThread, defaultWorkspacePath, threads }: {
  activeThread: ThreadRecord | null;
  defaultWorkspacePath: string;
  threads: ThreadRecord[];
}) {
  return (
    <main className="lh-mobile-settings-page" aria-label="Settings">
      <section className="lh-mobile-settings-section" aria-labelledby="liteharness-settings-workspace">
        <h2 id="liteharness-settings-workspace">Workspace</h2>
        <dl className="lh-mobile-settings-list">
          <div>
            <dt>Default</dt>
            <dd><code>{defaultWorkspacePath || "~"}</code></dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd><code>{activeThread?.workspacePath ?? "No thread"}</code></dd>
          </div>
        </dl>
      </section>
      <section className="lh-mobile-settings-section" aria-labelledby="liteharness-settings-harness">
        <h2 id="liteharness-settings-harness">Harness</h2>
        <dl className="lh-mobile-settings-list">
          <div>
            <dt>Runtime</dt>
            <dd>Codex</dd>
          </div>
          <div>
            <dt>Threads</dt>
            <dd>{threads.length}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingThreadError(error: unknown): boolean {
  const message = readError(error).toLowerCase();
  return message.includes("thread not found") || message.includes("request failed: 404");
}

function buildRecentWorkspaceItems(input: {
  currentWorkspacePath: string;
  defaultWorkspacePath: string;
  recentWorkspacePaths: string[];
}): RecentWorkspaceItem[] {
  return dedupeWorkspacePaths([
    ...input.recentWorkspacePaths,
    input.currentWorkspacePath,
    input.defaultWorkspacePath,
  ]).map((workspacePath) => {
    const displayPath = displayWorkspacePath(workspacePath, input.defaultWorkspacePath);
    return {
      displayPath,
      title: displayPath === "~" ? "Home" : workspaceTitleFromPath(workspacePath),
      workspacePath,
    };
  });
}

function readRecentWorkspacePaths(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentWorkspaceStorageKey) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeWorkspacePaths(parsed.filter((item): item is string => typeof item === "string"))
      .slice(0, maxRecentWorkspacePaths);
  } catch {
    return [];
  }
}

function writeRecentWorkspacePaths(paths: string[]) {
  try {
    window.localStorage.setItem(recentWorkspaceStorageKey, JSON.stringify(paths));
  } catch {
    // Recent directories are a local convenience; thread creation should not depend on browser storage.
  }
}

function dedupeWorkspacePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const path of paths) {
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    next.push(normalizedPath);
  }
  return next;
}

function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.replace(/\/+$/, "") || trimmed;
}

function workspaceTitleFromPath(path: string): string {
  const normalizedPath = normalizeWorkspacePath(path);
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.at(-1) ?? normalizedPath;
}

function displayWorkspacePath(path: string, defaultWorkspacePath: string): string {
  const normalizedDefault = defaultWorkspacePath.replace(/\/+$/, "");
  const normalizedPath = path.replace(/\/+$/, "");
  if (normalizedDefault && normalizedPath === normalizedDefault) {
    return "~";
  }
  if (normalizedDefault && normalizedPath.startsWith(`${normalizedDefault}/`)) {
    return `~/${normalizedPath.slice(normalizedDefault.length + 1)}`;
  }
  return path;
}

function activeWorkStartMs(
  events: TimelineEventRecord[],
  threadId: string,
  waitingRunId: string | null,
  optimisticMessageInFlightId: string | null,
  pendingRunStartedAtMs: number | null,
  localRunStartMsByRunId: Record<string, number>,
): number | null {
  const threadEvents = events.filter((event) => event.threadId === threadId);
  const optimisticEvent = optimisticMessageInFlightId
    ? threadEvents.find((event) => event.id === optimisticMessageInFlightId)
    : null;
  const optimisticStartedAt = optimisticEvent ? eventTimeMs(optimisticEvent) : null;
  if (optimisticStartedAt !== null) {
    return optimisticStartedAt;
  }

  if (waitingRunId) {
    if (waitingRunId.startsWith("pending:")) {
      return pendingRunStartedAtMs ?? latestSubmittedStartMs(threadEvents);
    }
    return localRunStartMsByRunId[waitingRunId]
      ?? runStartMs(threadEvents, waitingRunId)
      ?? pendingRunStartedAtMs
      ?? latestSubmittedStartMs(threadEvents);
  }

  const activeRunId = latestOpenRunId(threadEvents);
  if (activeRunId) {
    return localRunStartMsByRunId[activeRunId] ?? runStartMs(threadEvents, activeRunId);
  }

  return latestSubmittedStartMs(threadEvents);
}

function latestWorkedDurationMs(
  events: TimelineEventRecord[],
  threadId: string,
  localRunStartMsByRunId: Record<string, number>,
): number | null {
  const threadEvents = events.filter((event) => event.threadId === threadId);
  const terminalEvent = findLast(threadEvents, isTerminalRunEvent);
  if (!terminalEvent) {
    return null;
  }
  const endedAt = eventTimeMs(terminalEvent);
  if (endedAt === null) {
    return null;
  }
  const startedAt = terminalEvent.runId
    ? localRunStartMsByRunId[terminalEvent.runId] ?? runStartMs(threadEvents, terminalEvent.runId)
    : null;
  return Math.max(0, endedAt - (startedAt ?? endedAt));
}

function latestOpenRunId(events: TimelineEventRecord[]): string | null {
  const closedRunIds = new Set<string>();
  for (const event of events) {
    if (event.runId && isTerminalRunEvent(event)) {
      closedRunIds.add(event.runId);
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.runId && !closedRunIds.has(event.runId)) {
      return event.runId;
    }
  }
  return null;
}

function runStartMs(events: TimelineEventRecord[], runId: string): number | null {
  const startEvent = events.find((event) => (
    event.runId === runId
    && (event.type === "run.submitted" || event.type === "run.started")
  ));
  return startEvent ? eventTimeMs(startEvent) : null;
}

function latestSubmittedStartMs(events: TimelineEventRecord[]): number | null {
  const latestSubmitted = findLast(events, (event) => event.type === "run.submitted" || event.type === "run.steered");
  return latestSubmitted ? eventTimeMs(latestSubmitted) : null;
}

function eventTimeMs(event: TimelineEventRecord): number | null {
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isTerminalRunEvent(event: TimelineEventRecord): boolean {
  return event.type === "run.completed" || event.type === "run.failed" || event.type === "run.canceled";
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && predicate(item)) {
      return item;
    }
  }
  return null;
}

function formatWorkDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function createOptimisticPromptEvent(input: {
  attachments?: import("../api").MessageAttachment[];
  agentThreadId?: string | null;
  baselinePromptCount: number;
  counter: number;
  createdAtMs: number;
  prompt: string;
  threadId: string;
  type: "run.submitted" | "run.steered";
}): TimelineEventRecord {
  const id = `optimistic:${input.threadId}:${input.createdAtMs}:${input.counter}`;
  return {
    createdAt: new Date(input.createdAtMs).toISOString(),
    id,
    payload: {
      ...(input.agentThreadId ? { agentThreadId: input.agentThreadId } : {}),
      attachments: input.attachments,
      optimisticBaselinePromptCount: input.baselinePromptCount,
      liteharnessType: "user-prompt",
      stableKey: id,
      text: input.prompt,
    },
    runId: null,
    sequence: Number.MAX_SAFE_INTEGER,
    threadId: input.threadId,
    type: input.type,
  };
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
}

function timelineWithOptimisticEvents(
  committed: TimelineEventRecord[],
  optimistic: TimelineEventRecord[],
  activeThreadId: string | null,
): TimelineEventRecord[] {
  if (!activeThreadId || optimistic.length === 0) {
    return committed;
  }
  const activeOptimistic = optimistic.filter((event) => event.threadId === activeThreadId);
  const pendingOptimistic = unmatchedOptimisticEvents(activeOptimistic, committed);
  return pendingOptimistic.length > 0 ? [...committed, ...pendingOptimistic] : committed;
}

function mergeTimelineSnapshot(
  snapshot: TimelineEventRecord[],
  current: TimelineEventRecord[],
): TimelineEventRecord[] {
  if (current.length === 0) {
    return snapshot;
  }
  const snapshotIds = new Set(snapshot.map((event) => event.id));
  const maxSnapshotSequence = snapshot.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    Number.NEGATIVE_INFINITY,
  );
  const eventsArrivingAfterSnapshot = current.filter((event) => (
    !snapshotIds.has(event.id)
    && (snapshot.length === 0 || event.sequence > maxSnapshotSequence)
  ));
  if (eventsArrivingAfterSnapshot.length === 0) {
    return snapshot;
  }
  return [...snapshot, ...eventsArrivingAfterSnapshot]
    .sort((left, right) => left.sequence - right.sequence);
}

function removeCommittedOptimisticEvents(
  optimistic: TimelineEventRecord[],
  committed: TimelineEventRecord[],
): TimelineEventRecord[] {
  const pendingOptimistic = unmatchedOptimisticEvents(optimistic, committed);
  return pendingOptimistic.length === optimistic.length ? optimistic : pendingOptimistic;
}

function unmatchedOptimisticEvents(
  optimistic: TimelineEventRecord[],
  committed: TimelineEventRecord[],
): TimelineEventRecord[] {
  const committedCounts = committed.reduce((counts, event) => {
    const key = promptEventMatchKey(event);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());

  return optimistic.filter((event) => {
    const key = promptEventMatchKey(event);
    const matches = key ? committedCounts.get(key) ?? 0 : 0;
    const baselineMatches = typeof event.payload.optimisticBaselinePromptCount === "number"
      ? event.payload.optimisticBaselinePromptCount
      : 0;
    if (!key || matches <= baselineMatches) {
      return true;
    }
    committedCounts.set(key, matches - 1);
    return false;
  });
}

function countPromptEventMatches(
  events: TimelineEventRecord[],
  threadId: string,
  type: "run.submitted" | "run.steered",
  text: string,
  agentThreadId: string | null = null,
  attachments: unknown = [],
): number {
  const key = promptEventMatchKeyFor(threadId, type, text, agentThreadId, attachments);
  return events.filter((event) => promptEventMatchKey(event) === key).length;
}

function promptEventMatchKey(event: TimelineEventRecord): string | null {
  if (event.type !== "run.submitted" && event.type !== "run.steered") {
    return null;
  }
  const text = event.payload.text;
  if (typeof text !== "string") {
    return null;
  }
  return promptEventMatchKeyFor(event.threadId, event.type, text, typeof event.payload.agentThreadId === "string" ? event.payload.agentThreadId : null, event.payload.attachments);
}

function promptEventMatchKeyFor(threadId: string, type: "run.submitted" | "run.steered", text: string, agentThreadId: string | null = null, attachments: unknown = []): string {
  const ids = Array.isArray(attachments) ? attachments.map(file => file?.id).sort().join(",") : "";
  return `${agentThreadId ?? "main"}:${threadId}\u0000${type}\u0000${text.trim()}\u0000${ids}`;
}

function threadStatusFromEvent(type: string): ThreadRecord["status"] | null {
  if (type === "run.submitted") {
    return "running";
  }
  if (type === "run.started") {
    return "running";
  }
  if (type === "approval.requested") {
    return "needs_approval";
  }
  if (type === "approval.responded") {
    return "running";
  }
  if (type === "input.requested") {
    return "needs_input";
  }
  if (type === "input.responded") {
    return "running";
  }
  if (type === "run.completed") {
    return "idle";
  }
  if (type === "run.canceled") {
    return "idle";
  }
  if (type === "run.failed") {
    return "failed";
  }
  return null;
}

function isActiveThreadStatus(status: ThreadRecord["status"]): boolean {
  return status === "running" || status === "needs_approval" || status === "needs_input";
}

function readLocalValue<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function writeLocalValue(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be full or disabled. */ }
}
