import { describe, expect, it } from 'vitest'

import { renderAgentClaudeMd, renderTmuxConfig } from './template'

describe('renderAgentClaudeMd', () => {
  it('includes the agent name', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('alice')
  })

  it('includes the agent id', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('agent-id-123')
  })

  it('references repo/CLAUDE.md', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('@repo/CLAUDE.md')
  })

  it('includes assignment section', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('assignment.md')
  })

  it('includes status section', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('status.md')
  })

  it('includes inbox section', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('inbox/')
  })

  it('mentions the repo/ directory', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output).toContain('repo/')
  })

  it('uses the agent name in the header', () => {
    const output = renderAgentClaudeMd({ agentName: 'my-agent', agentId: 'agent-id-123' })
    expect(output).toContain('**my-agent**')
  })

  it('ends with a newline', () => {
    const output = renderAgentClaudeMd({ agentName: 'alice', agentId: 'agent-id-123' })
    expect(output.endsWith('\n')).toBe(true)
  })
})

describe('renderTmuxConfig', () => {
  it('enables mouse mode for out-of-the-box scrolling', () => {
    expect(renderTmuxConfig()).toContain('mouse on')
  })

  it('sources the user’s own ~/.tmux.conf if present', () => {
    expect(renderTmuxConfig()).toContain('source-file -q ~/.tmux.conf')
  })

  it('enables true-color passthrough and a generous history limit', () => {
    const conf = renderTmuxConfig()
    expect(conf).toContain('terminal-overrides ",*:Tc"')
    expect(conf).toContain('history-limit 50000')
  })

  it('shows the window (agent) name in the status bar, not a default green bar', () => {
    const conf = renderTmuxConfig()
    expect(conf).toContain('#W')
    expect(conf).toContain('status-style')
  })
})
