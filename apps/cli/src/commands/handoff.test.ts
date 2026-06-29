import { describe, expect, it, vi } from 'vitest'

vi.mock('@quimbyhq/workspace', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  resolveWorkspace: vi.fn(async () => ({
    state: { id: 'proj-id', workers: {}, subscriptions: {} },
    repoRoot: '/fake/root',
  })),
}))

describe('run', () => {
  it('is a function', async () => {
    const { default: cmd } = await import('./handoff')
    expect(typeof cmd.run).toBe('function')
  })

  it('throws when the source worker does not exist', async () => {
    const { default: cmd } = await import('./handoff')
    await expect(
      cmd.run!({ args: { from: 'ghost', 'skip-check': false, rebase: false } } as never),
    ).rejects.toThrow('not found')
  })

  it('bounces an unknown recipient', async () => {
    vi.resetModules()
    vi.doMock('@quimbyhq/workspace', async (importOriginal) => ({
      ...((await importOriginal()) as object),
      resolveWorkspace: vi.fn(async () => ({
        state: { id: 'proj-id', workers: { builder: { location: undefined } }, subscriptions: {} },
        repoRoot: '/fake/root',
      })),
    }))
    const { default: cmd } = await import('./handoff')
    await expect(
      cmd.run!({
        args: { from: 'builder', to: 'ghost', 'skip-check': false, rebase: false },
      } as never),
    ).rejects.toThrow('not found')
    vi.doUnmock('@quimbyhq/workspace')
  })
})
