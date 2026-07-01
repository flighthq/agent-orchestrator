/**
 * Live state of an agent's tmux session, as reported by `tmux`:
 * - `attached` — a session exists and a client is attached (someone is in `quimby run`)
 * - `running` — a session exists but no client is attached (headless, via `quimby start`)
 * - `stopped` — no session (not launched, or a local non-tmux agent with nothing to probe)
 */
export type AgentSessionState = 'attached' | 'running' | 'stopped'
