import { createFileRoute } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { FF_SCOUTER_KEY_STORAGE } from '#/lib/ffscouter'
import type { FfScouterKeyStatus } from '#/lib/ffscouter'
import { verifyTornUser } from '#/lib/torn-user'
import type { UserProfile } from '#/lib/torn-user'

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
  const [apiKey, setApiKey] = useState('')
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState('')

  const verifyKey = useCallback(async (key: string) => {
    const publicApiKey = key.trim()
    if (!publicApiKey) {
      setError('Enter a Torn API key to continue.')
      return false
    }

    setIsChecking(true)
    setError('')
    try {
      const verifiedUser = await verifyTornUser(publicApiKey)
      window.localStorage.setItem('tornintel.apiKey', publicApiKey)
      setApiKey(publicApiKey)
      setUser(verifiedUser)
      return true
    } catch (requestError) {
      window.localStorage.removeItem('tornintel.apiKey')
      setApiKey('')
      setUser(null)
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to verify your Torn API key.',
      )
      return false
    } finally {
      setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    const savedApiKey = window.localStorage.getItem('tornintel.apiKey') ?? ''
    setIsReady(true)
    if (savedApiKey) void verifyKey(savedApiKey)
  }, [verifyKey])

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void verifyKey(String(formData.get('apiKey') ?? ''))
  }

  function removeKey() {
    window.localStorage.removeItem('tornintel.apiKey')
    setApiKey('')
    setUser(null)
    setError('')
  }

  if (!isReady || isChecking) {
    return (
      <main className="api-key-gate">
        <section className="api-key-card">
          <h1>Checking your key...</h1>
        </section>
      </main>
    )
  }

  if (!apiKey || !user) {
    return (
      <main className="api-key-gate">
        <section className="api-key-card">
          <div className="brand">
            <span className="brand-mark">TI</span>
            <span>tornintel</span>
          </div>
          <h1>Connect to Torn</h1>
          <p>Enter a Torn API key to access your settings.</p>
          <form className="api-key-login" onSubmit={submitKey}>
            <label htmlFor="settings-login-api-key">Torn API key</label>
            <input
              id="settings-login-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Paste a Limited Torn API key"
            />
            {error && <p className="login-error">{error}</p>}
            <button type="submit">Connect</button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <a className="brand" href="/">
          <span className="brand-mark">TI</span>
          <span>tornintel</span>
        </a>
        <a className="back-link" href="/">
          Back to war hospital
        </a>
      </header>
      <section className="settings-content">
        <div className="settings-heading">
          <span>WORKSPACE</span>
          <h1>Settings</h1>
          <p>Manage the Torn API key used from this browser.</p>
        </div>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Torn API key</h2>
              <p>
                A Limited key enables Fair Fight estimates. It is stored locally
                in this browser.
              </p>
            </div>
          </div>
          <form className="api-key-settings" onSubmit={submitKey}>
            <label htmlFor="settings-api-key">Torn API key</label>
            <input
              id="settings-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              defaultValue={apiKey}
            />
            <button type="submit" className="add-button">
              Save key
            </button>
            <button type="button" className="text-button" onClick={removeKey}>
              Remove key
            </button>
          </form>
          {error && <p className="settings-error">{error}</p>}
        </section>
        <FfScouterKeyPanel />
        <section className="panel account-panel">
          <div className="panel-header">
            <div>
              <h2>Connected account</h2>
              <p>Verified with your current Torn API key.</p>
            </div>
          </div>
          <div className="connected-user">
            <div className="avatar">{user.name.charAt(0)}</div>
            <div>
              <strong>{user.name}</strong>
              <span>
                #{user.id} - Level {user.level} - {user.factionName}
              </span>
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}

function FfScouterKeyPanel() {
  const [savedKey, setSavedKey] = useState('')
  const [status, setStatus] = useState<FfScouterKeyStatus | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSavedKey(window.localStorage.getItem(FF_SCOUTER_KEY_STORAGE) ?? '')
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = String(
      new FormData(event.currentTarget).get('ffscouterKey') ?? '',
    ).trim()
    if (!key) {
      remove()
      return
    }
    setIsChecking(true)
    setError('')
    setStatus(null)
    try {
      const response = await fetch('/api/ffscouter-key', {
        cache: 'no-store',
        headers: { 'X-FfScouter-Key': key },
      })
      const payload = (await response.json()) as FfScouterKeyStatus & {
        error?: string
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? 'Could not check the key.')
      }
      setStatus(payload)
      // Only keep keys FF Scouter will accept.
      if (payload.registered) {
        window.localStorage.setItem(FF_SCOUTER_KEY_STORAGE, key)
        setSavedKey(key)
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not check the key.',
      )
    } finally {
      setIsChecking(false)
    }
  }

  function remove() {
    window.localStorage.removeItem(FF_SCOUTER_KEY_STORAGE)
    setSavedKey('')
    setStatus(null)
    setError('')
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>FF Scouter key</h2>
          <p>
            Optional. Used for FF Scouter estimates on the levelling page
            instead of your Torn API key. It must be registered at{' '}
            <a href="https://ffscouter.com" target="_blank" rel="noreferrer">
              ffscouter.com
            </a>{' '}
            and is stored locally in this browser.
          </p>
        </div>
      </div>
      <form
        className="api-key-settings"
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor="settings-ffscouter-key">FF Scouter key</label>
        <input
          id="settings-ffscouter-key"
          name="ffscouterKey"
          type="password"
          autoComplete="off"
          defaultValue={savedKey}
          key={savedKey}
          placeholder="Uses your Torn API key"
        />
        <button type="submit" className="add-button" disabled={isChecking}>
          {isChecking ? 'Checking...' : 'Save key'}
        </button>
        {savedKey && (
          <button type="button" className="text-button" onClick={remove}>
            Remove key
          </button>
        )}
      </form>
      {status && (
        <p className={status.registered ? 'settings-note' : 'settings-error'}>
          {status.registered
            ? `Registered with FF Scouter${status.premium ? ' (premium)' : ''}.`
            : 'This key is not registered with FF Scouter. Sign up at ffscouter.com, then save it again.'}
        </p>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  )
}
