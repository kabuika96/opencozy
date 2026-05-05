import type { PreviewManifest, WiredPreview } from "./types";
import { previewNeedsPublishedTarget } from "./projectPreview";

export type PreviewReachability = "unknown" | "reachable" | "unreachable";

export type PreviewStateKind =
  | "ready"
  | "needs-start"
  | "needs-publish"
  | "unreachable"
  | "manifest-pending-approval";

export type PreviewRecoveryAction = "attach" | "open-wiring-session" | "publish" | "review-manifest";

export type PreviewState = {
  kind: PreviewStateKind;
  label: string;
  detail: string;
  nextAction: string;
  actionLabel: string;
  recoveryAction: PreviewRecoveryAction;
  tone: "ready" | "attention" | "blocked" | "pending";
};

export type PreviewStateInput = {
  preview: WiredPreview;
  pendingManifest?: PreviewManifest;
  reachability?: PreviewReachability;
};

export function deriveWiredPreviewState(input: PreviewStateInput): PreviewState {
  if (input.pendingManifest) {
    return {
      kind: "manifest-pending-approval",
      label: "Manifest pending approval",
      detail: "A newer wiring manifest is waiting for approval.",
      nextAction: "Review and approve the manifest before relying on the latest wiring.",
      actionLabel: "Review",
      recoveryAction: "review-manifest",
      tone: "pending"
    };
  }

  if (input.reachability === "unreachable") {
    return {
      kind: "unreachable",
      label: "Unreachable",
      detail: "The target URL did not respond on the last check.",
      nextAction: "Open the wiring session to inspect the app and repair the target.",
      actionLabel: "Open Wiring",
      recoveryAction: "open-wiring-session",
      tone: "blocked"
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
      kind: "needs-publish",
      label: "Needs publish",
      detail: "Remote devices need private origins for the target or browser-direct services.",
      nextAction: "Publish the missing private origins from OpenCozy.",
      actionLabel: "Publish",
      recoveryAction: "publish",
      tone: "attention"
    };
  }

  if (input.reachability === "reachable") {
    return {
      kind: "ready",
      label: "Ready",
      detail: "The target URL is open and ready to use.",
      nextAction: "Attach this preview to the current session.",
      actionLabel: "Attach",
      recoveryAction: "attach",
      tone: "ready"
    };
  }

  if (input.preview.commands.length > 0) {
    return {
      kind: "needs-start",
      label: "Needs start",
      detail: "Stored preview commands can start or repair this app.",
      nextAction: "Open the wiring session and ask before running the stored commands.",
      actionLabel: "Open Wiring",
      recoveryAction: "open-wiring-session",
      tone: "attention"
    };
  }

  return {
    kind: "ready",
    label: "Ready",
    detail: "The target URL is stored and ready to attach.",
    nextAction: "Attach this preview to the current session.",
    actionLabel: "Attach",
    recoveryAction: "attach",
    tone: "ready"
  };
}
