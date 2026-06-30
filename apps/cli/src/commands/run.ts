import { configureRemoteAgentIdentity } from '@quimbyhq/agent'
import { QuimbyError } from '@quimbyhq/errors'
import {
  getTmuxConfigPath,
  quimbyTmuxSocket,
  remoteAgentDir,
  remoteAgentRepoDir,
  remoteProjectRoot,
  remoteTmuxConfigPath,
  tmuxSessionName,
} from '@quimbyhq/paths'
import { buildContext, getRuntime, runtimeTypes } from '@quimbyhq/runtimes'
import { renderAgentClaudeMd, renderTmuxConfig } from '@quimbyhq/template'
import { getSSHTransport, sq } from '@quimbyhq/transport'
import type { RuntimeType } from '@quimbyhq/types'
import { isSSH } from '@quimbyhq/types'
import { logger, writeText } from '@quimbyhq/utils'
import { resolveWorkspace, saveState } from '@quimbyhq/workspace'
import { defineCommand } from 'citty'
import { execa } from 'execa'

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
    const loc = agent.location
    const transport = getSSHTransport(loc)
    const rRoot = remoteProjectRoot(state.id, loc.base)
    const rAgentDir = remoteAgentDir(state.id, agent.id, loc.base)
    const rRepoDir = remoteAgentRepoDir(state.id, agent.id, loc.base)

    logger.start(`Syncing project to ${loc.host}...`)
    await transport.syncProjectTo(repoRoot, rRoot)

    // One-time migration of a remote agent dir from the legacy name-keyed layout to
    // the UUID-keyed one, so an existing remote agent's work isn't re-cloned away.
    const rLegacyAgentDir = remoteAgentDir(state.id, args.name, loc.base)
    if (rLegacyAgentDir !== rAgentDir) {
      await transport.exec(
        `if [ -d ${rLegacyAgentDir} ] && [ ! -d ${rAgentDir} ]; then mkdir -p "$(dirname ${rAgentDir})" && mv ${rLegacyAgentDir} ${rAgentDir}; fi`,
      )
    }

    // Lazy remote init: set up agent dirs and clone if this is the first run.
    const repoReady = await transport.fileExists(`${rRepoDir}/.git`)
    if (!repoReady) {
      await transport.checkCapabilities(['git', 'rsync', 'tmux'])
      logger.start('Initializing remote agent...')
      await transport.ensureDir(`${rAgentDir}/inbox/status`)
      await transport.ensureDir(`${rAgentDir}/outbox`)
      await transport.exec(`git clone ${rRoot} ${rRepoDir}`)
      await transport.exec(`git tag quimby/seed`, { cwd: rRepoDir })
      await configureRemoteAgentIdentity(transport, rRepoDir, args.name, repoRoot)
      const seedCommit = (await transport.exec(`git rev-parse HEAD`, { cwd: rRepoDir })).trim()
      await transport.writeFile(`${rAgentDir}/assignment.md`, '')
      await transport.writeFile(`${rAgentDir}/status.md`, 'idle')
      const claudeMd = renderAgentClaudeMd({ agentName: args.name, agentId: agent.id })
      await transport.writeFile(`${rAgentDir}/CLAUDE.md`, claudeMd)

      state.agents[args.name].seedCommit = seedCommit
      await saveState(repoRoot, state)
      logger.success('Remote agent initialized')
    }

    const runtime =
      (args.runtime as RuntimeType | undefined) ??
      (agent.defaults?.runtime as RuntimeType | undefined) ??
      'local'
    const entrypoint = args.cmd ?? agent.defaults?.entrypoint ?? 'claude'

    if (!runtimeTypes.includes(runtime)) {
      throw new QuimbyError(`Unknown runtime "${runtime}". Available: ${runtimeTypes.join(', ')}`)
    }

    // Build the shell command for the remote machine using the runtime adapter.
    // For sbx: 'sbx run claude', for openshell: 'openshell sandbox create -- claude', etc.
    // cwd is handled by tmux -c, so we pass remote paths but don't use spec.cwd.
    const adapter = getRuntime(runtime)
    const spec = await adapter.runSpec(
      {
        projectId: state.id,
        agentId: agent.id,
        agentName: args.name,
        agentDir: rAgentDir,
        repoDir: rRepoDir,
        repoRoot: rRoot,
      },
      entrypoint,
    )
    // Quote the user-supplied entrypoint wherever it appears in the args; leave
    // the runtime's own static tokens (e.g. 'run', 'sandbox') unquoted.
    const launchCmd = [spec.command, ...spec.args.map((a) => (a === entrypoint ? sq(a) : a))].join(
      ' ',
    )
    // Refresh the window label on every (re)attach so it tracks renames (the session
    // stays UUID-keyed; mouse/colors/history come from the quimby tmux config below).
    const remoteCmd = `tmux rename-window ${sq(args.name)} 2>/dev/null; ${launchCmd}`

    // Quimby runs its own tmux server (-L) with its own config (-f), so the experience
    // is consistent without depending on the remote's ~/.tmux.conf (which the config
    // still sources). Written fresh each run; tmux reads -f only at server start.
    const rTmuxConf = remoteTmuxConfigPath(state.id, loc.base)
    await transport.writeFile(rTmuxConf, renderTmuxConfig())

    const sessionName = tmuxSessionName(agent.id)
    const runtimeLabel = runtime !== 'local' ? ` [${runtime}]` : ''
    logger.success(`Attaching to tmux session "${sessionName}" on ${loc.host}${runtimeLabel}`)
    // CWD is rAgentDir (parent of repo/) so the agent sees assignment.md, inbox/, etc.
    // tmux -A: attach to existing session or create a new one.
    // bash -l: login shell so PATH includes user-installed tools like claude / sbx.
    await transport.runInteractive('tmux', [
      '-L',
      quimbyTmuxSocket,
      '-f',
      rTmuxConf,
      'new-session',
      '-A',
      '-s',
      sessionName,
      '-n',
      args.name, // window label (display name); session stays UUID-keyed
      '-c',
      rAgentDir, // unquoted so the remote shell expands ~
      'bash',
      '-l',
      '-c',
      sq(remoteCmd),
    ])
    return
  }

  // ── Local agent ────────────────────────────────────────────────────────────
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

  // Opt-in tmux for local agents: run the agent inside a named, reattachable
  // session (the persistence SSH agents always get). `-A` attaches to an
  // existing session or creates one; `-e` carries any runtime env into it.
  if (agent.tmux) {
    const sessionName = tmuxSessionName(agent.id)
    const envArgs = Object.entries(spec.env ?? {}).flatMap(([key, value]) => [
      '-e',
      `${key}=${value}`,
    ])
    // Run the command through a login shell (like the SSH path) so the tmux
    // pane resolves PATH from the user's profile. Without this, tmux execs the
    // command in the tmux server's environment — which may predate (or lack)
    // user-installed tools like `sbx`/`claude` — and the session exits instantly.
    const baseCmd = [spec.command, ...spec.args.map((a) => (a === entrypoint ? sq(a) : a))].join(
      ' ',
    )
    // Refresh the window label on every (re)attach so it tracks renames (mouse/colors/
    // history come from the quimby tmux config). Then hold the pane open if the agent
    // command fails so its error is readable instead of the session vanishing with a
    // bare "[exited]"; a clean exit (the user quitting the agent) closes it normally.
    const localCmd = `tmux rename-window ${sq(args.name)} 2>/dev/null; ${baseCmd}; __code=$?; [ "$__code" -eq 0 ] || { printf '\\n[quimby] agent exited with code %s — press Enter to close\\n' "$__code"; read -r _; }`

    // Quimby runs its own tmux server (-L) with its own config (-f), so scroll, colors,
    // and history work without the user having a ~/.tmux.conf (the config sources it if
    // present). Written fresh each run; tmux reads -f only at server start.
    const tmuxConf = getTmuxConfigPath(repoRoot)
    await writeText(tmuxConf, renderTmuxConfig())

    logger.success(`Attaching to tmux session "${sessionName}"${runtimeLabel}`)
    try {
      await execa(
        'tmux',
        [
          '-L',
          quimbyTmuxSocket,
          '-f',
          tmuxConf,
          'new-session',
          '-A',
          '-s',
          sessionName,
          '-n',
          args.name, // window label (display name); session stays UUID-keyed
          '-c',
          spec.cwd ?? repoRoot,
          ...envArgs,
          'bash',
          '-l',
          '-c',
          localCmd,
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
