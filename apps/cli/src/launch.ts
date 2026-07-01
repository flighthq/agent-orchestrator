import { configureRemoteAgentIdentity } from '@quimbyhq/agent'
import { QuimbyError } from '@quimbyhq/errors'
import {
  getTmuxConfigPath,
  remoteAgentDir,
  remoteAgentRepoDir,
  remoteProjectRoot,
  remoteTmuxConfigPath,
  tmuxSessionName,
} from '@quimbyhq/paths'
import { buildContext, getRuntime, runtimeTypes } from '@quimbyhq/runtimes'
import { renderAgentClaudeMd, renderTmuxConfig } from '@quimbyhq/template'
import type { SSHTransport } from '@quimbyhq/transport'
import { getSSHTransport, sq } from '@quimbyhq/transport'
import type { AgentState, QuimbyState, RuntimeType, SSHLocation } from '@quimbyhq/types'
import { logger, writeText } from '@quimbyhq/utils'
import { saveState } from '@quimbyhq/workspace'

export interface LaunchOptions {
  state: QuimbyState
  repoRoot: string
  agent: Readonly<AgentState>
  cmd?: string
  runtime?: string
}

/**
 * Everything `run`/`start` need to open (or reattach to) a local tmux session for an
 * agent: the pieces of a `tmux … new-session` invocation. The caller supplies the
 * mode — `run` attaches (`-A`, inherited stdio), `start` creates detached (`-A -d`).
 */
export interface LocalTmuxLaunch {
  sessionName: string
  tmuxConf: string
  cwd: string
  envArgs: string[]
  shellCmd: string
  windowName: string
  runtimeLabel: string
}

/**
 * The remote-side twin of {@link LocalTmuxLaunch}: the pieces of a `tmux … new-session`
 * to run over transport on an SSH host, after syncing the project and lazily initializing
 * the remote agent on first launch.
 */
export interface SshLaunch {
  transport: SSHTransport
  host: string
  sessionName: string
  tmuxConf: string
  cwd: string
  shellCmd: string
  windowName: string
  runtimeLabel: string
}

/**
 * Prepare a local agent's tmux launch: resolve runtime/entrypoint, build the shell
 * command (window-label refresh + entrypoint, holding the pane open on failure so the
 * error is readable), and write the bundled tmux config. Does not spawn tmux — the
 * caller decides attach vs detached.
 */
export async function prepareLocalTmuxLaunch(
  opts: Readonly<LaunchOptions>,
): Promise<LocalTmuxLaunch> {
  const { state, repoRoot, agent } = opts
  const { runtime, entrypoint, runtimeLabel } = resolveRuntime(opts)

  const adapter = getRuntime(runtime)
  const ctx = buildContext(repoRoot, agent.name, state.id, agent.id)
  const spec = await adapter.runSpec(ctx, entrypoint)

  const envArgs = Object.entries(spec.env ?? {}).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`,
  ])

  // Run the command through a login shell so the tmux pane resolves PATH from the
  // user's profile; without it tmux execs in the tmux server's environment, which
  // may lack user-installed tools (`sbx`/`claude`), and the session exits instantly.
  const baseCmd = [spec.command, ...spec.args.map((a) => (a === entrypoint ? sq(a) : a))].join(' ')
  // Refresh the window label on every (re)attach so it tracks renames, then hold the
  // pane open if the agent command fails so its error is readable instead of the
  // session vanishing with a bare "[exited]"; a clean exit closes it normally.
  const shellCmd = `tmux rename-window ${sq(agent.name)} 2>/dev/null; ${baseCmd}; __code=$?; [ "$__code" -eq 0 ] || { printf '\\n[quimby] agent exited with code %s — press Enter to close\\n' "$__code"; read -r _; }`

  const tmuxConf = getTmuxConfigPath(repoRoot)
  await writeText(tmuxConf, renderTmuxConfig())

  return {
    sessionName: tmuxSessionName(agent.id),
    tmuxConf,
    cwd: spec.cwd ?? repoRoot,
    envArgs,
    shellCmd,
    windowName: agent.name,
    runtimeLabel,
  }
}

/**
 * Prepare an SSH agent's remote tmux launch: rsync the project, migrate a legacy
 * name-keyed remote dir, lazily clone + tag + scaffold on first launch (persisting the
 * seed commit), build the remote launch command, and write the remote tmux config.
 * Does not spawn tmux — the caller decides attach vs detached.
 */
export async function prepareSshLaunch(
  opts: Readonly<LaunchOptions & { location: SSHLocation }>,
): Promise<SshLaunch> {
  const { state, repoRoot, agent, location: loc } = opts
  const transport = getSSHTransport(loc)
  const rRoot = remoteProjectRoot(state.id, loc.base)
  const rAgentDir = remoteAgentDir(state.id, agent.id, loc.base)
  const rRepoDir = remoteAgentRepoDir(state.id, agent.id, loc.base)

  logger.start(`Syncing project to ${loc.host}...`)
  await transport.syncProjectTo(repoRoot, rRoot)

  // One-time migration of a remote agent dir from the legacy name-keyed layout to the
  // UUID-keyed one, so an existing remote agent's work isn't re-cloned away.
  const rLegacyAgentDir = remoteAgentDir(state.id, agent.name, loc.base)
  if (rLegacyAgentDir !== rAgentDir) {
    await transport.exec(
      `if [ -d ${rLegacyAgentDir} ] && [ ! -d ${rAgentDir} ]; then mkdir -p "$(dirname ${rAgentDir})" && mv ${rLegacyAgentDir} ${rAgentDir}; fi`,
    )
  }

  // Lazy remote init: set up agent dirs and clone if this is the first launch.
  const repoReady = await transport.fileExists(`${rRepoDir}/.git`)
  if (!repoReady) {
    await transport.checkCapabilities(['git', 'rsync', 'tmux'])
    logger.start('Initializing remote agent...')
    await transport.ensureDir(`${rAgentDir}/inbox/status`)
    await transport.ensureDir(`${rAgentDir}/outbox`)
    await transport.exec(`git clone ${rRoot} ${rRepoDir}`)
    await transport.exec(`git tag quimby/seed`, { cwd: rRepoDir })
    await configureRemoteAgentIdentity(transport, rRepoDir, agent.name, repoRoot)
    const seedCommit = (await transport.exec(`git rev-parse HEAD`, { cwd: rRepoDir })).trim()
    await transport.writeFile(`${rAgentDir}/assignment.md`, '')
    await transport.writeFile(`${rAgentDir}/status.md`, 'idle')
    const claudeMd = renderAgentClaudeMd({ agentName: agent.name, agentId: agent.id })
    await transport.writeFile(`${rAgentDir}/CLAUDE.md`, claudeMd)

    state.agents[agent.name].seedCommit = seedCommit
    await saveState(repoRoot, state)
    logger.success('Remote agent initialized')
  }

  const { runtime, entrypoint, runtimeLabel } = resolveRuntime(opts)

  // Build the shell command for the remote machine using the runtime adapter; cwd is
  // handled by tmux -c, so we pass remote paths but don't use spec.cwd.
  const adapter = getRuntime(runtime)
  const spec = await adapter.runSpec(
    {
      projectId: state.id,
      agentId: agent.id,
      agentName: agent.name,
      agentDir: rAgentDir,
      repoDir: rRepoDir,
      repoRoot: rRoot,
    },
    entrypoint,
  )
  // Quote the user-supplied entrypoint wherever it appears; leave the runtime's own
  // static tokens (e.g. 'run', 'sandbox') unquoted.
  const launchCmd = [spec.command, ...spec.args.map((a) => (a === entrypoint ? sq(a) : a))].join(
    ' ',
  )
  // Refresh the window label on every (re)attach so it tracks renames.
  const shellCmd = `tmux rename-window ${sq(agent.name)} 2>/dev/null; ${launchCmd}`

  // Quimby runs its own tmux server (-L) with its own config (-f); written fresh each
  // launch since tmux reads -f only at server start.
  const tmuxConf = remoteTmuxConfigPath(state.id, loc.base)
  await transport.writeFile(tmuxConf, renderTmuxConfig())

  return {
    transport,
    host: loc.host,
    sessionName: tmuxSessionName(agent.id),
    tmuxConf,
    cwd: rAgentDir,
    shellCmd,
    windowName: agent.name,
    runtimeLabel,
  }
}

function resolveRuntime(opts: Readonly<LaunchOptions>): {
  runtime: RuntimeType
  entrypoint: string
  runtimeLabel: string
} {
  const saved = opts.agent.defaults
  const runtime =
    (opts.runtime as RuntimeType | undefined) ?? (saved?.runtime as RuntimeType) ?? 'local'
  const entrypoint = opts.cmd ?? saved?.entrypoint ?? 'claude'

  if (!runtimeTypes.includes(runtime)) {
    throw new QuimbyError(`Unknown runtime "${runtime}". Available: ${runtimeTypes.join(', ')}`)
  }

  return { runtime, entrypoint, runtimeLabel: runtime !== 'local' ? ` [${runtime}]` : '' }
}
