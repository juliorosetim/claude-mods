// An agent's run time that ticks by itself on the surface's frame clock, so the pane is not redrawn each second.
// The pane hands it a reading (`now`) whenever it redraws; between readings the clock counts its own seconds.
import type { ClientModule } from 'claude-code'

type Props = { since: number; now: number; endAt: number | null }
type Run = { reading: number; base: number; ticks: number; running: boolean }

// A quarter turn each second while the agent works.
const TURN = ['◐', '◓', '◑', '◒']

const pad = (n: number) => String(n).padStart(2, '0')
function runText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(sec / 60)
  return min >= 60 ? `${Math.floor(min / 60)}h ${pad(min % 60)}m` : min ? `${min}m ${pad(sec % 60)}s` : `${sec}s`
}

const Clock: ClientModule<Props, { run: Run }> = (p, surface) => {
  const { Text } = surface.elements
  const run = surface.state?.run ?? { reading: -1, base: 0, ticks: 0, running: true }
  if (run.reading !== p.now) {
    run.reading = p.now
    run.base = (p.endAt ?? p.now) - p.since
    run.ticks = 0
  }
  run.running = p.endAt === null
  if (surface.state === undefined) {
    surface.setState({ run })
    surface.every(1000, () => {
      if (!run.running) return
      run.ticks += 1
      surface.setState({ run })
    })
  }
  const shown = runText(run.base + run.ticks * 1000)
  return <Text color={run.running ? 'claude' : 'subtle'}>{run.running ? `${TURN[run.ticks % TURN.length]} ${shown}` : shown}</Text>
}

export default Clock
