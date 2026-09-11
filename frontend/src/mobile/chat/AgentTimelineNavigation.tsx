import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { agentBranchBreadcrumbs, summarizeAgentBranches, type AgentBranch } from "./agentBranches";
import "./AgentTimelineNavigation.css";

type AgentTimelineNavigationProps = {
  branches: AgentBranch[];
  onSelect(id: string | null): void;
  selectedBranchId: string | null;
};

export function AgentTimelineNavigation({ branches, onSelect, selectedBranchId }: AgentTimelineNavigationProps) {
  const [mainListExpanded, setMainListExpanded] = useState(false);
  const breadcrumbs = agentBranchBreadcrumbs(branches, selectedBranchId);
  const summary = summarizeAgentBranches(branches);
  const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;
  const showBranches = mainListExpanded;

  return (
    <nav aria-label="Agent timelines" className="lh-agent-navigation">
      <div className="lh-agent-navigation-topline">
        <button
          aria-current={selectedBranchId === null ? "page" : undefined}
          className="lh-agent-main-button"
          type="button"
          onClick={() => {
            setMainListExpanded(false);
            onSelect(null);
          }}
        >
          Main <span>{summary.total} agents · {summary.running} working</span>
        </button>
        {summary.failed > 0 ? <span className="lh-agent-count is-failed">{summary.failed} failed</span> : null}
        {summary.pending > 0 ? <span className="lh-agent-count">{summary.pending} queued</span> : null}
        {branches.length > 0 ? (
          <button className="lh-agent-toggle" type="button" onClick={() => setMainListExpanded((current) => !current)}>
            {mainListExpanded ? "Hide agents" : "Show agents"}
          </button>
        ) : null}
      </div>

      {selectedBranchId !== null ? (
        <div className="lh-agent-breadcrumbs">
          {parent ? (
            <button aria-label={`Back to ${parent.label}`} className="lh-agent-back" type="button" onClick={() => onSelect(parent.id)}>
              <ChevronLeft aria-hidden="true" size={14} strokeWidth={2.2} />
            </button>
          ) : null}
          {breadcrumbs.map((breadcrumb, index) => (
            <span key={breadcrumb.id ?? "main"}>
              {index > 0 ? <ChevronRight aria-hidden="true" size={11} strokeWidth={2} /> : null}
              <button aria-current={index === breadcrumbs.length - 1 ? "page" : undefined} type="button" onClick={() => onSelect(breadcrumb.id)}>
                {breadcrumb.label}
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {showBranches ? <div className="lh-agent-list" role="list">
        {branches.map((branch) => (
          <button
            aria-label={`Open ${branch.label}, ${branch.status}`}
            aria-pressed={selectedBranchId === branch.id}
            className={selectedBranchId === branch.id ? "is-active" : ""}
            key={branch.id}
            type="button"
            onClick={() => { setMainListExpanded(false); onSelect(branch.id); }}
          >
            <span aria-hidden="true" className={`lh-agent-status is-${branch.status}`} />
            <span className="lh-agent-copy">
              <strong>{branch.label}</strong>
              <small>{branch.task ?? branch.role ?? branch.lastActivity ?? "Working"}</small>
            </span>
            <span className="lh-agent-activity">{branch.activityCount}</span>
          </button>
        ))}
      </div> : null}
    </nav>
  );
}
