import type { PreviewManifest, WiredPreview } from "../api";
import { previewNeedsPublishedTarget } from "./projectPreview";

export type PreviewReachability = "unknown" | "reachable" | "unreachable";

export type PreviewStateKind =
  | "ready"
  | "source-conflict"
  | "needs-publish"
  | "unreachable"
  | "manifest-pending-approval";

export type PreviewRecoveryAction = "attach" | "open-wiring-thread" | "publish" | "review-manifest";

export type PreviewState = {
  actionLabel: string;
  detail: string;
  kind: PreviewStateKind;
  label: string;
  recoveryAction: PreviewRecoveryAction;
  tone: "ready" | "attention" | "blocked" | "pending";
};

export type PreviewStateInput = {
  pendingManifest?: PreviewManifest;
  preview: WiredPreview;
  reachability?: PreviewReachability;
  sourceConflictPreviewName?: string | null;
};

export function deriveWiredPreviewState(input: PreviewStateInput): PreviewState {
  if (input.pendingManifest) {
    return {
      actionLabel: "Review",
      detail: "A newer wiring manifest is waiting for approval.",
      kind: "manifest-pending-approval",
      label: "Pending approval",
      recoveryAction: "review-manifest",
      tone: "pending",
    };
  }

  if (input.sourceConflictPreviewName) {
    return {
      actionLabel: "Wire",
      detail: `Shares target origin with ${input.sourceConflictPreviewName}.`,
      kind: "source-conflict",
      label: "Needs wiring",
      recoveryAction: "open-wiring-thread",
      tone: "blocked",
    };
  }

  if (input.reachability === "unreachable") {
    return {
      actionLabel: "Open wiring",
      detail: "The target URL did not respond on the last check.",
      kind: "unreachable",
      label: "Unreachable",
      recoveryAction: "open-wiring-thread",
      tone: "blocked",
    };
  }

  const browserDirectDependencyNeedsPublish = input.preview.dependencyServices.some((service, serviceIndex) => (
    service.browserDirect
    && !input.preview.publishedOrigins.some((origin) => (
      origin.source === "dependency-service"
      && origin.dependencyServiceIndex === serviceIndex
      && origin.status === "published"
      && Boolean(origin.publishedUrl)
    ))
  ));

  if (previewNeedsPublishedTarget(input.preview) || browserDirectDependencyNeedsPublish) {
    return {
      actionLabel: "Publish",
      detail: "Remote devices need private origins for this preview.",
      kind: "needs-publish",
      label: "Needs publish",
      recoveryAction: "publish",
      tone: "attention",
    };
  }

  return {
    actionLabel: "Attach",
    detail: input.reachability === "reachable"
      ? "Open and ready."
      : input.preview.commands.length > 0
        ? "Stored target; commands available if it needs repair."
        : "Stored target.",
    kind: "ready",
    label: "Ready",
    recoveryAction: "attach",
    tone: "ready",
  };
}
