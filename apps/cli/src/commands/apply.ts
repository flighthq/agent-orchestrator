import { ConflictError, QuimbyError } from '@quimbyhq/errors'
import { applyHandoff, type ApplyMode, discardHandoff, readHandoff } from '@quimbyhq/handoff'
import { getStagingHandoffDir } from '@quimbyhq/paths'
import { logger } from '@quimbyhq/utils'
import { resolveWorkspace } from '@quimbyhq/workspace'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'

import { stageParcel } from '../courier'
import { getQuimbySuccessQuip } from '../quips'

export default defineCommand({
  meta: {
    name: 'apply',
    description: "Package a worker's work and apply it to your repository",
  },
  args: {
    worker: {
      type: 'positional',
      description: 'Worker to apply (or a staged parcel left by a prior conflict)',
      required: true,
    },
    commits: {
      type: 'boolean',
      description: 'Replay individual commits instead of squashing',
      default: false,
    },
    patch: {
      type: 'boolean',
      description: 'Apply as working tree changes without committing',
      default: false,
    },
    '3way': {
      type: 'boolean',
      description:
        'Use 3-way merge when applying — leaves conflict markers on overlap instead of aborting',
      default: false,
    },
    branch: {
      type: 'string',
      alias: 'b',
      description: 'Create a branch before applying (default name: quimby/<worker>-<sha>)',
    },
    target: {
      type: 'string',
      alias: 't',
      description: 'Target repo path (defaults to current directory)',
    },
    message: {
      type: 'string',
      alias: 'm',
      description: 'Commit message for uncommitted work + suggested apply message',
    },
    rebase: {
      type: 'boolean',
      description: 'Rebase the worker onto host HEAD before applying',
      default: false,
    },
    'skip-check': {
      type: 'boolean',
      description: "Skip the worker's configured verification command",
      default: false,
    },
  },
  run: runApplyCommand,
})

export async function runApplyCommand({
  args,
}: {
  args: {
    worker: string
    commits: boolean
    patch: boolean
    '3way': boolean
    branch?: string
    target?: string
    message?: string
    rebase: boolean
    'skip-check': boolean
  }
}) {
  const { state, repoRoot } = await resolveWorkspace()

  if (args.commits && args.patch) {
    throw new QuimbyError('Cannot use --commits and --patch together')
  }

  const mode: ApplyMode = args.commits ? 'commits' : args.patch ? 'patch' : 'squashed'
  const threeWay = args['3way']
  const targetRepoPath = resolve(args.target ?? process.cwd())
  const branch: boolean | string | undefined =
    args.branch !== undefined ? (args.branch === '' ? true : args.branch) : undefined

  // A worker name stages fresh work (committing the dirty tree — apply ships
  // everything across the membrane); anything else is a parcel already staged
  // in `.quimby/staging/` (e.g. one a prior conflict left behind).
  const isWorker = Boolean(state.workers[args.worker])
  const name = isWorker
    ? (
        await stageParcel({
          state,
          repoRoot,
          from: args.worker,
          message: args.message,
          commitDirty: true,
          skipCheck: args['skip-check'],
          rebase: args.rebase,
        })
      ).name
    : args.worker

  const { meta } = await readHandoff(repoRoot, name)

  logger.start(`Applying "${name}" (${mode} mode${threeWay ? ', 3-way merge' : ''})`)

  try {
    await applyHandoff({ repoRoot, name, targetRepoPath, mode, branch, threeWay })
  } catch (err) {
    if (err instanceof ConflictError) {
      logger.warn(`${err.message}`)
      logger.info('Conflicted files:')
      for (const f of err.conflicts) {
        logger.info(`  ${f}`)
      }
      // Keep the staged parcel so the user can finish the apply by hand.
      logger.info(`Parcel kept at: ${getStagingHandoffDir(repoRoot, name)}`)
      logger.info('Resolve the conflicts, then run:')
      if (mode === 'commits') {
        logger.info('  git add -A && git am --continue   (or: git am --abort to bail out)')
      } else {
        logger.info(`  git add -A && git commit -m ${JSON.stringify(meta.suggestedMessage)}`)
      }
      process.exit(1)
    }
    throw err
  }

  // Parcels are ephemeral: once the work has crossed into git, drop the bundle.
  await discardHandoff(repoRoot, name)

  logger.success(`Applied "${name}"`)
  if (mode === 'patch') {
    logger.info(`Changes in working tree — no commit created. Suggested message:`)
    logger.info(`  ${meta.suggestedMessage}`)
  }
  logger.info(`Resync other workers when ready: quimby advance --all`)
  logger.log(colors.dim(getQuimbySuccessQuip()))
}
