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

// Current one-way standard/book-assisted business times (minutes), verified 2026-10-09:
// https://wiki.torn.com/wiki/Travel
const FLIGHT_MINUTES: Record<string, [number, number]> = {
  Mexico: [24, 5],
  'Cayman Islands': [33, 8],
  Canada: [39, 9],
  Hawaii: [127, 29],
  'United Kingdom': [151, 34],
  Argentina: [158, 35],
  Switzerland: [166, 38],
  Japan: [213, 48],
  China: [229, 52],
  'United Arab Emirates': [257, 58],
  'South Africa': [282, 64],
}
const MAX_DEPARTURE_GAP_MS = 2 * 60 * 1000

function normalizeCountry(raw: string) {
  const country = raw.trim().replace(/[.!]$/, '')
  const aliases: Partial<Record<string, string>> = {
    UK: 'United Kingdom',
    UAE: 'United Arab Emirates',
  }
  return (
    Object.keys(FLIGHT_MINUTES).find(
      (name) => name.toLowerCase() === country.toLowerCase(),
    ) ??
    aliases[country.toUpperCase()] ??
    null
  )
}

export function parseTravelRoute(description: string) {
  const text = description.trim()
  const returning =
    text.match(/^returning (?:to Torn )?from (.+)$/i) ??
    text.match(/^travel(?:ing|ling) from (.+) to Torn$/i)
  const outbound = text.match(/^travel(?:ing|ling) (?:from Torn )?to (.+)$/i)
  const country = normalizeCountry((returning ?? outbound)?.[1] ?? '')
  const direction =
    returning || outbound?.[1].trim().toLowerCase() === 'torn'
      ? 'RETURNING'
      : outbound && country
        ? 'OUTBOUND'
        : 'UNKNOWN'
  return { country, direction } as const
}

export function observeTravel(
  status: MemberStatus,
  observedAt: number,
  previous?: TravelSnapshot,
): TravelSnapshot {
  if (previous && observedAt <= previous.observedAt) return previous
  const state = status.state ?? 'Unknown'
  if (state !== 'Traveling') {
    return {
      state,
      routeKey: null,
      observedAt,
      firstSeenAt: null,
      departureEarliestAt: null,
    }
  }
  const route = parseTravelRoute(status.description ?? '')
  const routeKey = route.country
    ? `${route.direction}:${route.country}`
    : (status.description ?? '').trim().toLowerCase()
  if (
    previous?.state === 'Traveling' &&
    previous.routeKey === routeKey &&
    observedAt - previous.observedAt <= MAX_DEPARTURE_GAP_MS
  ) {
    return { ...previous, observedAt }
  }
  const departureObserved =
    previous && observedAt - previous.observedAt <= MAX_DEPARTURE_GAP_MS
  return {
    state,
    routeKey,
    observedAt,
    firstSeenAt: observedAt,
    departureEarliestAt: departureObserved ? previous.observedAt : null,
  }
}

export function estimateTravel(
  status: MemberStatus,
  snapshot: TravelSnapshot,
): TravelEstimate | null {
  if (status.state !== 'Traveling' || snapshot.firstSeenAt === null) return null
  const route = parseTravelRoute(status.description ?? '')
  const base = {
    ...route,
    firstSeenAt: snapshot.firstSeenAt,
    departureObserved: snapshot.departureEarliestAt !== null,
  }
  const reportedAt = (status.until ?? 0) * 1000
  if (Number.isFinite(reportedAt) && reportedAt > snapshot.firstSeenAt) {
    return {
      ...base,
      earliestArrivalAt: reportedAt,
      latestArrivalAt: reportedAt,
      timing: 'REPORTED',
    }
  }
  const times = route.country ? FLIGHT_MINUTES[route.country] : undefined
  if (!times)
    return {
      ...base,
      earliestArrivalAt: null,
      latestArrivalAt: null,
      timing: 'UNKNOWN',
    }
  // Include all flight classes, the 25% travel book, and 3% flight variance.
  // A mid-flight first sighting gives only an upper estimate, not a departure.
  const fastest = Math.round(times[1] * 0.97 * 60000)
  const slowest = Math.round(times[0] * 1.03 * 60000)
  return {
    ...base,
    earliestArrivalAt:
      snapshot.departureEarliestAt === null
        ? snapshot.firstSeenAt
        : snapshot.departureEarliestAt + fastest,
    latestArrivalAt: snapshot.firstSeenAt + slowest,
    timing: 'ESTIMATED',
  }
}
