import type { CacheEstimate } from './war-deal'

export type DealDefaults = {
  ourFaction: { id: number; name: string }
  theirFaction: { id: number; name: string } | null
  war: { id: number; target: number; start: number } | null
  caches: CacheEstimate[]
  items: Array<{ id: number; name: string; price: number }>
  baselines: Array<{
    factionName: string
    warId: number
    won: boolean
    end: number
  }>
  warnings: string[]
  fetchedAt: number
}
