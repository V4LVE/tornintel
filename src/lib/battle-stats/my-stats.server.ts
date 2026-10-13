import { TornApiError } from '#/lib/torn/torn-api.server'

export function myStatsErrorResponse(error: unknown) {
  if (error instanceof TornApiError && error.code === 16) {
    return Response.json(
      {
        error:
          'Your battle stats need a Limited key (or a Custom key with battlestats and personalstats).',
      },
      { status: 403 },
    )
  }
  return Response.json(
    {
      error:
        error instanceof TornApiError
          ? error.message
          : 'Unable to load your battle stats. Try again shortly.',
    },
    { status: 502 },
  )
}
