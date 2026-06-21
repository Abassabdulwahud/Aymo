import { InsightItem } from "../types";

interface AIAssistantPanelProps {
  insights: InsightItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function AIAssistantPanel({ insights, collapsed, onToggleCollapsed }: AIAssistantPanelProps) {
  return (
    <section className="assistant-panel" aria-label="AI assistant insights">
      <div className="assistant-head">
        <div>
          <p className="assistant-label">AI Assistant</p>
          <h2>Insights & Learning Tips</h2>
        </div>
        <button className="btn btn-ghost" onClick={onToggleCollapsed}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed ? (
        <div className="insight-list">
          {insights.map((insight) => (
            <article key={insight.id} className="insight-card">
              <h3>{insight.title}</h3>
              <p>{insight.detail}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
