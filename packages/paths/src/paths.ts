import { join } from 'pathe'

export function getQuimbyDir(repoRoot: string): string {
  return join(repoRoot, '.quimby')
}

export function getStatePath(repoRoot: string): string {
  return join(repoRoot, '.quimby', 'state.yaml')
}

export function getWorkersDir(repoRoot: string): string {
  return join(repoRoot, '.quimby', 'workers')
}

export function getWorkerDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name)
}

export function getWorkerRepoDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name, 'repo')
}

// The host loading dock: a parcel is assembled here while being applied or carried,
// then discarded. Transient staging, never an archive.
export function getStagingDir(repoRoot: string): string {
  return join(repoRoot, '.quimby', 'staging')
}

export function getStagingHandoffDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'staging', name)
}

export function getWorkerInboxDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name, 'inbox')
}

// A delivered parcel sits directly in the inbox, named by sender + contents.
export function getWorkerInboxParcelDir(
  repoRoot: string,
  workerName: string,
  parcelName: string,
): string {
  return join(repoRoot, '.quimby', 'workers', workerName, 'inbox', parcelName)
}

// Where a worker moves parcels it has processed.
export function getWorkerInboxDoneDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name, 'inbox', '.done')
}

export function getWorkerInboxStatusDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name, 'inbox', 'status')
}

export function getWorkerOutboxDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name, 'outbox')
}

// A staged parcel awaiting pickup, addressed by recipient.
export function getWorkerOutboxDraftDir(
  repoRoot: string,
  workerName: string,
  recipient: string,
): string {
  return join(repoRoot, '.quimby', 'workers', workerName, 'outbox', recipient)
}

// The delivery ledger: parcels already carried, moved aside on success.
export function getWorkerOutboxSentDir(repoRoot: string, name: string): string {
  return join(repoRoot, '.quimby', 'workers', name, 'outbox', '.sent')
}

export function getWorkerOutboxSentDraftDir(
  repoRoot: string,
  workerName: string,
  recipient: string,
): string {
  return join(repoRoot, '.quimby', 'workers', workerName, 'outbox', '.sent', recipient)
}

// ── Remote paths (SSH workers) ────────────────────────────────────────────────
// Paths use ~ which the remote shell expands; never use these in local fs ops.

export function remoteProjectRoot(projectId: string, base?: string): string {
  return base ?? `~/.quimby/workspaces/${projectId}`
}

export function remoteQuimbyDir(projectId: string, base?: string): string {
  return `${remoteProjectRoot(projectId, base)}/.quimby`
}

export function remoteWorkerDir(projectId: string, name: string, base?: string): string {
  return `${remoteQuimbyDir(projectId, base)}/workers/${name}`
}

export function remoteWorkerRepoDir(projectId: string, name: string, base?: string): string {
  return `${remoteWorkerDir(projectId, name, base)}/repo`
}

// ── Stable identifiers ────────────────────────────────────────────────────────

/** tmux session name derived from stable IDs — unaffected by quimby rename. */
export function tmuxSessionName(projectId: string, workerId: string): string {
  return `qb-${projectId.slice(0, 8)}-${workerId.slice(0, 8)}`
}
