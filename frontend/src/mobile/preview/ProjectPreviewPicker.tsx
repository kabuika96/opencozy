import { useState } from "react";
import { Copy } from "lucide-react";
import type { PreviewManifest, WiredPreview } from "../api";
import { deriveWiredPreviewState, type PreviewState } from "./previewState";
import { findWiredPreviewSourceConflict, orderPreviewsWithAttachedFirst, readWiredPreviewOpenUrl } from "./projectPreview";

type ProjectPreviewPane = "saved" | "wire";
type PreviewActionKind = "primary" | "attach" | "detach" | "wire" | "rename" | "delete";
type PendingPreviewAction = {
  kind: PreviewActionKind;
  previewId: string;
};

export type ProjectPreviewPickerProps = {
  activePreview: WiredPreview | null;
  busy: boolean;
  copiedPreviewLinkId: string | null;
  editingPreviewId: string | null;
  editingPreviewName: string;
  error: string | null;
  healthyPreviewId: string | null;
  loading: boolean;
  pendingManifestByPreviewId: Map<string, PreviewManifest>;
  previewManifestNameDrafts: Record<string, string>;
  previewManifests: PreviewManifest[];
  previews: WiredPreview[];
  search: string;
  wiringBrief: string;
  onApproveManifest: (manifest: PreviewManifest) => void;
  onAttachPreview: (preview: WiredPreview) => void;
  onCancelRenamePreview: () => void;
  onCopyPreviewLink: (preview: WiredPreview, url: string) => void;
  onDeletePreview: (preview: WiredPreview) => void;
  onDetachActivePreview: () => void;
  onEditingPreviewNameChange: (value: string) => void;
  onManifestNameDraftChange: (manifestId: string, value: string) => void;
  onOpenWiringThread: (preview?: WiredPreview) => void;
  onRunPreviewAction: (preview: WiredPreview, previewState: PreviewState, pendingManifest?: PreviewManifest) => void;
  onSaveRenamePreview: (preview: WiredPreview) => void;
  onSearchChange: (value: string) => void;
  onStartNewWiringThread: () => void;
  onStartRenamePreview: (preview: WiredPreview) => void;
  onWiringBriefChange: (value: string) => void;
};

export function ProjectPreviewPicker(props: ProjectPreviewPickerProps) {
  const [activePane, setActivePane] = useState<ProjectPreviewPane>("saved");
  const [pendingAction, setPendingAction] = useState<PendingPreviewAction | null>(null);
  const activePreview = props.activePreview;
  const previewsToShow = orderPreviewsWithAttachedFirst(props.previews, activePreview);
  const trimmedSearch = props.search.trim();
  const emptyListCopy = trimmedSearch ? `No matches for "${trimmedSearch}".` : "No Wired Previews.";

  function requestActionConfirmation(previewId: string, kind: PreviewActionKind) {
    setPendingAction((current) => (
      current?.previewId === previewId && current.kind === kind ? null : { previewId, kind }
    ));
  }

  return (
    <div className="lh-mobile-preview-page">
      <header className="lh-mobile-preview-header">
        <h2>Preview</h2>
      </header>
      <div className="lh-mobile-preview-content">
        <div className="lh-mobile-preview-tabs" role="tablist" aria-label="Project preview sections">
          <button
            className={activePane === "saved" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activePane === "saved"}
            onClick={() => setActivePane("saved")}
          >
            Saved
          </button>
          <button
            className={activePane === "wire" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activePane === "wire"}
            onClick={() => setActivePane("wire")}
          >
            Wire
          </button>
        </div>

        {props.error ? <div className="lh-mobile-preview-error">{props.error}</div> : null}

        {activePane === "saved" ? (
          <div className="lh-mobile-preview-pane">
            {props.previewManifests.length > 0 ? (
              <section className="lh-mobile-preview-section" aria-labelledby="lh-preview-approval-title">
                <div className="lh-mobile-preview-section-header">
                  <h3 id="lh-preview-approval-title">Pending approval</h3>
                </div>
                <div className="lh-mobile-preview-list">
                  {props.previewManifests.map((manifest) => (
                    <form
                      className="lh-mobile-preview-manifest-row"
                      key={manifest.id}
                      id={`preview-manifest-${manifest.id}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        props.onApproveManifest(manifest);
                      }}
                    >
                      <div className="lh-mobile-preview-manifest-summary">
                        <strong>{manifest.proposedName}</strong>
                        <small>{manifest.projectDirectory}</small>
                        <small>{manifest.target.url}</small>
                      </div>
                      <label className="lh-mobile-preview-field">
                        <span>Name</span>
                        <input
                          value={props.previewManifestNameDrafts[manifest.id] ?? manifest.proposedName}
                          onChange={(event) => props.onManifestNameDraftChange(manifest.id, event.currentTarget.value)}
                        />
                      </label>
                      <button
                        className="lh-mobile-preview-primary"
                        type="submit"
                        disabled={props.busy || !(props.previewManifestNameDrafts[manifest.id] ?? manifest.proposedName).trim()}
                      >
                        Approve
                      </button>
                    </form>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="lh-mobile-preview-section" aria-label="Saved previews">
              {!activePreview ? <div className="lh-mobile-preview-note">No preview attached.</div> : null}
              <label className="lh-mobile-preview-field">
                <span>Search</span>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="Project or preview"
                  value={props.search}
                  onChange={(event) => props.onSearchChange(event.currentTarget.value)}
                />
              </label>

              <div className="lh-mobile-preview-list" aria-busy={props.loading}>
                {props.loading ? <div className="lh-mobile-preview-list-state">Loading...</div> : null}
                {!props.loading && previewsToShow.length === 0 ? (
                  <div className="lh-mobile-preview-list-state">{emptyListCopy}</div>
                ) : null}
                {!props.loading && previewsToShow.map((preview) => {
                  const pendingManifest = props.pendingManifestByPreviewId.get(preview.id);
                  const isAttached = activePreview?.id === preview.id;
                  const isHealthy = props.healthyPreviewId === preview.id;
                  const previewState = deriveWiredPreviewState({
                    pendingManifest,
                    preview,
                    reachability: isHealthy ? "reachable" : undefined,
                    sourceConflictPreviewName: findWiredPreviewSourceConflict(previewsToShow, preview)?.name,
                  });
                  const previewPendingAction = pendingAction?.previewId === preview.id ? pendingAction : null;
                  const showPrimaryAction = !(isAttached && previewState.recoveryAction === "attach");
                  const showAttachAction = !isAttached && previewState.recoveryAction !== "attach";
                  const previewOpenUrl = readWiredPreviewOpenUrl(preview);
                  const showCopyPreviewLink = isHealthy && previewState.kind === "ready" && Boolean(previewOpenUrl);

                  const runConfirmedPreviewAction = () => {
                    if (!previewPendingAction) {
                      return;
                    }
                    setPendingAction(null);
                    if (previewPendingAction.kind === "primary") {
                      props.onRunPreviewAction(preview, previewState, pendingManifest);
                    } else if (previewPendingAction.kind === "attach") {
                      props.onAttachPreview(preview);
                    } else if (previewPendingAction.kind === "detach") {
                      props.onDetachActivePreview();
                    } else if (previewPendingAction.kind === "wire") {
                      props.onOpenWiringThread(preview);
                    } else if (previewPendingAction.kind === "rename") {
                      props.onStartRenamePreview(preview);
                    } else {
                      props.onDeletePreview(preview);
                    }
                  };

                  return (
                    <div className="lh-mobile-preview-row" key={preview.id}>
                      {props.editingPreviewId === preview.id ? (
                        <form
                          className="lh-mobile-preview-rename-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            props.onSaveRenamePreview(preview);
                          }}
                        >
                          <label className="lh-mobile-preview-field">
                            <span>Name</span>
                            <input
                              value={props.editingPreviewName}
                              onChange={(event) => props.onEditingPreviewNameChange(event.currentTarget.value)}
                            />
                          </label>
                          <div className="lh-mobile-preview-row-actions">
                            <button type="submit" disabled={props.busy}>Save</button>
                            <button type="button" onClick={props.onCancelRenamePreview}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="lh-mobile-preview-row-main">
                            <div className="lh-mobile-preview-row-header">
                              <strong>{preview.name}</strong>
                              <span className="lh-mobile-preview-status-rail">
                                {isAttached ? <span className="lh-mobile-preview-attached-label">Attached</span> : null}
                                {showPrimaryAction ? (
                                  <button
                                    className={`lh-mobile-preview-state lh-mobile-preview-state-${previewState.tone}`}
                                    type="button"
                                    onClick={() => requestActionConfirmation(preview.id, "primary")}
                                    disabled={props.busy}
                                    aria-label={`${previewState.actionLabel} ${preview.name}`}
                                  >
                                    {previewState.label}
                                  </button>
                                ) : (
                                  <span className={`lh-mobile-preview-state lh-mobile-preview-state-${previewState.tone}`}>
                                    {previewState.label}
                                  </span>
                                )}
                              </span>
                            </div>
                            <span>
                              <small>{preview.projectDirectory}</small>
                              <small className="lh-mobile-preview-state-detail">{previewState.detail}</small>
                              {preview.publishedOrigins.filter((origin) => origin.status === "published" && origin.publishedUrl).map((origin) => (
                                <small className="lh-mobile-preview-published-origin" key={origin.id}>
                                  {origin.source === "target" ? "Target" : origin.dependencyServiceName}: {origin.publishedUrl}
                                </small>
                              ))}
                            </span>
                          </div>
                          <div className="lh-mobile-preview-row-actions">
                            {showCopyPreviewLink ? (
                              <button
                                className="lh-mobile-preview-copy"
                                type="button"
                                onClick={() => props.onCopyPreviewLink(preview, previewOpenUrl)}
                                disabled={props.busy}
                              >
                                <Copy size={14} />
                                <span>{props.copiedPreviewLinkId === preview.id ? "Copied" : "Copy link"}</span>
                              </button>
                            ) : null}
                            {showPrimaryAction ? <button type="button" onClick={() => requestActionConfirmation(preview.id, "primary")} disabled={props.busy}>{previewState.actionLabel}</button> : null}
                            {showAttachAction ? <button type="button" onClick={() => requestActionConfirmation(preview.id, "attach")} disabled={props.busy}>Attach</button> : null}
                            {isAttached ? <button type="button" onClick={() => requestActionConfirmation(preview.id, "detach")} disabled={props.busy}>Detach</button> : null}
                            <button type="button" onClick={() => requestActionConfirmation(preview.id, "wire")} disabled={props.busy}>Wire</button>
                            <button type="button" onClick={() => requestActionConfirmation(preview.id, "rename")} disabled={props.busy}>Rename</button>
                            <button type="button" onClick={() => requestActionConfirmation(preview.id, "delete")} disabled={props.busy}>Delete</button>
                          </div>
                          {previewPendingAction ? (
                            <div className="lh-mobile-preview-confirm" role="dialog" aria-label={`${readPreviewActionLabel(previewPendingAction.kind, previewState)} ${preview.name}`}>
                              <span>{readPreviewActionQuestion(previewPendingAction.kind, previewState)}</span>
                              <div>
                                <button type="button" onClick={() => setPendingAction(null)}>Cancel</button>
                                <button
                                  className={previewPendingAction.kind === "delete" ? "danger" : undefined}
                                  type="button"
                                  onClick={runConfirmedPreviewAction}
                                  disabled={props.busy}
                                >
                                  {readPreviewActionLabel(previewPendingAction.kind, previewState)}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <section className="lh-mobile-preview-section">
            <form
              className="lh-mobile-preview-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onStartNewWiringThread();
              }}
            >
              <label className="lh-mobile-preview-field">
                <span>Project</span>
                <input
                  value={props.wiringBrief}
                  onChange={(event) => props.onWiringBriefChange(event.currentTarget.value)}
                  placeholder="Name or path"
                />
              </label>
              <button className="lh-mobile-preview-primary" type="submit" disabled={props.busy || !props.wiringBrief.trim()}>
                Start wiring
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}

function readPreviewActionLabel(kind: PreviewActionKind, previewState: PreviewState): string {
  if (kind === "primary") return previewState.actionLabel;
  if (kind === "attach") return "Attach";
  if (kind === "detach") return "Detach";
  if (kind === "wire") return "Open";
  if (kind === "rename") return "Rename";
  return "Delete";
}

function readPreviewActionQuestion(kind: PreviewActionKind, previewState: PreviewState): string {
  if (kind === "primary") return `${previewState.actionLabel} this preview?`;
  if (kind === "attach") return "Attach this preview?";
  if (kind === "detach") return "Detach this preview?";
  if (kind === "wire") return "Open a wiring thread?";
  if (kind === "rename") return "Rename this preview?";
  return "Delete this preview?";
}
