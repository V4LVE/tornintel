// Member status and flight tracking.

export type MemberStatus = {
  state?: string
  description?: string
  details?: string | null
  until?: number | null
}

export type TravelSnapshot = {
  state: string
  routeKey: string | null
  observedAt: number
  firstSeenAt: number | null
  departureEarliestAt: number | null
}

export type TravelEstimate = {
  direction: 'OUTBOUND' | 'RETURNING' | 'UNKNOWN'
  country: string | null
  firstSeenAt: number
  departureObserved: boolean
  earliestArrivalAt: number | null
  latestArrivalAt: number | null
  timing: 'REPORTED' | 'ESTIMATED' | 'UNKNOWN'
}
