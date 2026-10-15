import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { verifyTornUser } from '#/lib/torn/torn-user'
import type { UserProfile } from '#/models/account'

const API_KEY_STORAGE = 'tornintel.apiKey'

export type Session = {
  // 'loading' until the saved key has been checked once.
  status: 'loading' | 'signed-out' | 'ready'
  apiKey: string
  user: UserProfile | null
  isVerifying: boolean
  error: string
  // The last Torn request failure a page reported; empty while requests work.
  apiError: string
  reportApiError: (message: string) => void
  connect: (key: string) => Promise<boolean>
  disconnect: () => void
}

const SessionContext = createContext<Session | null>(null)

// The verified Torn key and profile, shared by the app shell and every page.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Session['status']>('loading')
  const [apiKey, setApiKey] = useState('')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState('')
  const [apiError, setApiError] = useState('')
  const verification = useRef<AbortController | null>(null)

  const connect = useCallback(async (key: string) => {
    const requestedApiKey = key.trim()
    if (!requestedApiKey) {
      setError('Enter a Torn API key to continue.')
      return false
    }
    verification.current?.abort()
    const controller = new AbortController()
    verification.current = controller
    setIsVerifying(true)
    setError('')
    try {
      const verifiedUser = await verifyTornUser(
        requestedApiKey,
        controller.signal,
      )
      if (controller.signal.aborted) return false
      window.localStorage.setItem(API_KEY_STORAGE, requestedApiKey)
      setApiKey(requestedApiKey)
      setUser(verifiedUser)
      setApiError('')
      setStatus('ready')
      return true
    } catch (requestError) {
      if (controller.signal.aborted) return false
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to verify your Torn API key.',
      )
      // A rejected new key keeps an already connected session.
      setStatus((current) => (current === 'ready' ? current : 'signed-out'))
      return false
    } finally {
      if (!controller.signal.aborted) setIsVerifying(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    verification.current?.abort()
    setIsVerifying(false)
    window.localStorage.removeItem(API_KEY_STORAGE)
    setApiKey('')
    setUser(null)
    setError('')
    setApiError('')
    setStatus('signed-out')
  }, [])

  useEffect(() => {
    const savedApiKey = window.localStorage.getItem(API_KEY_STORAGE) ?? ''
    if (savedApiKey) void connect(savedApiKey)
    else setStatus('signed-out')
    return () => verification.current?.abort()
  }, [connect])

  const value = useMemo(
    () => ({
      status,
      apiKey,
      user,
      isVerifying,
      error,
      apiError,
      reportApiError: setApiError,
      connect,
      disconnect,
    }),
    [status, apiKey, user, isVerifying, error, apiError, connect, disconnect],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const session = useContext(SessionContext)
  if (!session)
    throw new Error('useSession must be used inside SessionProvider.')
  return session
}
