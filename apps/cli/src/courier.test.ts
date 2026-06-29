import type { QuimbyState } from '@quimbyhq/types'
import { describe, expect, it } from 'vitest'

import { stageParcel } from './courier'

describe('stageParcel', () => {
  it('throws when the source worker does not exist', async () => {
    const state = { id: 'proj-id', workers: {}, subscriptions: {} } as unknown as QuimbyState
    await expect(stageParcel({ state, repoRoot: '/fake/root', from: 'ghost' })).rejects.toThrow(
      'not found',
    )
  })

  it('throws when the attach code source does not exist', async () => {
    const state = {
      id: 'proj-id',
      workers: { review: { location: undefined } },
      subscriptions: {},
    } as unknown as QuimbyState
    await expect(
      stageParcel({ state, repoRoot: '/fake/root', from: 'review', attach: 'ghost' }),
    ).rejects.toThrow('not found')
  })
})
