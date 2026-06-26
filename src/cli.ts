import { defineCommand, runCommand, showUsage } from 'citty'
import { logger } from './utils/logger.js'

const aliases: Record<string, string[]> = {
  add: ['sandbox', 'add'],
  list: ['sandbox', 'list'],
  start: ['sandbox', 'start'],
  stop: ['sandbox', 'stop'],
  assign: ['sandbox', 'assign'],
  status: ['sandbox', 'status'],
  refresh: ['sandbox', 'refresh'],
  review: ['bundle', 'review'],
  apply: ['bundle', 'apply'],
  send: ['bundle', 'send'],
}

const bundleSubCommands = new Set(['create', 'list', 'review', 'apply', 'send'])

function expandAliases(argv: string[]): string[] {
  const rawArgs = argv.slice(2)
  const first = rawArgs[0]
  if (first && first in aliases) {
    return [...aliases[first], ...rawArgs.slice(1)]
  }
  // `ao bundle <sandbox>` → `ao bundle create <sandbox>`
  if (
    first === 'bundle' &&
    rawArgs[1] &&
    !rawArgs[1].startsWith('-') &&
    !bundleSubCommands.has(rawArgs[1])
  ) {
    return ['bundle', 'create', ...rawArgs.slice(1)]
  }
  return rawArgs
}

const main = defineCommand({
  meta: {
    name: 'ao',
    version: '0.1.0',
    description: 'Agent Orchestrator — manage isolated agent sandboxes',
  },
  subCommands: {
    init: () => import('./commands/init.js').then((m) => m.default),
    sandbox: () => import('./commands/sandbox/index.js').then((m) => m.default),
    bundle: () => import('./commands/bundle/index.js').then((m) => m.default),
    diff: () => import('./commands/diff.js').then((m) => m.default),
    watch: () => import('./commands/watch.js').then((m) => m.default),
    workspace: () => import('./commands/workspace/index.js').then((m) => m.default),
  },
})

const rawArgs = expandAliases(process.argv)

async function resolveDeepest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cmd: any,
  args: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parent?: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<[any, any]> {
  const subs = typeof cmd.subCommands === 'function' ? await cmd.subCommands() : cmd.subCommands
  if (subs) {
    const name = args.find((a) => !a.startsWith('-'))
    if (name && subs[name]) {
      const sub = typeof subs[name] === 'function' ? await subs[name]() : subs[name]
      return resolveDeepest(sub, args.slice(args.indexOf(name) + 1), cmd)
    }
  }
  return [cmd, parent]
}

async function run() {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    const [cmd, parent] = await resolveDeepest(main, rawArgs)
    await showUsage(cmd, parent)
    process.exit(0)
  }
  if (rawArgs.length === 1 && rawArgs[0] === '--version') {
    console.log('0.1.0')
    process.exit(0)
  }
  try {
    await runCommand(main, { rawArgs })
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

run()
