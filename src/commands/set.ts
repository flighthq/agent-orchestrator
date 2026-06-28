import { defineCommand } from 'citty'

import { setWorkerDefaults } from '../core/worker.js'
import { resolveWorkspace } from '../core/workspace.js'
import { runtimeTypes } from '../runtimes/index.js'
import type { RuntimeType } from '../types/runtime.js'
import { QuimbyError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

export default defineCommand({
  meta: {
    name: 'set',
    description: 'Update worker defaults',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Worker name',
      required: true,
    },
    runtime: {
      type: 'string',
      alias: 'r',
      description: `Runtime environment (${runtimeTypes.join(', ')})`,
    },
    agent: {
      type: 'string',
      alias: 'a',
      description: 'Agent to run (e.g. claude, codex)',
    },
  },
  async run({ args }) {
    if (!args.runtime && !args.agent) {
      throw new QuimbyError('Specify at least one of --runtime or --agent')
    }

    const { state, repoRoot } = await resolveWorkspace()

    if (!state.workers[args.name]) {
      throw new QuimbyError(`Worker "${args.name}" not found`)
    }

    if (args.runtime && !runtimeTypes.includes(args.runtime as RuntimeType)) {
      throw new QuimbyError(
        `Unknown runtime "${args.runtime}". Available: ${runtimeTypes.join(', ')}`,
      )
    }

    const updates: { runtime?: string; agent?: string } = {}
    if (args.runtime) updates.runtime = args.runtime
    if (args.agent) updates.agent = args.agent

    await setWorkerDefaults(repoRoot, args.name, updates)
    logger.success(`Worker "${args.name}" updated`)
  },
})
