import { describe, expect, it, vi } from 'vitest'

vi.mock('@quimbyhq/workspace', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  resolveWorkspace: vi.fn(async () => ({
    state: { id: 'proj-id', agents: { review: { location: undefined } }, subscriptions: {} },
    repoRoot: '/fake/root',
  })),
}))

describe('run', () => {
  it('is a function', async () => {
    const { default: cmd } = await import('./handoff')
    expect(typeof cmd.run).toBe('function')
  })

  it('throws when the recipient agent does not exist (host → unknown)', async () => {
    const { default: cmd } = await import('./handoff')
    await expect(
      cmd.run!({
        args: { from: 'ghost', rebase: false },
      } as never),
    ).rejects.toThrow('not found')
  })

  it('throws when the source agent does not exist (unknown → review)', async () => {
    const { default: cmd } = await import('./handoff')
    await expect(
      cmd.run!({
        args: {
          from: 'ghost',
          to: 'review',
          rebase: false,
        },
      } as never),
    ).rejects.toThrow('not found')
  })

  it('nudge is an optional boolean with no default (auto: nudge only when a note is present)', async () => {
    const { default: cmd } = await import('./handoff')
    const args = cmd.args as Record<string, { type: string; default?: unknown }>
    expect(args.nudge.type).toBe('boolean')
    expect(args.nudge.default).toBeUndefined()
  })
})
