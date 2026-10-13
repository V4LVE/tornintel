// The connected Torn account, as returned by /api/user.

export type UserProfile = {
  id: number
  name: string
  level: number
  factionName: string
}

export type UserResponse = { user?: UserProfile; error?: string }
