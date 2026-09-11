import { Check, ChevronDown, Cpu, Zap } from "lucide-react";
import type { ExecutionProfileSummary } from "../api";

export function ExecutionProfilePicker({ disabled, onSelect, profiles, selectedProfileId, fastMode }: {
  disabled: boolean;
  onSelect(profileId: string): void;
  profiles: ExecutionProfileSummary[];
  selectedProfileId: string;
  fastMode?: boolean;
}) {
  const selectedId = profiles.some(profile => profile.id === selectedProfileId) ? selectedProfileId : profiles[0]?.id;
  return <div aria-label="Execution profile" className="lh-mobile-profile-picker" role="group">
    {profiles.map(profile => {
      const selected = selectedId === profile.id;
      const fast = selected ? fastMode ?? profile.fastMode : profile.fastMode;
      return <button aria-label={`${profile.label} profile`} aria-pressed={selected}
        className={selected ? "is-active" : ""} disabled={disabled} key={profile.id}
        title={profile.description} type="button" onClick={() => onSelect(profile.id)}>
        <span className="lh-profile-copy"><strong>{profile.label}</strong><span>{profile.model}</span>
          <small>Main {profile.reasoningEffort}{profile.subagentReasoningEffort ? ` · Subagents ${profile.subagentReasoningEffort}` : ""}</small>
          <small>{fast ? "Fast" : "Standard"}</small></span>
        {selected ? <Check aria-hidden="true" size={17} /> : null}
      </button>;
    })}
  </div>;
}

export function NewThreadSettings({ disabled, fastMode, fastModeSupported, onFastModeChange, onSelect, profiles, selectedProfileId }: {
  disabled: boolean;
  fastMode: boolean;
  fastModeSupported: boolean;
  onFastModeChange(value: boolean): void;
  onSelect(profileId: string): void;
  profiles: ExecutionProfileSummary[];
  selectedProfileId: string;
}) {
  const selected = profiles.find(profile => profile.id === selectedProfileId);
  if (!selected) return <p className="lh-mobile-workspace-empty">Loading model settings…</p>;
  return <details className="lh-new-thread-settings">
    <summary aria-label="Model and settings">
      <Cpu aria-hidden="true" size={19} />
      <span className="lh-profile-copy"><small>Model &amp; settings</small><strong>{selected.model}</strong>
        <small>{selected.label} · {selected.reasoningEffort} · {fastMode ? "Fast" : "Standard"}</small>
        {selected.subagentReasoningEffort ? <small>Subagents · {selected.subagentReasoningEffort}</small> : null}</span>
      <ChevronDown aria-hidden="true" className="lh-settings-chevron" size={17} />
    </summary>
    <ExecutionProfilePicker disabled={disabled} profiles={profiles} selectedProfileId={selectedProfileId}
      fastMode={fastMode} onSelect={onSelect} />
    <p className="lh-profile-description">{selected.description}</p>
    {fastModeSupported ? <button type="button" role="switch" aria-label="Fast mode for new tab" aria-checked={fastMode}
      className="lh-new-thread-fast" disabled={disabled} onClick={() => onFastModeChange(!fastMode)}>
      <Zap aria-hidden="true" size={17} /><span>Fast mode</span><span className="lh-switch-track" aria-hidden="true"><span /></span>
    </button> : null}
  </details>;
}
