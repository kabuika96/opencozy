import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WiredPreview } from "./types.js";

type PreviewWiringPromptInput = {
  backendPort: number;
  projectSearchBrief: string;
  wiringSessionId: string;
  wiredPreview: WiredPreview | null;
};

type PreviewWiringPromptFileInput = {
  dbPath: string;
  prompt: string;
  wiringSessionId: string;
};

type PreviewWiringLaunchPromptInput = {
  backendPort: number;
  promptFilePath: string;
};

function formatStoredPreviewCommands(preview: WiredPreview | null): string[] {
  if (!preview || preview.commands.length === 0) {
    return [];
  }

  return [
    "",
    "Stored Preview Commands:",
    ...preview.commands.flatMap((command, index) => [
      `${index + 1}. ${command.label}`,
      `   cwd: ${command.cwd}`,
      `   command: ${command.command}`
    ]),
    "Treat stored commands as recovery metadata. Present them to the user and ask before running anything."
  ];
}

export function buildPreviewWiringPrompt(input: PreviewWiringPromptInput): string {
  const manifestEndpoint = `http://127.0.0.1:${input.backendPort}/api/preview-manifests`;
  const manifestShape = {
    ...(input.wiredPreview ? { wiredPreviewId: input.wiredPreview.id } : {}),
    wiringSessionId: input.wiringSessionId,
    name: input.wiredPreview?.name ?? "User-confirmed preview name",
    projectDirectory: input.wiredPreview?.projectDirectory ?? "/absolute/path/to/project",
    target: {
      name: input.wiredPreview?.target.name ?? "App",
      url: input.wiredPreview?.target.url ?? "http://127.0.0.1:5173/"
    },
    dependencyServices: input.wiredPreview?.dependencyServices ?? [],
    commands: input.wiredPreview?.commands ?? [],
    requestedPublishedOrigins: input.wiredPreview?.requestedPublishedOrigins ?? []
  };

  return [
    "You are wiring an OpenCozy Project Preview in a visible Preview Wiring Session.",
    "",
    `Project Search Brief: ${input.projectSearchBrief}`,
    input.wiredPreview
      ? `Existing Wired Preview: ${input.wiredPreview.name} (${input.wiredPreview.id})`
      : "Existing Wired Preview: none; create a new reusable preview manifest.",
    ...formatStoredPreviewCommands(input.wiredPreview),
    "",
    "Work rules:",
    "1. Search the Codex Host for candidate Project Directories that match the brief.",
    "2. Show the user the likely Project Directory candidates and ask them to confirm before wiring.",
    "3. After confirmation, inspect the project and identify the frontend Preview Target, required dependency services, browser-direct dependency flags, and useful Preview Commands.",
    "4. Do not run hidden long-lived services through OpenCozy; use commands as metadata and ask the user before starting anything disruptive.",
    "5. For phone preview, do not treat localhost, 127.0.0.1, ::1, or 0.0.0.0 as browser-reachable Direct LAN target URLs. If the target is host-local, include it in requestedPublishedOrigins so OpenCozy can publish a private HTTPS origin.",
    "6. Submit a Preview Manifest only after the Project Directory is confirmed.",
    "",
    "Submit the manifest to the local OpenCozy backend with this endpoint:",
    manifestEndpoint,
    "",
    "Manifest JSON shape:",
    JSON.stringify(manifestShape, null, 2),
    "",
    "After submission, tell the user to return to Project Preview and approve the pending manifest."
  ].join("\n");
}

export function writePreviewWiringPromptFile(input: PreviewWiringPromptFileInput): string {
  const promptDirectory = path.join(path.dirname(input.dbPath), "preview-wiring-sessions");
  mkdirSync(promptDirectory, { recursive: true });

  const promptFilePath = path.join(promptDirectory, `${input.wiringSessionId}.md`);
  writeFileSync(promptFilePath, input.prompt, "utf8");
  return promptFilePath;
}

export function buildPreviewWiringLaunchPrompt(input: PreviewWiringLaunchPromptInput): string {
  const manifestEndpoint = `http://127.0.0.1:${input.backendPort}/api/preview-manifests`;

  return `Read and follow the OpenCozy Project Preview wiring instructions in the local file ${JSON.stringify(input.promptFilePath)}. After the user confirms the project directory, submit the Preview Manifest to ${manifestEndpoint}.`;
}
