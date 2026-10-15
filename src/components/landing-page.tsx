import { ThemeToggle } from '#/components/theme-toggle'

const FEATURES = [
  {
    name: 'War hospital',
    detail: 'Find your next opening.',
    description:
      'Track enemy hospital status and travel windows alongside your energy, faction chain and a keep-alive target.',
  },
  {
    name: 'Levelling targets',
    detail: 'Make every hit count.',
    description:
      'Explore targets across ten level tiers, find three available players, and compare battle-stat estimates.',
  },
  {
    name: 'My stats',
    detail: 'See the bigger picture.',
    description:
      'Follow your training progress from 7 days to a year, and compare stats shared by your faction.',
  },
  {
    name: 'War payouts',
    detail: 'Settle up with confidence.',
    description:
      'Calculate payouts from war and non-war hits, set your rates, and keep the total within your earnings.',
  },
  {
    name: 'War deals',
    detail: 'Plan for either outcome.',
    description:
      'Build proposals for both sides with score-based compensation, whole items and a cash remainder.',
  },
  {
    name: 'Target estimates',
    detail: 'Choose your fights.',
    description:
      'Use shared Fair Fight evidence for battle-stat estimates, with optional FF Scouter estimates and player discovery.',
  },
]

export function LandingPage({
  error = '',
  isLoading = false,
  onSubmit,
}: {
  error?: string
  isLoading?: boolean
  onSubmit?: (apiKey: string) => void
}) {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="brand" href="#" aria-label="tornintel home">
          <span className="brand-mark">TI</span>
          <span>tornintel</span>
        </a>
        <nav aria-label="Landing page navigation">
          <a href="#features">The toolkit</a>
          <a href="#connect">
            Get access <span aria-hidden="true">↗</span>
          </a>
          <ThemeToggle />
        </nav>
      </header>
      <div className="landing-hero">
        <section className="landing-intro" aria-labelledby="landing-title">
          <p className="landing-eyebrow">
            <span /> BUILT FOR THE FACTION. READY FOR THE FIGHT.
          </p>
          <h1 id="landing-title">
            Better intel.
            <br />
            Smarter moves.
            <br />
            <em>Your advantage.</em>
          </h1>
          <p className="landing-lead">
            From the first hit to the final payout. Your war room, levelling
            targets and battle stats, together in one Torn toolkit.
          </p>
          <a className="landing-text-link" href="#features">
            Explore the toolkit <span aria-hidden="true">↓</span>
          </a>
          <div
            className="landing-preview"
            aria-label="Illustrative war hospital preview, not live data"
          >
            <div className="landing-preview-heading">
              <span>
                <span className="landing-status-dot" /> WAR ROOM
              </span>
              <span>EXAMPLE VIEW</span>
            </div>
            <div className="landing-preview-metrics">
              <div>
                <span>Faction chain</span>
                <strong>
                  124 <small>hits</small>
                </strong>
              </div>
              <div>
                <span>Energy</span>
                <strong>
                  150 <small>/ 150</small>
                </strong>
              </div>
              <div>
                <span>Next opening</span>
                <strong className="landing-accent">00:42</strong>
              </div>
            </div>
            <div className="landing-preview-row">
              <span className="landing-preview-avatar">01</span>
              <span>
                Enemy target<small>Hospital status</small>
              </span>
              <span className="landing-preview-tag">Out in 42s</span>
              <span aria-hidden="true">↗</span>
            </div>
          </div>
        </section>
        <section
          className="landing-connect"
          id="connect"
          aria-labelledby="connect-title"
          aria-busy={isLoading}
        >
          <div className="landing-card-top">
            <span className="landing-eyebrow">YOUR NEXT MOVE STARTS HERE</span>
            <span aria-hidden="true">↗</span>
          </div>
          <h2 id="connect-title">Enter your war room.</h2>
          <p>One Torn API key. Your whole toolkit.</p>
          <form
            className="landing-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (isLoading || !onSubmit) return
              const formData = new FormData(event.currentTarget)
              onSubmit(String(formData.get('apiKey') ?? ''))
            }}
          >
            <label htmlFor="login-api-key">Torn API key</label>
            <input
              id="login-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your API key"
              required
              disabled={isLoading}
              aria-invalid={!!error}
              aria-describedby={
                error
                  ? 'landing-key-help landing-key-error'
                  : 'landing-key-help'
              }
            />
            <p id="landing-key-help">
              Use a Limited key for My stats and Fair Fight estimates.
            </p>
            {error && (
              <p className="landing-error" id="landing-key-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={isLoading || !onSubmit}>
              {isLoading ? 'Checking your key…' : 'Connect to Torn'}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <a
            className="landing-key-link"
            href="https://www.torn.com/preferences.php#tab=api"
            target="_blank"
            rel="noreferrer"
          >
            Get an API key on Torn <span aria-hidden="true">↗</span>
          </a>
          <div className="landing-privacy">
            <span aria-hidden="true">◇</span>
            <div>
              <strong>Your key, your browser.</strong>
              <p>
                Your key is saved in this browser and sent to our server to
                request Torn data. It is never stored on the server.
              </p>
            </div>
          </div>
          <p className="landing-sharing">
            Your recent Fair Fight evidence helps improve shared target
            estimates. My stats shares your stats with your faction by default;
            you can turn sharing off there. FF Scouter is optional and sends a
            key to ffscouter.com only when enabled.
          </p>
        </section>
      </div>
      <section
        className="landing-features"
        id="features"
        aria-labelledby="features-title"
      >
        <div className="landing-section-heading">
          <div>
            <p className="landing-eyebrow">SIX TOOLS. ONE EDGE.</p>
            <h2 id="features-title">
              Less tab switching.
              <br />
              More time playing.
            </h2>
          </div>
          <p>
            Keep the information you need close.
            <br />
            In war, in training, and in between.
          </p>
        </div>
        <div className="landing-feature-grid">
          {FEATURES.map((feature, index) => (
            <article className="landing-feature" key={feature.name}>
              <div className="landing-feature-top">
                <span>0{index + 1}</span>
                <h3>{feature.name}</h3>
              </div>
              <h4>{feature.detail}</h4>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>
      <footer className="landing-footer">
        <span>
          tornintel <span className="landing-footer-divider">/</span> Know more.
          Play smarter.
        </span>
        <span>An independent toolkit for Torn players.</span>
        <a href="#connect">
          Ready when you are <span aria-hidden="true">↑</span>
        </a>
      </footer>
    </main>
  )
}
