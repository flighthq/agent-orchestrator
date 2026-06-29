import { QuimbyError } from '@quimbyhq/errors'
import * as git from '@quimbyhq/git'
import { assembleHandoff, assembleRemoteHandoff } from '@quimbyhq/handoff'
import { getWorkerRepoDir, remoteWorkerRepoDir } from '@quimbyhq/paths'
import { getSSHTransport, sq } from '@quimbyhq/transport'
import type { HandoffMeta, QuimbyState } from '@quimbyhq/types'
import { isSSH } from '@quimbyhq/types'
import { logger } from '@quimbyhq/utils'
import { advanceWorker } from '@quimbyhq/worker'
import { execa } from 'execa'

/**
 * Stage a parcel in the host loading dock from a code source's work and/or a note.
 *
 * Shared by `apply` (membrane) and `handoff` (peer delivery). The diff comes from the
 * `attach` worker if given, else `from`. `commitDirty` is for `apply`, which ships
 * everything across the membrane; `handoff` leaves it off and carries only committed
 * work, so a reviewer's incidental scratch never rides along with a note. The check
 * runs only when the parcel actually carries code. The caller consumes the staged
 * parcel and is responsible for discarding it.
 */
export async function stageParcel(opts: {
  state: Readonly<QuimbyState>
  repoRoot: string
  from: string
  to?: string
  note?: string
  attach?: string
  message?: string
  commitDirty?: boolean
  skipCheck?: boolean
  rebase?: boolean
  name?: string
}): Promise<HandoffMeta> {
  const { state, repoRoot, from } = opts

  if (!state.workers[from]) {
    throw new QuimbyError(`Worker "${from}" not found`)
  }
  const codeSourceName = opts.attach ?? from
  const codeSource = state.workers[codeSourceName]
  if (!codeSource) {
    throw new QuimbyError(`Worker "${codeSourceName}" not found`)
  }

  if (isSSH(codeSource.location)) {
    const transport = getSSHTransport(codeSource.location)
    const rRepoDir = remoteWorkerRepoDir(state.id, codeSourceName, codeSource.location.base)

    if (opts.commitDirty) {
      const dirty = (await transport.exec(`git status --porcelain`, { cwd: rRepoDir })).trim()
      if (dirty) {
        const message = opts.message ?? `Work by ${codeSourceName}`
        await transport.exec(`git add -A && git commit -m ${sq(message)}`, { cwd: rRepoDir })
        logger.info(`Committed working tree on "${codeSourceName}"`)
      }
    }

    if (opts.rebase) await rebaseOntoHead(repoRoot, codeSourceName)

    const hasCode =
      (await transport.exec(`git log quimby/seed..HEAD --format=%s`, { cwd: rRepoDir })).trim()
        .length > 0
    if (hasCode && codeSource.check && !opts.skipCheck) {
      await runRemoteCheck(transport, rRepoDir, codeSourceName, codeSource.check)
    }

    return assembleRemoteHandoff({
      repoRoot,
      from,
      codeSource: codeSourceName,
      codeSourceLocation: codeSource.location,
      projectId: state.id,
      to: opts.to,
      note: opts.note,
      suggestedMessage: opts.message,
      name: opts.name,
    })
  }

  const repoDir = getWorkerRepoDir(repoRoot, codeSourceName)

  if (opts.commitDirty && !(await git.isClean(repoDir))) {
    await git.addAll(repoDir)
    await git.commit(repoDir, opts.message ?? `Work by ${codeSourceName}`)
    logger.info(`Committed working tree on "${codeSourceName}"`)
  }

  if (opts.rebase) await rebaseOntoHead(repoRoot, codeSourceName)

  const hasCode =
    (await git.log(repoDir, 'quimby/seed..HEAD', '%s')).split('\n').filter(Boolean).length > 0
  if (hasCode && codeSource.check && !opts.skipCheck) {
    logger.start(`Running check on "${codeSourceName}": ${codeSource.check}`)
    try {
      await execa(codeSource.check, { cwd: repoDir, stdio: 'inherit', shell: true })
    } catch {
      throw new QuimbyError(
        `Check failed for "${codeSourceName}" — fix it and retry (or pass --skip-check)`,
      )
    }
    logger.success('Check passed')
  }

  return assembleHandoff({
    repoRoot,
    from,
    codeSource: codeSourceName,
    to: opts.to,
    note: opts.note,
    suggestedMessage: opts.message,
    name: opts.name,
  })
}

async function rebaseOntoHead(repoRoot: string, workerName: string): Promise<void> {
  logger.start(`Rebasing "${workerName}" onto host HEAD`)
  const result = await advanceWorker(repoRoot, workerName)
  if (result.rebased) {
    logger.success(`Rebased ${result.commitsReplayed} commit(s) onto ${result.newSeed.slice(0, 8)}`)
  } else {
    logger.info(`Already based on host HEAD (${result.newSeed.slice(0, 8)})`)
  }
}

async function runRemoteCheck(
  transport: ReturnType<typeof getSSHTransport>,
  rRepoDir: string,
  workerName: string,
  check: string,
): Promise<void> {
  logger.start(`Running check on "${workerName}": ${check}`)
  try {
    await transport.runInteractive('bash', ['-lc', sq(check)], rRepoDir)
  } catch {
    throw new QuimbyError(
      `Check failed for "${workerName}" — fix it and retry (or pass --skip-check)`,
    )
  }
  logger.success('Check passed')
}
