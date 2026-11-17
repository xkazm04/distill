import { agentQueue, taskWords, useAgentQueue, type AgentQueue } from "./agentQueue";

/**
 * The designed waiting state of "My agent": one card per task waiting for the person's agent, with Cancel and "Use
 * Distill's AI instead". The view that asked keeps its own loading look underneath.
 */
export function AgentWaiting({ queue = agentQueue }: { queue?: AgentQueue }) {
  const { tasks } = useAgentQueue(queue);
  if (tasks.length === 0) return null;
  return (
    <div className="agent-waiting" data-testid="agent-task-waiting">
      {tasks.map((t) => (
        <div key={t.taskId} className="notice" role="status">
          <p className="agent-waiting-h"><span className="sk agent-waiting-dot" aria-hidden="true" />Waiting for your agent...</p>
          <p className="muted">It was asked to {taskWords(t.task)}. In Claude Code or agy, ask it to do Distill's tasks.</p>
          <div className="nav">
            <button type="button" className="btn btn-small" onClick={() => queue.cancel(t.taskId)}>Cancel</button>
            <button type="button" className="btn btn-small" onClick={() => queue.useDistill(t.taskId)} data-testid="agent-use-distill">Use Distill's AI instead</button>
          </div>
        </div>
      ))}
    </div>
  );
}
