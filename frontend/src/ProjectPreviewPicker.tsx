import { useState } from "react";
import { CircleHelp, Copy, X } from "lucide-react";
import { deriveWiredPreviewState, type PreviewState } from "./previewState";
import { orderPreviewsWithAttachedFirst, readWiredPreviewOpenUrl } from "./projectPreview";
import type { PreviewManifest, WiredPreview } from "./types";

type ProjectPreviewPane = "saved" | "wire";
type PreviewActionKind = "primary" | "attach" | "detach" | "wire" | "rename" | "delete";
type PendingPreviewAction = {
  kind: PreviewActionKind;
  previewId: string;
};

export type ProjectPreviewPickerProps = {
  activePreview: WiredPreview | null;
  busy: boolean;
  confirmDeletePreviewId: string | null;
  editingPreviewId: string | null;
  editingPreviewName: string;
  error: string | null;
  copiedPreviewLinkId: string | null;
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
  onCancelDeletePreview: () => void;
  onCancelRenamePreview: () => void;
  onConfirmDeletePreview: (previewId: string) => void;
  onCopyPreviewLink: (preview: WiredPreview, url: string) => void;
  onDeletePreview: (preview: WiredPreview) => void;
  onDetachActivePreview: () => void;
  onEditingPreviewNameChange: (value: string) => void;
  onManifestNameDraftChange: (manifestId: string, value: string) => void;
  onOpenWiringSession: (preview?: WiredPreview) => void;
  onRunPreviewAction: (preview: WiredPreview, previewState: PreviewState, pendingManifest?: PreviewManifest) => void;
  onSaveRenamePreview: (preview: WiredPreview) => void;
  onSearchChange: (value: string) => void;
  onStartNewWiringSession: () => void;
  onStartRenamePreview: (preview: WiredPreview) => void;
  onWiringBriefChange: (value: string) => void;
};

export function ProjectPreviewPicker(props: ProjectPreviewPickerProps) {
  const [activePane, setActivePane] = useState<ProjectPreviewPane>("saved");
  const [pendingAction, setPendingAction] = useState<PendingPreviewAction | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const activePreview = props.activePreview;
  const previewsToShow = orderPreviewsWithAttachedFirst(props.previews, activePreview);
  const trimmedSearch = props.search.trim();
  const emptyListCopy = trimmedSearch ? `No matches for "${trimmedSearch}".` : "No Wired Previews yet.";

  const requestActionConfirmation = (previewId: string, kind: PreviewActionKind) => {
    setPendingAction((current) => (
      current?.previewId === previewId && current.kind === kind ? null : { previewId, kind }
    ));
  };

  return (
    <div className="projectPreviewPage">
      <header className="projectPreviewPageHeader">
        <h2>Project Preview</h2>
      </header>
      <div className="projectPreviewPageContent">
        <div className="projectPreviewTabs" role="tablist" aria-label="Project preview sections">
          <button
            className={activePane === "saved" ? "projectPreviewTab active" : "projectPreviewTab"}
            type="button"
            role="tab"
            aria-selected={activePane === "saved"}
            aria-controls="project-preview-saved-panel"
            id="project-preview-saved-tab"
            onClick={() => setActivePane("saved")}
          >
            Saved Previews
          </button>
          <button
            className={activePane === "wire" ? "projectPreviewTab active" : "projectPreviewTab"}
            type="button"
            role="tab"
            aria-selected={activePane === "wire"}
            aria-controls="project-preview-wire-panel"
            id="project-preview-wire-tab"
            onClick={() => setActivePane("wire")}
          >
            Wire New
          </button>
        </div>

        {props.error && <div className="previewUrlError">{props.error}</div>}

        {activePane === "saved" ? (
          <div
            className="projectPreviewPane"
            role="tabpanel"
            id="project-preview-saved-panel"
            aria-labelledby="project-preview-saved-tab"
          >
            {props.previewManifests.length > 0 && (
              <section className="projectPreviewSection" aria-labelledby="previewManifestApprovalTitle">
                <div className="projectPreviewSectionHeader">
                  <h3 id="previewManifestApprovalTitle">Pending Approval</h3>
                  <p>Confirm the name before OpenCozy creates or updates reusable preview data.</p>
                </div>
                <div className="wiredPreviewList">
                  {props.previewManifests.map((manifest) => (
                    <form
                      className="wiredPreviewManifestRow"
                      key={manifest.id}
                      id={`preview-manifest-${manifest.id}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        props.onApproveManifest(manifest);
                      }}
                    >
                      <div className="wiredPreviewManifestSummary">
                        <strong>{manifest.proposedName}</strong>
                        <small>{manifest.projectDirectory}</small>
                        <small>{manifest.target.url}</small>
                      </div>
                      <label className="field previewUrlField">
                        <span>Wired Preview Name</span>
                        <input
                          value={props.previewManifestNameDrafts[manifest.id] ?? manifest.proposedName}
                          onChange={(event) => props.onManifestNameDraftChange(manifest.id, event.currentTarget.value)}
                        />
                      </label>
                      <button
                        className="primaryButton previewSaveButton"
                        type="submit"
                        disabled={props.busy || !(props.previewManifestNameDrafts[manifest.id] ?? manifest.proposedName).trim()}
                      >
                        <span>Approve and Attach</span>
                      </button>
                    </form>
                  ))}
                </div>
              </section>
            )}

            <section className="projectPreviewSection" aria-label="Saved previews">
              <div className="projectPreviewPaneIntro">
                <p className="projectPreviewPaneCopy">Attach one to this tab or update its wiring.</p>
                <button
                  className="projectPreviewHelpButton"
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  aria-label="Explain Wired Previews"
                >
                  <CircleHelp size={17} />
                </button>
              </div>
              {!activePreview && (
                <div className="wiredPreviewAttachmentNote">No preview attached to this tab.</div>
              )}
              <label className="field previewUrlField">
                <span>Search</span>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="Project or preview name"
                  value={props.search}
                  onChange={(event) => props.onSearchChange(event.currentTarget.value)}
                />
              </label>

              <div className="wiredPreviewList" aria-busy={props.loading}>
                {props.loading && <div className="wiredPreviewListState">Loading previews...</div>}
                {!props.loading && previewsToShow.length === 0 && (
                  <div className="wiredPreviewListState">{emptyListCopy}</div>
                )}
                {!props.loading && previewsToShow.map((preview) => {
                  const pendingManifest = props.pendingManifestByPreviewId.get(preview.id);
                  const isAttached = activePreview?.id === preview.id;
                  const isHealthy = props.healthyPreviewId === preview.id;
                  const previewState = deriveWiredPreviewState({
                    preview,
                    pendingManifest,
                    reachability: isHealthy ? "reachable" : undefined
                  });
                  const previewPendingAction = pendingAction?.previewId === preview.id ? pendingAction : null;
                  const showPrimaryAction = !(isAttached && previewState.recoveryAction === "attach");
                  const showAttachAction = !isAttached && previewState.recoveryAction !== "attach";
                  const confirmActionLabel = readPreviewActionLabel(previewPendingAction?.kind, previewState);
                  const confirmActionQuestion = readPreviewActionQuestion(previewPendingAction?.kind, previewState);
                  const previewOpenUrl = readWiredPreviewOpenUrl(preview);
                  const showCopyPreviewLink = isHealthy && previewState.kind === "ready" && Boolean(previewOpenUrl);

                  const runConfirmedPreviewAction = () => {
                    if (!previewPendingAction) {
                      return;
                    }

                    setPendingAction(null);

                    if (previewPendingAction.kind === "primary") {
                      props.onRunPreviewAction(preview, previewState, pendingManifest);
                      return;
                    }

                    if (previewPendingAction.kind === "attach") {
                      props.onAttachPreview(preview);
                      return;
                    }

                    if (previewPendingAction.kind === "detach") {
                      props.onDetachActivePreview();
                      return;
                    }

                    if (previewPendingAction.kind === "wire") {
                      props.onOpenWiringSession(preview);
                      return;
                    }

                    if (previewPendingAction.kind === "rename") {
                      props.onStartRenamePreview(preview);
                      return;
                    }

                    props.onDeletePreview(preview);
                  };

                  return (
                    <div className="wiredPreviewRow" key={preview.id}>
                      {props.editingPreviewId === preview.id ? (
                        <form
                          className="wiredPreviewRenameForm"
                          onSubmit={(event) => {
                            event.preventDefault();
                            props.onSaveRenamePreview(preview);
                          }}
                        >
                          <label className="field previewUrlField">
                            <span>Name</span>
                            <input
                              value={props.editingPreviewName}
                              onChange={(event) => props.onEditingPreviewNameChange(event.currentTarget.value)}
                            />
                          </label>
                          <div className="wiredPreviewRowActions">
                            <button className="settingsTextButton" type="submit" disabled={props.busy}>
                              Save
                            </button>
                            <button className="settingsTextButton" type="button" onClick={props.onCancelRenamePreview}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="wiredPreviewRowMain">
                            <div className="wiredPreviewRowHeader">
                              <strong>{preview.name}</strong>
                              <span className="wiredPreviewStatusRail">
                                {isAttached && (
                                  <span className="wiredPreviewAttachedLabel">Attached to this session</span>
                                )}
                                {showPrimaryAction ? (
                                  <button
                                    className={`previewStateLabel previewStateLabel--${previewState.tone} previewStateLabelButton`}
                                    type="button"
                                    onClick={() => requestActionConfirmation(preview.id, "primary")}
                                    disabled={props.busy}
                                    aria-label={`${previewState.actionLabel} ${preview.name}`}
                                  >
                                    {previewState.label}
                                  </button>
                                ) : (
                                  <span className={`previewStateLabel previewStateLabel--${previewState.tone}`}>
                                    {previewState.label}
                                  </span>
                                )}
                              </span>
                            </div>
                            <span>
                              <small>{preview.projectDirectory}</small>
                              <small className="previewStateDetail">{previewState.detail}</small>
                              {preview.dependencyServices.some((service) => service.browserDirect) && (
                                <small className="previewStateDetail">Browser-direct services use separate private origins.</small>
                              )}
                              {preview.publishedOrigins.filter((origin) => origin.status === "published" && origin.publishedUrl).map((origin) => (
                                <small className="previewPublishedOrigin" key={origin.id}>
                                  {origin.source === "target" ? "Target" : origin.dependencyServiceName}: {origin.publishedUrl}
                                </small>
                              ))}
                            </span>
                          </div>
                          <div className="wiredPreviewRowActions">
                            {showCopyPreviewLink && (
                              <button
                                className="wiredPreviewCopyLinkButton"
                                type="button"
                                onClick={() => props.onCopyPreviewLink(preview, previewOpenUrl)}
                                disabled={props.busy}
                              >
                                <Copy size={14} />
                                <span>{props.copiedPreviewLinkId === preview.id ? "Copied" : "Copy Preview Link"}</span>
                              </button>
                            )}
                            {showPrimaryAction && (
                              <button
                                className="settingsTextButton"
                                type="button"
                                onClick={() => requestActionConfirmation(preview.id, "primary")}
                                disabled={props.busy}
                              >
                                {previewState.actionLabel}
                              </button>
                            )}
                            {showAttachAction && (
                              <button className="settingsTextButton" type="button" onClick={() => requestActionConfirmation(preview.id, "attach")} disabled={props.busy}>
                                Attach
                              </button>
                            )}
                            {isAttached && (
                              <button className="settingsTextButton" type="button" onClick={() => requestActionConfirmation(preview.id, "detach")} disabled={props.busy}>
                                Detach
                              </button>
                            )}
                            <button className="settingsTextButton" type="button" onClick={() => requestActionConfirmation(preview.id, "wire")} disabled={props.busy}>
                              Wire
                            </button>
                            <button className="settingsTextButton" type="button" onClick={() => requestActionConfirmation(preview.id, "rename")} disabled={props.busy}>
                              Rename
                            </button>
                            <button className="settingsTextButton" type="button" onClick={() => requestActionConfirmation(preview.id, "delete")} disabled={props.busy}>
                              Delete
                            </button>
                          </div>
                          {previewPendingAction && (
                            <div className="wiredPreviewActionConfirm" role="dialog" aria-label={`${confirmActionLabel} ${preview.name}`}>
                              <span>{confirmActionQuestion}</span>
                              <div className="wiredPreviewActionConfirmActions">
                                <button type="button" onClick={() => setPendingAction(null)}>
                                  Cancel
                                </button>
                                <button
                                  className={previewPendingAction.kind === "delete" ? "danger" : undefined}
                                  type="button"
                                  onClick={runConfirmedPreviewAction}
                                  disabled={props.busy}
                                >
                                  {confirmActionLabel}
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <section
            className="projectPreviewSection"
            role="tabpanel"
            id="project-preview-wire-panel"
            aria-labelledby="project-preview-wire-tab"
          >
            <p className="projectPreviewPaneCopy">Describe a project. Codex will find it and submit wiring for approval.</p>
            <form
              className="wiredPreviewCreateForm"
              onSubmit={(event) => {
                event.preventDefault();
                props.onStartNewWiringSession();
              }}
            >
              <label className="field previewUrlField">
                <span>Project Search Brief</span>
                <input
                  value={props.wiringBrief}
                  onChange={(event) => props.onWiringBriefChange(event.currentTarget.value)}
                  placeholder="Project name or details"
                />
              </label>
              <button className="primaryButton previewSaveButton" type="submit" disabled={props.busy || !props.wiringBrief.trim()}>
                <span>Start Wiring Session</span>
              </button>
            </form>
          </section>
        )}
      </div>
      {helpOpen && (
        <div className="projectPreviewHelpOverlay" role="presentation">
          <div className="projectPreviewHelpDialog" role="dialog" aria-modal="true" aria-labelledby="projectPreviewHelpTitle">
            <header className="projectPreviewHelpHeader">
              <h3 id="projectPreviewHelpTitle">Wired Previews</h3>
              <button className="iconButton small" type="button" onClick={() => setHelpOpen(false)} aria-label="Close help">
                <X size={16} />
              </button>
            </header>
            <div className="projectPreviewHelpBody">
              <section>
                <h4>Concepts</h4>
                <dl>
                  <div>
                    <dt>Saved Preview</dt>
                    <dd>A reusable project preview record stored by OpenCozy and available across your devices.</dd>
                  </div>
                  <div>
                    <dt>Attached</dt>
                    <dd>The preview currently connected to this session tab.</dd>
                  </div>
                  <div>
                    <dt>State</dt>
                    <dd>Readiness of the saved preview: ready, missing private origins, needing a start command, or waiting for approval.</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h4>Actions</h4>
                <dl>
                  <div>
                    <dt>Attach</dt>
                    <dd>Use this saved preview for the current session tab.</dd>
                  </div>
                  <div>
                    <dt>Publish</dt>
                    <dd>Create private Tailscale origins for URLs that your phone cannot reach directly.</dd>
                  </div>
                  <div>
                    <dt>Wire</dt>
                    <dd>Open the Codex wiring session to inspect or repair the preview setup.</dd>
                  </div>
                  <div>
                    <dt>Rename</dt>
                    <dd>Change the saved preview name shown in this list.</dd>
                  </div>
                  <div>
                    <dt>Detach</dt>
                    <dd>Remove the preview from this session tab without deleting it.</dd>
                  </div>
                  <div>
                    <dt>Delete</dt>
                    <dd>Remove the saved preview record for all devices.</dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function readPreviewActionLabel(kind: PreviewActionKind | undefined, previewState: PreviewState): string {
  if (kind === "primary") {
    return previewState.actionLabel;
  }

  if (kind === "attach") {
    return "Attach";
  }

  if (kind === "detach") {
    return "Detach";
  }

  if (kind === "wire") {
    return "Open";
  }

  if (kind === "rename") {
    return "Rename";
  }

  return "Delete";
}

function readPreviewActionQuestion(kind: PreviewActionKind | undefined, previewState: PreviewState): string {
  if (kind === "primary") {
    return `${previewState.actionLabel} this preview?`;
  }

  if (kind === "attach") {
    return "Attach this preview to the current tab?";
  }

  if (kind === "detach") {
    return "Detach this preview from this tab?";
  }

  if (kind === "wire") {
    return "Open the wiring session for this preview?";
  }

  if (kind === "rename") {
    return "Rename this preview?";
  }

  return "Delete this preview?";
}
