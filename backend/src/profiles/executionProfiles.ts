export type ExecutionProfileId = "default" | "speed" | "power";

type SubagentReasoningEffort = "low" | "high" | "xhigh";

export type ExecutionProfile = {
  description: string;
  developerInstructions: string;
  fastMode: boolean;
  id: ExecutionProfileId;
  label: string;
  model: string;
  reasoningEffort: "medium" | "high" | "max";
  subagents: {
    defaultModel: string;
    defaultReasoningEffort: SubagentReasoningEffort;
  };
};

export type ExecutionProfileSummary = Pick<
  ExecutionProfile,
  "description" | "fastMode" | "id" | "label" | "model" | "reasoningEffort"
> & { subagentModel: string; subagentReasoningEffort: SubagentReasoningEffort };

const astraModel = "gpt-6-astra";

function subagentInstructions(effort: SubagentReasoningEffort): string {
  return [
    "Follow the session's collaboration policy. These profile settings do not authorize delegation or override tool availability, model restrictions, or the user's chosen scope.",
    `When delegation is permitted and useful, use model ${astraModel} with reasoning effort ${effort} for every subagent role, including planning, implementation, review, and nested subagents.`,
    "When the permitted tool supports explicit model and effort settings, pass them and choose a context-fork mode that permits those overrides. Include the context the subagent needs. Follow higher-priority session and tool restrictions if they prevent these settings; report a material limitation rather than claiming the requested settings were used.",
    "Delegate only bounded work that can proceed independently alongside useful main-thread work. Keep short or serial tasks local. Keep conflicting write work sequential, wait for required results, and return to the main thread to integrate and report.",
    "Give each subagent a concrete outcome, owned files or scope, relevant constraints, and a verification target. Reuse an existing agent for related follow-up work when that preserves context.",
    "Do not require a fixed agent count or spawn agents merely to repeat the same investigation. Communicate decisions and blockers directly to the relevant agent. Report changed files, verification evidence, and remaining risks. The main agent integrates and verifies the combined result before declaring completion.",
  ].join("\n");
}

function makeProfile(id: ExecutionProfileId, label: string, reasoningEffort: ExecutionProfile["reasoningEffort"], childEffort: SubagentReasoningEffort, fastMode: boolean): ExecutionProfile {
  return {
    id, label, model: astraModel, reasoningEffort, fastMode,
    description: `Subagents use ${astraModel} with ${childEffort} reasoning when delegation is allowed.`,
    developerInstructions: subagentInstructions(childEffort),
    subagents: { defaultModel: astraModel, defaultReasoningEffort: childEffort },
  };
}

// Keep the existing default ID for Balance so saved tabs keep their identity.
const profiles: readonly ExecutionProfile[] = [
  makeProfile("default", "Balance", "high", "high", true),
  makeProfile("speed", "Speed", "medium", "low", true),
  makeProfile("power", "Power", "max", "xhigh", false),
];

export const defaultExecutionProfileId: ExecutionProfileId = "default";

export function listExecutionProfiles(): ExecutionProfile[] {
  return profiles.map(profile => ({ ...profile, subagents: { ...profile.subagents } }));
}

export function listExecutionProfileSummaries(): ExecutionProfileSummary[] {
  return profiles.map(({ description, fastMode, id, label, model, reasoningEffort, subagents }) => ({
    description, fastMode, id, label, model, reasoningEffort,
    subagentModel: subagents.defaultModel,
    subagentReasoningEffort: subagents.defaultReasoningEffort,
  }));
}

export function resolveExecutionProfile(id: string | null | undefined): ExecutionProfile {
  // The retired Astra choice is an input/storage alias, never a fourth option.
  return profiles.find(profile => profile.id === id) ?? profiles[0]!;
}

export function isExecutionProfileId(value: unknown): value is ExecutionProfileId | "astra" {
  return typeof value === "string" && (value === "astra" || profiles.some(profile => profile.id === value));
}
