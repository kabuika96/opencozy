import { ChevronDown, Layers2, Plus, Search, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ThreadRecord } from "../api";
import "./ThreadTabs.css";

export function threadIsActive(thread: ThreadRecord) {
  return ["running", "needs_input", "needs_approval"].includes(thread.status);
}

export function ThreadTabs({ threads, activeId, canCreate, onSelect, onOptions, onManage, onCreate, onSettings }: {
  threads: ThreadRecord[]; activeId: string | null; canCreate: boolean;
  onSelect(thread: ThreadRecord): void; onOptions(thread: ThreadRecord): void;
  onManage(): void; onCreate(): void; onSettings(): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scroller.current;
    const tab = container?.querySelector<HTMLElement>(".active");
    if (!container || !tab) return;
    const left = tab.offsetLeft - container.offsetLeft;
    if (left < container.scrollLeft) container.scrollLeft = left;
    else if (left + tab.offsetWidth > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = left + tab.offsetWidth - container.clientWidth;
    }
  }, [activeId, threads.length]);
  return <div className="lh-tabs">
    <button aria-label="Open settings" className="lh-tab-icon" onClick={onSettings}><Settings size={17} /></button>
    <div className="lh-tab-scroller" ref={scroller} role="tablist" aria-label="Threads">
      {!threads.length ? <span className="lh-tabs-empty">Opencozy</span> : threads.map(thread => <div className={`lh-tab${activeId === thread.id ? " active" : ""}`} key={thread.id}>
        <button className="lh-tab-name" role="tab" aria-selected={activeId === thread.id}
          aria-label={activeId === thread.id ? `Active thread ${thread.title}` : `Switch to ${thread.title}`} onClick={() => onSelect(thread)}>
          <span aria-hidden className={`lh-tab-status is-${thread.status}`} /><span>{thread.title}</span>
        </button>
        {activeId === thread.id ? <button className="lh-tab-control" aria-label={`Thread menu for ${thread.title}`} onClick={() => onOptions(thread)}><ChevronDown size={14} /></button> : null}
      </div>)}
    </div>
    <button className="lh-tab-icon lh-tab-count" aria-label="Manage tabs" onClick={onManage}><Layers2 size={19} /><small>{threads.length}</small></button>
    <button className="lh-tab-icon" aria-label="New tab" disabled={!canCreate} onClick={onCreate}><Plus size={20} /></button>
  </div>;
}

export function ThreadSwitcher({ threads, closedThreads, activeId, loading, error, stopping, onStopAndCloseAll, onSelect, onClose, onReopen, onCloseMany, onDismiss }: {
  threads: ThreadRecord[]; closedThreads: ThreadRecord[]; activeId: string | null; loading: boolean; error?: string | null; stopping: boolean; onStopAndCloseAll(): void;
  onSelect(thread: ThreadRecord): void; onClose(thread: ThreadRecord): void; onReopen(thread: ThreadRecord): void;
  onCloseMany(threads: ThreadRecord[]): void; onDismiss(): void;
}) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const eligible = threads.filter(thread => !threadIsActive(thread));
  const filtered = (closed ? closedThreads : threads).filter(thread => `${thread.title} ${thread.workspacePath}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="lh-tab-overlay">
    <button className="lh-tab-backdrop" aria-label="Dismiss tabs" onClick={onDismiss} />
    <section className="lh-tab-sheet" role="dialog" aria-modal="true" aria-label="Manage tabs">
      <header><strong>Threads <small>{threads.length}</small></strong><button className="lh-tab-icon" aria-label="Done managing tabs" onClick={onDismiss}><X size={20} /></button></header>
      <div className="lh-tab-segments" role="tablist" aria-label="Thread list">
        <button role="tab" aria-selected={!closed} onClick={() => setClosed(false)}>Open</button>
        <button role="tab" aria-selected={closed} onClick={() => setClosed(true)}>Recently closed</button>
      </div>
      <label className="lh-tab-search"><Search size={16} /><input aria-label="Search threads" placeholder="Search threads" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {!closed ? <div className="lh-tab-bulk">
        <button disabled={!eligible.length} onClick={() => onCloseMany(eligible)}>Close {eligible.length === threads.length ? "all" : "idle"} ({eligible.length})</button>
        <button disabled={!eligible.some(t => t.id !== activeId)} onClick={() => onCloseMany(eligible.filter(t => t.id !== activeId))}>Close others</button>
      </div> : null}
      {error ? <p className="lh-mobile-error" role="alert">{error}</p> : null}
      <div className="lh-tab-rows">
        {filtered.map(thread => <div className={`lh-tab-row${thread.id === activeId ? " active" : ""}`} key={thread.id}>
          <button onClick={() => closed ? onReopen(thread) : onSelect(thread)} aria-label={closed ? `Reopen ${thread.title}` : `Open ${thread.title}`}>
            <span aria-hidden className={`lh-tab-status is-${thread.status}`} />
            <span><strong>{thread.title}</strong><small>{thread.workspacePath}</small></span>
            <small>{closed ? "Reopen" : thread.status.replaceAll("_", " ")}</small>
          </button>
          {!closed && !threadIsActive(thread) ? <button className="lh-tab-icon" aria-label={`Close tab ${thread.title}`} onClick={() => onClose(thread)}><X size={17} /></button> : null}
        </div>)}
        {!filtered.length ? <p className="lh-tabs-empty">{loading ? "Loading…" : closed ? "No closed threads" : query ? "No matches" : "No open threads"}</p> : null}
      </div>
      {threads.some(threadIsActive) && !closed ? <div className="lh-tab-stop-all">
        {confirmStop ? <><small>Stop active work and close every tab?</small><div>
          <button disabled={stopping} onClick={onStopAndCloseAll}>{stopping ? "Stopping…" : "Stop and close all"}</button>
          <button disabled={stopping} onClick={() => setConfirmStop(false)}>Keep working</button>
        </div></> : <button disabled={stopping} onClick={() => setConfirmStop(true)}>Stop work & close all…</button>}
      </div> : null}
    </section>
  </div>;
}
