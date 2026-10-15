import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { AppShell } from '../components/app-shell'
import { SessionProvider } from '../components/session'
import { themeBootScript } from '../components/theme-toggle'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'tornintel | War hospital',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
})

// Every page renders inside the same sidebar layout, so navigating between
// tools never leaves the app.
function RootLayout() {
  return (
    <SessionProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionProvider>
  )
}

function NotFound() {
  return (
    <section className="not-found">
      <h1>Page not found</h1>
      <p>This page does not exist or has moved.</p>
      <Link className="back-link" to="/">
        ← Back to war hospital
      </Link>
    </section>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The boot script may set data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
