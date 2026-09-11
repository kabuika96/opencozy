import type { HarnessAttachment } from "../attachments/attachments.js";
import type { HarnessCapabilities, HarnessType, WorkspaceDiscovery } from "../types.js";
import type { ExecutionProfileSummary } from "../profiles/executionProfiles.js";

export type HarnessEvent =
  | {
      payload?: Record<string, unknown>;
      text: string;
      type: "thread.started" | "run.started" | "harness.status" | "harness.output" | "approval.responded" | "input.responded" | "run.completed" | "run.canceled" | "run.steered";
    }
  | {
      payload?: Record<string, unknown>;
      text: string;
      type: "run.failed";
    }
  | {
      approvalId: string;
      payload?: Record<string, unknown>;
      text: string;
      type: "approval.requested";
    }
  | {
      inputRequestId: string;
      payload?: Record<string, unknown>;
      questions: HarnessInputQuestion[];
      text: string;
      type: "input.requested";
    };

export type HarnessInputOption = {
  description: string;
  label: string;
};

export type HarnessInputQuestion = {
  allowOther: boolean;
  header: string;
  id: string;
  isSecret: boolean;
  options: HarnessInputOption[] | null;
  question: string;
};

export type StartHarnessThreadInput = {
  fastMode?: boolean;
  liteHarnessThreadId?: string;
  profileId?: string;
  workspacePath: string;
};

export type DiscoverWorkspaceInput = {
  defaultWorkspacePath: string;
  description: string;
};

export type HarnessThreadRef = {
  harnessThreadId: string | null;
};

export type HarnessFileAssets = {
  contextPath: string;
  cliPath: string;
  invoke(tool: string, args: unknown): Promise<unknown>;
};

export type RunHarnessInput = {
  fileAssets?: HarnessFileAssets;
  attachments?: HarnessAttachment[];
  fastMode?: boolean;
  harnessThreadId: string | null;
  harnessPrompt?: string;
  liteHarnessThreadId?: string;
  profileId?: string;
  prompt: string;
  runId: string;
  signal?: AbortSignal;
  workspacePath: string;
};

export type ApprovalDecisionInput = {
  approvalId: string;
  approved: boolean;
};

export type InputResponseInput = {
  answers: Record<string, string[]>;
  inputRequestId: string;
};

export type RunUserInputInput = {
  attachments?: HarnessAttachment[];
  prompt: string;
  runId: string;
  threadId: string;
};

export type RunAgentInputInput = {
  attachments?: HarnessAttachment[];
  agentThreadId: string;
  prompt: string;
  runId: string;
};

export type HarnessAdapter = {
  capabilities: HarnessCapabilities;
  label: string;
  type: HarnessType;
  listExecutionProfiles?(): ExecutionProfileSummary[];
  start?(): Promise<void>;
  close?(): Promise<void>;
  discoverWorkspace(input: DiscoverWorkspaceInput): Promise<WorkspaceDiscovery>;
  startThread(input: StartHarnessThreadInput): Promise<HarnessThreadRef>;
  run(input: RunHarnessInput): AsyncIterable<HarnessEvent>;
  respondToApproval(input: ApprovalDecisionInput): Promise<void>;
  respondToInput(input: InputResponseInput): Promise<void>;
  sendAgentInput?(input: RunAgentInputInput): Promise<void>;
  sendUserInput(input: RunUserInputInput): Promise<HarnessEvent | null | void>;
};
