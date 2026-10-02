export type UserProfile = {
  id: number
  name: string
  level: number
  factionName: string
}

type UserResponse = { user?: UserProfile; error?: string }

export async function verifyTornUser(apiKey: string): Promise<UserProfile> {
  const response = await fetch('/api/user', {
    cache: 'no-store',
    headers: { 'X-Torn-Api-Key': apiKey },
  })
  const payload = (await response.json()) as UserResponse
  if (!response.ok || !payload.user || payload.error) {
    throw new Error(payload.error ?? 'Unable to verify your Torn API key.')
  }
  return payload.user
}
