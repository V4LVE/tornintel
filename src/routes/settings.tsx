import { createFileRoute } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { FF_SCOUTER_KEY_STORAGE } from '#/lib/ffscouter/ffscouter'
import { PageHeading } from '#/components/app-shell'
import { useSession } from '#/components/session'
import type { FfScouterKeyStatus } from '#/models/ffscouter'

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
  const { apiKey, user, error, isVerifying, connect, disconnect } = useSession()

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void connect(String(formData.get('apiKey') ?? ''))
  }

  // The app shell only renders pages for a verified user.
  if (!user) return null

  return (
    <section className="settings-page">
      <PageHeading eyebrow="WORKSPACE" title="Settings">
        Manage the Torn API key used from this browser.
      </PageHeading>
      <div className="settings-content">
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
            <button type="submit" className="add-button" disabled={isVerifying}>
              {isVerifying ? 'Checking…' : 'Save key'}
            </button>
            <button type="button" className="text-button" onClick={disconnect}>
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
      </div>
    </section>
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
