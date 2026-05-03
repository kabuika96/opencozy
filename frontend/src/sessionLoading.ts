import type { OpenCozySessionMode } from "./types";

export type SessionLoadingPhase = "initializing" | "connecting" | "waitingForOutput";

export type SessionLoadingCopy = {
  title: string;
  detail: string;
};

export function getSessionLoadingCopy(mode: OpenCozySessionMode, phase: SessionLoadingPhase): SessionLoadingCopy {
  if (phase === "connecting") {
    return {
      title: "Connecting",
      detail: "Attaching to the OpenCozy Session."
    };
  }

  if (phase === "waitingForOutput") {
    if (mode === "resume") {
      return {
        title: "Waiting for Sessions",
        detail: "Codex is preparing the Resume Picker."
      };
    }

    if (mode === "resumeLast") {
      return {
        title: "Waiting for Codex",
        detail: "The last Codex Session is loading."
      };
    }

    return {
      title: "Waiting for Codex",
      detail: "The first output should appear shortly."
    };
  }

  if (mode === "resume") {
    return {
      title: "Opening Sessions",
      detail: "Starting the Resume Picker."
    };
  }

  if (mode === "resumeLast") {
    return {
      title: "Resuming Last Session",
      detail: "Starting Codex with the last saved conversation."
    };
  }

  return {
    title: "Starting Codex",
    detail: "Opening a new Codex Session."
  };
}
