// What super-bar keeps in $.state for the length of a session. The host holds
// these values, so they survive a hot reload; /clear, /resume and /branch reset them.

export type SuperBarStatus = 'pending' | 'in_progress' | 'completed'

export type SuperBarTask = {
  id: string
  subject: string
  activeForm: string | null
  status: SuperBarStatus
  /** Tasks created after every earlier task was done start a new batch. */
  batch: number
}

export type SuperBarBoard = {
  tasks: SuperBarTask[]
  batch: number
  /** Whether this session's model has the task tools; null until checked. */
  toolsOn: boolean | null
}

export type SuperBarView = {
  open: boolean
  hidden: boolean
  /** The finished batch whose row was dismissed. */
  doneHidden: number
}

export type SuperBarReading = { tokens: number; window: number; percent: number }

export type SuperBarTurn = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  model: string | null
}

export type SuperBarLimit = { kind: string; percentUsed: number; resetsAt: string | null }

export type SuperBarWeather = {
  readings: SuperBarReading[]
  lastTurn: SuperBarTurn | null
  limits: SuperBarLimit[]
  costUsd: number | null
}

export type SuperBarDetail = { used: { name: string; tokens: number }[] }

declare module 'claude-code' {
  interface PluginState {
    'super-bar': {
      board: SuperBarBoard
      view: SuperBarView
      weather: SuperBarWeather
      detail: SuperBarDetail | null
    }
  }
}
