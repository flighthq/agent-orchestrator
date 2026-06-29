import { describe, expect, it } from 'vitest'

import { GitError, HandoffError, QuimbyError, WorkerError } from './errors'

describe('GitError', () => {
  it('is instanceof QuimbyError and Error', () => {
    const err = new GitError('git failed')
    expect(err instanceof QuimbyError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it('sets name to GitError', () => {
    const err = new GitError('git failed')
    expect(err.name).toBe('GitError')
  })

  it('sets message correctly', () => {
    const err = new GitError('git clone failed')
    expect(err.message).toBe('git clone failed')
  })

  it('sets code to GIT_ERROR', () => {
    const err = new GitError('test')
    expect(err.code).toBe('GIT_ERROR')
  })

  it('sets optional stderr', () => {
    const err = new GitError('git failed', 'fatal: not a git repo')
    expect(err.stderr).toBe('fatal: not a git repo')
  })

  it('stderr is undefined when not provided', () => {
    const err = new GitError('git failed')
    expect(err.stderr).toBeUndefined()
  })
})

describe('HandoffError', () => {
  it('is instanceof QuimbyError and Error', () => {
    const err = new HandoffError('handoff not found')
    expect(err instanceof QuimbyError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it('sets name to HandoffError', () => {
    const err = new HandoffError('handoff not found')
    expect(err.name).toBe('HandoffError')
  })

  it('sets message correctly', () => {
    const err = new HandoffError('Handoff "alice-a1b2c3d4" not found')
    expect(err.message).toBe('Handoff "alice-a1b2c3d4" not found')
  })

  it('sets code to HANDOFF_ERROR', () => {
    const err = new HandoffError('test')
    expect(err.code).toBe('HANDOFF_ERROR')
  })

  it('sets optional handoffName', () => {
    const err = new HandoffError('not found', 'alice-a1b2c3d4')
    expect(err.handoffName).toBe('alice-a1b2c3d4')
  })

  it('handoffName is undefined when not provided', () => {
    const err = new HandoffError('not found')
    expect(err.handoffName).toBeUndefined()
  })
})

describe('QuimbyError', () => {
  it('sets message correctly', () => {
    const err = new QuimbyError('something went wrong')
    expect(err.message).toBe('something went wrong')
  })

  it('sets name to QuimbyError', () => {
    const err = new QuimbyError('test')
    expect(err.name).toBe('QuimbyError')
  })

  it('is an instance of Error', () => {
    const err = new QuimbyError('test')
    expect(err instanceof Error).toBe(true)
  })

  it('sets optional code', () => {
    const err = new QuimbyError('test', 'MY_CODE')
    expect(err.code).toBe('MY_CODE')
  })

  it('code is undefined when not provided', () => {
    const err = new QuimbyError('test')
    expect(err.code).toBeUndefined()
  })
})

describe('WorkerError', () => {
  it('is instanceof QuimbyError and Error', () => {
    const err = new WorkerError('worker not found')
    expect(err instanceof QuimbyError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it('sets name to WorkerError', () => {
    const err = new WorkerError('worker not found')
    expect(err.name).toBe('WorkerError')
  })

  it('sets message correctly', () => {
    const err = new WorkerError('Worker "alice" not found')
    expect(err.message).toBe('Worker "alice" not found')
  })

  it('sets code to WORKER_ERROR', () => {
    const err = new WorkerError('test')
    expect(err.code).toBe('WORKER_ERROR')
  })

  it('sets optional workerName', () => {
    const err = new WorkerError('not found', 'alice')
    expect(err.workerName).toBe('alice')
  })

  it('workerName is undefined when not provided', () => {
    const err = new WorkerError('not found')
    expect(err.workerName).toBeUndefined()
  })
})
