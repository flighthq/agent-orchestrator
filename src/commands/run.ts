import { defineCommand } from 'citty'
import { execa } from 'execa'

import { resolveWorkspace } from '../core/workspace.js'
import { buildContext, getRuntime, runtimeTypes } from '../runtimes/index.js'
import type { RuntimeType } from '../types/runtime.js'
import { QuimbyError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

export default defineCommand({
  meta: {
    name: 'run',
    description: 'Launch an agent interactively in a worker',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Worker name',
      required: true,
    },
    agent: {
      type: 'string',
      alias: 'a',
      description: 'Agent override for this run',
    },
    runtime: {
      type: 'string',
      alias: 'r',
      description: `Runtime override for this run (${runtimeTypes.join(', ')})`,
    },
  },
  async run({ args }) {
    const { state, repoRoot } = await resolveWorkspace()

    const worker = state.workers[args.name]
    if (!worker) {
      throw new QuimbyError(`Worker "${args.name}" not found`)
    }

    const saved = worker.defaults
    const runtime =
      (args.runtime as RuntimeType | undefined) ?? (saved?.runtime as RuntimeType) ?? 'local'
    const agentCmd = args.agent ?? saved?.agent ?? 'claude'

    if (!runtimeTypes.includes(runtime)) {
      throw new QuimbyError(`Unknown runtime "${runtime}". Available: ${runtimeTypes.join(', ')}`)
    }

    const adapter = getRuntime(runtime)
    const ctx = buildContext(repoRoot, args.name)
    const spec = await adapter.runSpec(ctx, agentCmd)

    const runtimeLabel = runtime !== 'local' ? ` [${runtime}]` : ''
    logger.start(`Running "${agentCmd}" in worker "${args.name}"${runtimeLabel}`)

    try {
      await execa(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: 'inherit',
      })
    } catch (err) {
      const e = err as { exitCode?: number }
      if (e.exitCode !== undefined && e.exitCode !== 0) {
        process.exit(e.exitCode)
      }
    }
  },
})
