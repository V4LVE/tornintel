import { Link, useRouterState } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSession } from '#/components/session'
import { ThemeToggle } from '#/components/theme-toggle'
import { LandingPage } from '#/components/landing-page'

type NavItem = {
  label: string
  icon: string
  // Left out for features that are not built yet.
  link?: Pick<LinkProps, 'to' | 'hash' | 'activeOptions'>
}

// Faction tools are shared with the whole faction; personal tools are about the viewer.
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'FACTION',
    items: [
      {
        label: 'War hospital',
        icon: '+',
        link: { to: '/', activeOptions: { exact: true, includeHash: true } },
      },
      { label: 'War payout', icon: '$', link: { to: '/payouts' } },
      {
        label: 'War deals',
        icon: '↔',
        link: { to: '/war-deals' },
      },
    ],
  },
  {
    label: 'PERSONAL',
    items: [
      {
        label: 'Levelling targets',
        icon: '^',
        link: { to: '/levelling' },
      },
      { label: 'My stats', icon: '↑', link: { to: '/my-stats' } },
    ],
  },
]

const SETTINGS_LINK = { to: '/settings' }

// Sidebar, top bar and the API key gate around every page.
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (session.status === 'loading' || (session.isVerifying && !session.user)) {
    return <LandingPage isLoading />
  }
  if (!session.user) {
    return (
      <LandingPage
        error={session.error}
        onSubmit={(key) => void session.connect(key)}
      />
    )
  }

  const current = currentPage(pathname)
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-mark">TI</span>
          <span>tornintel</span>
        </Link>
        {NAV_SECTIONS.map((section) => (
          <nav
            key={section.label}
            className="nav-section"
            aria-label={section.label}
          >
            <div className="workspace-label">{section.label}</div>
            <div className="nav-list">
              {section.items.map((item) =>
                item.link ? (
                  <Link key={item.label} className="nav-item" {...item.link}>
                    <span className="nav-icon">{item.icon}</span> {item.label}
                  </Link>
                ) : (
                  <span
                    key={item.label}
                    className="nav-item disabled"
                    aria-disabled="true"
                  >
                    <span className="nav-icon">{item.icon}</span> {item.label}
                    <span className="soon">Soon</span>
                  </span>
                ),
              )}
            </div>
          </nav>
        ))}
        <div className="sidebar-bottom">
          <div className="workspace-label">WORKSPACE</div>
          <Link className="nav-item" {...SETTINGS_LINK}>
            <span className="nav-icon">*</span> Settings
          </Link>
          <Link className="profile" {...SETTINGS_LINK}>
            <div className="avatar">{session.user.name.charAt(0)}</div>
            <div>
              <strong>{session.user.name}</strong>
              <span>
                Level {session.user.level} · {session.user.factionName}
              </span>
            </div>
            <span className="profile-more">...</span>
          </Link>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{current.section}</span>
            <b>/</b>
            <strong>{current.label}</strong>
          </div>
          <div className="top-actions">
            <span
              className={
                session.apiError ? 'connection unavailable' : 'connection'
              }
              title={session.apiError || undefined}
            >
              <i />{' '}
              {session.apiError ? 'Torn API unavailable' : 'Torn API connected'}
            </span>
            <ThemeToggle />
          </div>
        </header>
        {children}
      </section>
    </main>
  )
}

// The standard title block at the top of a page.
export function PageHeading({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: ReactNode
  title: string
  // The description under the title.
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions}
    </div>
  )
}

function currentPage(pathname: string) {
  if (pathname === '/settings')
    return { section: 'Workspace', label: 'Settings' }
  for (const section of NAV_SECTIONS) {
    const item = section.items.find(
      (candidate) => candidate.link?.to === pathname,
    )
    if (item) {
      return {
        section: section.label.charAt(0) + section.label.slice(1).toLowerCase(),
        label: item.label,
      }
    }
  }
  return { section: 'tornintel', label: 'Page not found' }
}
