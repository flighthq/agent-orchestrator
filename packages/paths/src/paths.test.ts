import { describe, expect, it } from 'vitest'

import {
  getQuimbyDir,
  getStagingDir,
  getStagingHandoffDir,
  getStatePath,
  getWorkerDir,
  getWorkerInboxDir,
  getWorkerInboxDoneDir,
  getWorkerInboxParcelDir,
  getWorkerInboxStatusDir,
  getWorkerOutboxDir,
  getWorkerOutboxDraftDir,
  getWorkerOutboxSentDir,
  getWorkerOutboxSentDraftDir,
  getWorkerRepoDir,
  getWorkersDir,
  remoteProjectRoot,
  remoteQuimbyDir,
  remoteWorkerDir,
  remoteWorkerRepoDir,
  tmuxSessionName,
} from './paths'

describe('getQuimbyDir', () => {
  it('returns .quimby under repo root', () => {
    expect(getQuimbyDir('/foo/bar')).toBe('/foo/bar/.quimby')
  })
})

describe('getStagingDir', () => {
  it('returns the staging dir under .quimby', () => {
    expect(getStagingDir('/root')).toBe('/root/.quimby/staging')
  })
})

describe('getStagingHandoffDir', () => {
  it('returns a staged parcel dir by name', () => {
    expect(getStagingHandoffDir('/root', 'alice-a1b2c3d4')).toBe(
      '/root/.quimby/staging/alice-a1b2c3d4',
    )
  })
})

describe('getStatePath', () => {
  it('returns state.yaml path', () => {
    expect(getStatePath('/root')).toBe('/root/.quimby/state.yaml')
  })
})

describe('getWorkerDir', () => {
  it('returns worker dir by name', () => {
    expect(getWorkerDir('/root', 'alice')).toBe('/root/.quimby/workers/alice')
  })
})

describe('getWorkerInboxDir', () => {
  it('returns inbox dir under worker dir', () => {
    expect(getWorkerInboxDir('/root', 'alice')).toBe('/root/.quimby/workers/alice/inbox')
  })
})

describe('getWorkerInboxDoneDir', () => {
  it('returns the processed-parcels dir under inbox', () => {
    expect(getWorkerInboxDoneDir('/root', 'alice')).toBe('/root/.quimby/workers/alice/inbox/.done')
  })
})

describe('getWorkerInboxParcelDir', () => {
  it('returns a delivered parcel dir directly under inbox', () => {
    expect(getWorkerInboxParcelDir('/root', 'alice', 'bob-a1b2c3d4')).toBe(
      '/root/.quimby/workers/alice/inbox/bob-a1b2c3d4',
    )
  })
})

describe('getWorkerInboxStatusDir', () => {
  it('returns inbox status dir under worker dir', () => {
    expect(getWorkerInboxStatusDir('/root', 'alice')).toBe(
      '/root/.quimby/workers/alice/inbox/status',
    )
  })
})

describe('getWorkerOutboxDir', () => {
  it('returns outbox dir under worker dir', () => {
    expect(getWorkerOutboxDir('/root', 'alice')).toBe('/root/.quimby/workers/alice/outbox')
  })
})

describe('getWorkerOutboxDraftDir', () => {
  it('returns a staged outbox parcel addressed by recipient', () => {
    expect(getWorkerOutboxDraftDir('/root', 'alice', 'bob')).toBe(
      '/root/.quimby/workers/alice/outbox/bob',
    )
  })
})

describe('getWorkerOutboxSentDir', () => {
  it('returns the delivery ledger dir under outbox', () => {
    expect(getWorkerOutboxSentDir('/root', 'alice')).toBe(
      '/root/.quimby/workers/alice/outbox/.sent',
    )
  })
})

describe('getWorkerOutboxSentDraftDir', () => {
  it('returns a delivered parcel in the ledger by recipient', () => {
    expect(getWorkerOutboxSentDraftDir('/root', 'alice', 'bob')).toBe(
      '/root/.quimby/workers/alice/outbox/.sent/bob',
    )
  })
})

describe('getWorkerRepoDir', () => {
  it('returns repo subdir of the worker dir', () => {
    expect(getWorkerRepoDir('/root', 'bob')).toBe('/root/.quimby/workers/bob/repo')
  })
})

describe('getWorkersDir', () => {
  it('returns workers dir under .quimby', () => {
    expect(getWorkersDir('/root')).toBe('/root/.quimby/workers')
  })
})

describe('remoteProjectRoot', () => {
  it('returns default path when no base provided', () => {
    expect(remoteProjectRoot('proj-id')).toBe('~/.quimby/workspaces/proj-id')
  })

  it('uses base override when provided', () => {
    expect(remoteProjectRoot('proj-id', '/custom/path')).toBe('/custom/path')
  })
})

describe('remoteQuimbyDir', () => {
  it('returns .quimby under remote project root', () => {
    expect(remoteQuimbyDir('proj-id')).toBe('~/.quimby/workspaces/proj-id/.quimby')
  })

  it('uses base override', () => {
    expect(remoteQuimbyDir('proj-id', '/base')).toBe('/base/.quimby')
  })
})

describe('remoteWorkerDir', () => {
  it('returns remote worker dir with worker name', () => {
    expect(remoteWorkerDir('proj-id', 'alice')).toBe(
      '~/.quimby/workspaces/proj-id/.quimby/workers/alice',
    )
  })

  it('uses base override', () => {
    expect(remoteWorkerDir('proj-id', 'alice', '/base')).toBe('/base/.quimby/workers/alice')
  })
})

describe('remoteWorkerRepoDir', () => {
  it('returns repo subdir of remote worker dir', () => {
    expect(remoteWorkerRepoDir('proj-id', 'alice')).toBe(
      '~/.quimby/workspaces/proj-id/.quimby/workers/alice/repo',
    )
  })

  it('uses base override', () => {
    expect(remoteWorkerRepoDir('proj-id', 'alice', '/base')).toBe(
      '/base/.quimby/workers/alice/repo',
    )
  })
})

describe('tmuxSessionName', () => {
  it('returns qb-<first8>-<first8> format', () => {
    const projectId = 'abcdef12-1234-5678-9abc-def012345678'
    const workerId = '98765432-abcd-ef01-2345-6789abcdef01'
    expect(tmuxSessionName(projectId, workerId)).toBe('qb-abcdef12-98765432')
  })

  it('truncates UUIDs to 8 characters', () => {
    const result = tmuxSessionName('aabbccdd-xxxx', 'eeffgghh-yyyy')
    expect(result).toBe('qb-aabbccdd-eeffgghh')
  })
})
