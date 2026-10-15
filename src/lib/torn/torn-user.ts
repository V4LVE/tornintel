import type { UserProfile, UserResponse } from '#/models/account'

export async function verifyTornUser(
  apiKey: string,
  signal?: AbortSignal,
): Promise<UserProfile> {
  const response = await fetch('/api/user', {
    cache: 'no-store',
    signal,
    headers: { 'X-Torn-Api-Key': apiKey },
  })
  const payload = (await response.json()) as UserResponse
  if (!response.ok || !payload.user || payload.error) {
    throw new Error(payload.error ?? 'Unable to verify your Torn API key.')
  }
  return payload.user
}
