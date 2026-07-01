import { QuimbyError } from '@quimbyhq/errors'
import { quimbyTmuxSocket, tmuxSessionName } from '@quimbyhq/paths'
import { getAgentSessionState } from '@quimbyhq/session'
import { getSSHTransport, sq } from '@quimbyhq/transport'
import { isSSH } from '@quimbyhq/types'
import { logger } from '@quimbyhq/utils'
import { resolveWorkspace } from '@quimbyhq/workspace'
import { defineCommand } from 'citty'
import { execa } from 'execa'

export default defineCommand({
  meta: {
    name: 'stop',
    description: "Kill an agent's tmux session (headless or attached)",
  },
  args: {
    name: {
      type: 'positional',
      description: 'Agent name',
      required: true,
    },
  },
  run: runStopCommand,
})

export async function runStopCommand({ args }: { args: { name: string } }) {
  const { state } = await resolveWorkspace()

  const agent = state.agents[args.name]
  if (!agent) {
    throw new QuimbyError(`Agent "${args.name}" not found`)
  }

  const session = tmuxSessionName(agent.id)
  const state0 = await getAgentSessionState(agent)
  if (state0 === 'stopped') {
    logger.info(`"${args.name}" isn't running (no tmux session "${session}").`)
    return
  }
  if (state0 === 'attached') {
    logger.warn(`"${args.name}" is attached — stopping it will drop any client in \`quimby run\`.`)
  }

  // kill-session tears down the whole session (its running entrypoint included); the
  // agent's work is on disk (assignment.md, its repo), so a stop only ends the process.
  if (isSSH(agent.location)) {
    await getSSHTransport(agent.location).exec(
      `tmux -L ${quimbyTmuxSocket} kill-session -t ${sq(session)}`,
    )
  } else {
    await execa('tmux', ['-L', quimbyTmuxSocket, 'kill-session', '-t', session])
  }

  logger.success(`Stopped "${args.name}" (killed tmux session "${session}").`)
}
