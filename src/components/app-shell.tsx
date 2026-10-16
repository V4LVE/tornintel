import { Link, useRouterState } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
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
  const { pathname, href } = useRouterState({
    select: (state) => state.location,
  })
  const menuRef = useRef<HTMLDialogElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    menuRef.current?.close()
  }, [href])

  useEffect(() => {
    if (!menuOpen || !session.user) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const mobileNavigation = window.matchMedia(
      '(max-width: 1000px), (hover: none) and (pointer: coarse)',
    )
    const closeOnDesktop = () => {
      if (!mobileNavigation.matches) menuRef.current?.close()
    }
    mobileNavigation.addEventListener('change', closeOnDesktop)
    closeOnDesktop()
    return () => {
      document.body.style.overflow = previousOverflow
      mobileNavigation.removeEventListener('change', closeOnDesktop)
    }
  }, [menuOpen, session.user])

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
        <SidebarNavigation />
      </aside>

      <dialog
        ref={menuRef}
        id="mobile-navigation"
        className="mobile-menu"
        aria-labelledby="mobile-menu-title"
        onClose={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) menuRef.current?.close()
        }}
      >
        <div className="mobile-menu-content">
          <div className="mobile-menu-heading">
            <h2 id="mobile-menu-title">Navigation</h2>
            <button
              type="button"
              className="mobile-menu-close"
              aria-label="Close navigation"
              onClick={() => menuRef.current?.close()}
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <SidebarNavigation onNavigate={() => menuRef.current?.close()} />
        </div>
      </dialog>
      <section className="content">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-toggle"
            aria-label="Open navigation"
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            onClick={() => {
              menuRef.current?.showModal()
              setMenuOpen(true)
            }}
          >
            <span className="mobile-menu-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
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
              title={session.apiError || 'Torn API connected'}
              aria-label={
                session.apiError ? 'Torn API unavailable' : 'Torn API connected'
              }
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

function SidebarNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useSession()
  if (!user) return null
  return (
    <>
      <Link className="brand" to="/" onClick={onNavigate}>
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
                <Link
                  key={item.label}
                  className="nav-item"
                  onClick={onNavigate}
                  {...item.link}
                >
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
        <Link className="nav-item" onClick={onNavigate} {...SETTINGS_LINK}>
          <span className="nav-icon">*</span> Settings
        </Link>
        <Link className="profile" onClick={onNavigate} {...SETTINGS_LINK}>
          <div className="avatar">{user.name.charAt(0)}</div>
          <div>
            <strong>{user.name}</strong>
            <span>
              Level {user.level} · {user.factionName}
            </span>
          </div>
          <span className="profile-more">...</span>
        </Link>
      </div>
    </>
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
