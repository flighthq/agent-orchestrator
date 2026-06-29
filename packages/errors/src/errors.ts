export class QuimbyError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'QuimbyError'
  }
}

export class GitError extends QuimbyError {
  constructor(
    message: string,
    public stderr?: string,
  ) {
    super(message, 'GIT_ERROR')
    this.name = 'GitError'
  }
}

export class WorkerError extends QuimbyError {
  constructor(
    message: string,
    public workerName?: string,
  ) {
    super(message, 'WORKER_ERROR')
    this.name = 'WorkerError'
  }
}

export class HandoffError extends QuimbyError {
  constructor(
    message: string,
    public handoffName?: string,
  ) {
    super(message, 'HANDOFF_ERROR')
    this.name = 'HandoffError'
  }
}

export class ConflictError extends QuimbyError {
  constructor(
    message: string,
    public conflicts: string[],
  ) {
    super(message, 'CONFLICT')
    this.name = 'ConflictError'
  }
}
