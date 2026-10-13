export type ChainTarget = {
  id: number
  name: string
  level: number
  lastWonAt: number
}

export type ChainTargetResponse = {
  target: ChainTarget | null
  fetchedAt: number
  message?: string
  error?: string
}
