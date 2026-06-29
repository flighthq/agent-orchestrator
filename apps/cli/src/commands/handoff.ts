import { QuimbyError } from '@quimbyhq/errors'
import {
  deliverHandoff,
  discardHandoff,
  markHandoffSent,
  readOutboxDraft,
  readOutboxRecipients,
} from '@quimbyhq/handoff'
import { getStagingHandoffDir } from '@quimbyhq/paths'
import type { QuimbyState } from '@quimbyhq/types'
import { cp, ensureDir, logger } from '@quimbyhq/utils'
import { resolveWorkspace } from '@quimbyhq/workspace'
import { defineCommand } from 'citty'
import { join, resolve } from 'pathe'

import { stageParcel } from '../courier'

export default defineCommand({
  meta: {
    name: 'handoff',
    description: "Carry a worker's work to another worker (or its whole outbox, or a directory)",
  },
  args: {
    from: {
      type: 'positional',
      description: 'Source worker (the sender)',
      required: true,
    },
    to: {
      type: 'positional',
      description: 'Recipient worker; omit to deliver the whole outbox',
      required: false,
    },
    message: {
      type: 'string',
      alias: 'm',
      description: "The parcel's note (overrides an outbox draft's note)",
    },
    attach: {
      type: 'string',
      description: "Carry a different worker's diff than <from>",
    },
    out: {
      type: 'string',
      description: 'Export the parcel to a directory instead of a worker inbox',
    },
    rebase: {
      type: 'boolean',
      description: 'Rebase the code source onto host HEAD before packaging',
      default: false,
    },
    'skip-check': {
      type: 'boolean',
      description: "Skip the code source's configured verification command",
      default: false,
    },
  },
  run: runHandoffCommand,
})

export async function runHandoffCommand({
  args,
}: {
  args: {
    from: string
    to?: string
    message?: string
    attach?: string
    out?: string
    rebase: boolean
    'skip-check': boolean
  }
}) {
  const { state, repoRoot } = await resolveWorkspace()

  if (!state.workers[args.from]) {
    throw new QuimbyError(`Worker "${args.from}" not found`)
  }

  // Export: assemble the parcel and write it to a directory, then forget it.
  if (args.out) {
    const meta = await stageParcel({
      state,
      repoRoot,
      from: args.from,
      note: args.message,
      attach: args.attach,
      skipCheck: args['skip-check'],
      rebase: args.rebase,
    })
    const dest = resolve(join(args.out, meta.name))
    await ensureDir(dest)
    await cp(getStagingHandoffDir(repoRoot, meta.name), dest, { recursive: true })
    await discardHandoff(repoRoot, meta.name)
    logger.success(`Exported "${meta.name}" → ${dest}`)
    return
  }

  // Fan-out: no recipient named — carry every queued outbox parcel to its addressee.
  if (!args.to) {
    const recipients = await readOutboxRecipients(repoRoot, args.from)
    if (recipients.length === 0) {
      logger.info(`Worker "${args.from}" has no queued handoffs.`)
      return
    }
    for (const recipient of recipients) {
      if (!state.workers[recipient]) {
        logger.warn(`Skipping "${recipient}" — no such worker (left in outbox to fix)`)
        continue
      }
      try {
        const draft = await readOutboxDraft(repoRoot, args.from, recipient)
        await carry(state, repoRoot, {
          from: args.from,
          to: recipient,
          note: draft.note || undefined,
          attach: draft.attach,
          rebase: args.rebase,
          skipCheck: args['skip-check'],
        })
        await markHandoffSent(repoRoot, args.from, recipient)
        logger.success(`Delivered to "${recipient}"`)
      } catch (err) {
        logger.warn(
          `Failed to deliver to "${recipient}" (left in outbox): ${err instanceof Error ? err.message : err}`,
        )
      }
    }
    return
  }

  // Direct 1:1 delivery. Bounce an unknown recipient before doing any work.
  if (!state.workers[args.to]) {
    throw new QuimbyError(`Worker "${args.to}" not found`)
  }

  const queued = (await readOutboxRecipients(repoRoot, args.from)).includes(args.to)
  const draft = queued ? await readOutboxDraft(repoRoot, args.from, args.to) : { note: '' }

  await carry(state, repoRoot, {
    from: args.from,
    to: args.to,
    note: (args.message ?? draft.note) || undefined,
    attach: args.attach ?? draft.attach,
    rebase: args.rebase,
    skipCheck: args['skip-check'],
  })
  if (queued) await markHandoffSent(repoRoot, args.from, args.to)

  logger.success(`Handed off from "${args.from}" to "${args.to}"`)
}

async function carry(
  state: Readonly<QuimbyState>,
  repoRoot: string,
  opts: {
    from: string
    to: string
    note?: string
    attach?: string
    rebase: boolean
    skipCheck: boolean
  },
): Promise<void> {
  const meta = await stageParcel({
    state,
    repoRoot,
    from: opts.from,
    to: opts.to,
    note: opts.note,
    attach: opts.attach,
    skipCheck: opts.skipCheck,
    rebase: opts.rebase,
  })
  await deliverHandoff({
    repoRoot,
    name: meta.name,
    to: opts.to,
    toLocation: state.workers[opts.to].location,
    projectId: state.id,
  })
  await discardHandoff(repoRoot, meta.name)
}
