import { QuimbyError } from '@quimbyhq/errors'
import { quimbyTmuxSocket } from '@quimbyhq/paths'
import { buildContext, getRuntime, runtimeTypes } from '@quimbyhq/runtimes'
import { sq } from '@quimbyhq/transport'
import type { RuntimeType } from '@quimbyhq/types'
import { isSSH } from '@quimbyhq/types'
import { logger } from '@quimbyhq/utils'
import { resolveWorkspace } from '@quimbyhq/workspace'
import { defineCommand } from 'citty'
import { execa } from 'execa'

import { prepareLocalTmuxLaunch, prepareSshLaunch } from '../launch'

export default defineCommand({
  meta: {
    name: 'run',
    description: 'Launch an agent interactively',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Agent name',
      required: true,
    },
    cmd: {
      type: 'string',
      alias: 'c',
      description: 'Entrypoint command to launch for this run (overrides the agent default)',
    },
    runtime: {
      type: 'string',
      alias: 'r',
      description: `Runtime override for this run (${runtimeTypes.join(', ')})`,
    },
  },
  run: runRunCommand,
})

export async function runRunCommand({
  args,
}: {
  args: { name: string; cmd?: string; runtime?: string }
}) {
  const { state, repoRoot } = await resolveWorkspace()

  const agent = state.agents[args.name]
  if (!agent) {
    throw new QuimbyError(`Agent "${args.name}" not found`)
  }

  // ── SSH agent ──────────────────────────────────────────────────────────────
  if (isSSH(agent.location)) {
    const launch = await prepareSshLaunch({
      state,
      repoRoot,
      agent,
      location: agent.location,
      cmd: args.cmd,
      runtime: args.runtime,
    })

    logger.success(
      `Attaching to tmux session "${launch.sessionName}" on ${launch.host}${launch.runtimeLabel}`,
    )
    // CWD is the agent dir (parent of repo/) so the agent sees assignment.md, inbox/,
    // etc. tmux -A attaches to an existing session or creates a new one; bash -l is a
    // login shell so PATH includes user-installed tools like claude / sbx.
    await launch.transport.runInteractive('tmux', [
      '-L',
      quimbyTmuxSocket,
      '-f',
      launch.tmuxConf,
      'new-session',
      '-A',
      '-s',
      launch.sessionName,
      '-n',
      launch.windowName,
      '-c',
      launch.cwd, // unquoted so the remote shell expands ~
      'bash',
      '-l',
      '-c',
      sq(launch.shellCmd),
    ])
    return
  }

  // ── Local agent, opted into tmux ─────────────────────────────────────────────
  if (agent.tmux) {
    const launch = await prepareLocalTmuxLaunch({
      state,
      repoRoot,
      agent,
      cmd: args.cmd,
      runtime: args.runtime,
    })

    logger.success(`Attaching to tmux session "${launch.sessionName}"${launch.runtimeLabel}`)
    try {
      await execa(
        'tmux',
        [
          '-L',
          quimbyTmuxSocket,
          '-f',
          launch.tmuxConf,
          'new-session',
          '-A',
          '-s',
          launch.sessionName,
          '-n',
          launch.windowName,
          '-c',
          launch.cwd,
          ...launch.envArgs,
          'bash',
          '-l',
          '-c',
          launch.shellCmd,
        ],
        { stdio: 'inherit' },
      )
    } catch (err) {
      const e = err as { exitCode?: number }
      if (e.exitCode !== undefined && e.exitCode !== 0) {
        process.exit(e.exitCode)
      }
    }
    return
  }

  // ── Local agent, foreground ──────────────────────────────────────────────────
  const saved = agent.defaults
  const runtime =
    (args.runtime as RuntimeType | undefined) ?? (saved?.runtime as RuntimeType) ?? 'local'
  const entrypoint = args.cmd ?? saved?.entrypoint ?? 'claude'

  if (!runtimeTypes.includes(runtime)) {
    throw new QuimbyError(`Unknown runtime "${runtime}". Available: ${runtimeTypes.join(', ')}`)
  }

  const adapter = getRuntime(runtime)
  const ctx = buildContext(repoRoot, args.name, state.id, agent.id)
  const spec = await adapter.runSpec(ctx, entrypoint)
  const runtimeLabel = runtime !== 'local' ? ` [${runtime}]` : ''

  logger.start(`Running "${entrypoint}" in agent "${args.name}"${runtimeLabel}`)

  try {
    await execa(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: 'inherit' })
  } catch (err) {
    const e = err as { exitCode?: number }
    if (e.exitCode !== undefined && e.exitCode !== 0) {
      process.exit(e.exitCode)
    }
  }
}
