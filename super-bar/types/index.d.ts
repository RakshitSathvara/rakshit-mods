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
  /** Hidden with × until Claude creates the next task, or until /taskbar. */
  hidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'super-bar': {
      board: SuperBarBoard
      view: SuperBarView
    }
  }
}
