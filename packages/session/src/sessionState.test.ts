import type { AgentState } from '@quimbyhq/types'
import { describe, expect, it } from 'vitest'

import { getAgentSessionState } from './sessionState'

const localNoTmux: AgentState = {
  id: 'a1',
  name: 'builder',
  location: { type: 'local' },
} as AgentState

const localWithTmux: AgentState = {
  id: 'a2',
  name: 'reviewer',
  location: { type: 'local' },
  tmux: true,
} as AgentState

describe('getAgentSessionState', () => {
  it('is stopped for a local agent with no live session', async () => {
    // No quimby tmux server runs in test, so display-message fails → stopped.
    expect(await getAgentSessionState(localNoTmux)).toBe('stopped')
  })

  it('is stopped for a tmux-enabled agent that is not running', async () => {
    expect(await getAgentSessionState(localWithTmux)).toBe('stopped')
  })
})
