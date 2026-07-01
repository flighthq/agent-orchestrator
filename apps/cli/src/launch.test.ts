import type { QuimbyState } from '@quimbyhq/types'
import { describe, expect, it, vi } from 'vitest'

const runSpec = vi.hoisted(() =>
  vi.fn(async () => ({ command: 'sbx', args: ['run', 'claude'], cwd: '/agent/dir', env: {} })),
)
const writeText = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@quimbyhq/runtimes', () => ({
  runtimeTypes: ['local', 'sbx'],
  getRuntime: () => ({ runSpec }),
  buildContext: (repoRoot: string) => ({ repoRoot }),
}))
vi.mock('@quimbyhq/template', () => ({
  renderTmuxConfig: () => 'tmux-conf',
  renderAgentClaudeMd: () => 'claude-md',
}))
vi.mock('@quimbyhq/utils', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  writeText,
}))

function state(): QuimbyState {
  return { id: 'proj', sourceRef: 'main', agents: {}, subscriptions: {} } as QuimbyState
}

describe('prepareLocalTmuxLaunch', () => {
  it('builds a shell command with the entrypoint quoted and writes the tmux config', async () => {
    writeText.mockClear()
    const { prepareLocalTmuxLaunch } = await import('./launch')
    const launch = await prepareLocalTmuxLaunch({
      state: state(),
      repoRoot: '/repo',
      agent: { id: 'a1', name: 'builder', location: { type: 'local' } } as never,
      runtime: 'sbx',
    })

    expect(launch.sessionName).toContain('qb-')
    expect(launch.windowName).toBe('builder')
    expect(launch.runtimeLabel).toBe(' [sbx]')
    // rename-window keeps the label tracking renames; the entrypoint is present.
    expect(launch.shellCmd).toContain('rename-window')
    expect(launch.shellCmd).toContain('claude')
    expect(writeText).toHaveBeenCalledOnce()
  })

  it('rejects an unknown runtime', async () => {
    const { prepareLocalTmuxLaunch } = await import('./launch')
    await expect(
      prepareLocalTmuxLaunch({
        state: state(),
        repoRoot: '/repo',
        agent: { id: 'a1', name: 'builder', location: { type: 'local' } } as never,
        runtime: 'bogus',
      }),
    ).rejects.toThrow('Unknown runtime')
  })
})
