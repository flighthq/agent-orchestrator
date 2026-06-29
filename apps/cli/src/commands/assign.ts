import { QuimbyError } from '@quimbyhq/errors'
import { getWorkerDir, remoteWorkerDir } from '@quimbyhq/paths'
import { getSSHTransport } from '@quimbyhq/transport'
import { isSSH } from '@quimbyhq/types'
import { logger, readText, writeText } from '@quimbyhq/utils'
import { resolveWorkspace } from '@quimbyhq/workspace'
import { defineCommand } from 'citty'
import { join } from 'pathe'

export default defineCommand({
  meta: {
    name: 'assign',
    description: "Set a worker's current task",
  },
  args: {
    name: {
      type: 'positional',
      description: 'Worker name',
      required: true,
    },
    message: {
      type: 'string',
      alias: 'm',
      description: 'Assignment message (or @file to read from a file)',
    },
  },
  run: runAssignCommand,
})

export async function runAssignCommand({ args }: { args: { name: string; message?: string } }) {
  const { state, repoRoot } = await resolveWorkspace()

  const worker = state.workers[args.name]
  if (!worker) {
    throw new QuimbyError(`Worker "${args.name}" not found`)
  }

  let taskContent = args.message ?? ''
  if (taskContent.startsWith('@')) {
    taskContent = await readText(taskContent.slice(1))
  }
  if (!taskContent) {
    throw new QuimbyError('Provide a message with -m (use `quimby handoff` to deliver work)')
  }

  if (isSSH(worker.location)) {
    const transport = getSSHTransport(worker.location)
    const rWorkerDir = remoteWorkerDir(state.id, args.name, worker.location.base)
    await transport.writeFile(`${rWorkerDir}/assignment.md`, taskContent)
  } else {
    const workerDir = getWorkerDir(repoRoot, args.name)
    await writeText(join(workerDir, 'assignment.md'), taskContent)
  }

  logger.success(`Assignment set for "${args.name}"`)
}
