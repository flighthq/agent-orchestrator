import { defineCommand } from 'citty'
import { join } from 'pathe'
import { resolveWorkspace } from '../../core/workspace.js'
import { readBundle } from '../../core/bundle.js'
import { getSandboxPath } from '../../utils/paths.js'
import { AoError } from '../../utils/errors.js'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

function colorizeDiff(diff: string): string {
  return diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return bold(line)
      if (line.startsWith('@@')) return cyan(line)
      if (line.startsWith('+')) return green(line)
      if (line.startsWith('-')) return red(line)
      if (line.startsWith('diff ')) return bold(yellow(line))
      return line
    })
    .join('\n')
}

export default defineCommand({
  meta: {
    name: 'review',
    description: 'Review a bundle (show metadata and diff)',
  },
  args: {
    sandbox: {
      type: 'positional',
      description: 'Sandbox name',
      required: true,
    },
    bundle: {
      type: 'positional',
      description: 'Bundle ID',
      required: true,
    },
  },
  async run({ args }) {
    const { workspacePath } = await resolveWorkspace()
    const sandboxPath = getSandboxPath(workspacePath, args.sandbox)
    const bundlePath = join(sandboxPath, '.sandbox', 'bundles', args.bundle)

    let result: Awaited<ReturnType<typeof readBundle>>
    try {
      result = await readBundle(bundlePath)
    } catch {
      throw new AoError(
        `Bundle "${args.bundle}" not found in sandbox "${args.sandbox}"`,
      )
    }

    const { meta, squashedDiff } = result

    console.log()
    console.log(`${bold('Bundle:')} ${meta.id}`)
    console.log(`${bold('Sandbox:')} ${meta.sandbox}`)
    console.log(`${bold('Description:')} ${meta.description}`)
    console.log(`${bold('Message:')} ${meta.suggestedMessage}`)
    console.log(`${bold('Created:')} ${meta.createdAt}`)
    console.log(`${bold('Commits:')} ${meta.commits.length}`)

    if (meta.commits.length > 0) {
      console.log()
      for (const c of meta.commits) {
        console.log(`  ${dim(c.hash.slice(0, 8))} ${c.message}`)
      }
    }

    if (meta.dependencies?.length) {
      console.log(`\n${bold('Dependencies:')} ${meta.dependencies.join(', ')}`)
    }

    if (squashedDiff) {
      console.log()
      console.log(colorizeDiff(squashedDiff))
    }
  },
})
