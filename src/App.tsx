import { Switch, Route, Router, useLocation } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { queryClient } from './lib/queryClient'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { QuoteProvider } from '@/lib/quote-context'
import { ServicesProvider } from '@/lib/services-context'
import { Button } from '@/components/ui/button'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/AppSidebar'
import { Sun, Moon } from 'lucide-react'
import Dashboard from '@/pages/Dashboard'
import Contacts from '@/pages/Contacts'
import ContactDetail from '@/pages/ContactDetail'
import Leads from '@/pages/Leads'
import CalendarPage from '@/pages/CalendarPage'
import Jobs from '@/pages/Jobs'
import Calculator from '@/pages/Calculator'
import Quotes from '@/pages/Quotes'
import Subscriptions from '@/pages/Subscriptions'
import PriceBook from '@/pages/PriceBook'
import SettingsPage from '@/pages/Settings'
import Finance from '@/pages/Finance'
import Marketing from '@/pages/Marketing'
import ScratchPad from '@/pages/ScratchPad'
import Contractors from '@/pages/Contractors'   // ← NEW (FIX 3)

// ThemeApplicator removed — Phantom Dark is the fixed theme, managed via CSS variables

// ── Page label map ────────────────────────────────────────────────────────────

const PAGE_LABELS: Record<string, string> = {
  '/':              'Dashboard',
  '/leads':         'Leads',
  '/contacts':      'Contacts',
  '/calendar':      'Calendar',
  '/jobs':          'Jobs',
  '/quotes':        'Quotes',
  '/subscriptions': 'Subscriptions',
  '/finance':       'Finance',
  '/marketing':     'Marketing',
  '/calculator':    'Calculator',
  '/pricebook':     'Price Book',
  '/settings':      'Settings',
  '/scratchpad':    'Scratch Pad',
  '/contractors':   'Contractors',   // ← NEW (FIX 3)
}

function getPageLabel(location: string): string {
  if (location === '/') return 'Dashboard'
  // Try exact match first, then prefix match (handles /contacts/123 etc.)
  if (PAGE_LABELS[location]) return PAGE_LABELS[location]
  const prefix = Object.keys(PAGE_LABELS)
    .filter(k => k !== '/' && location.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? PAGE_LABELS[prefix] : ''
}

// ── Header ────────────────────────────────────────────────────────────────────

function AppHeader() {
  const { theme, toggleTheme } = useTheme()
  const [location] = useLocation()
  const pageLabel = getPageLabel(location)

  return (
    <header className="sticky top-0 z-50 flex items-center gap-2 border-b bg-card/95 backdrop-blur-sm px-3" style={{ minHeight: 48 }}>
      <SidebarTrigger className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground" />

      {/* Current page name — centered between the two icons */}
      <div className="flex-1 flex justify-center">
        {pageLabel && (
          <span className="text-sm font-semibold tracking-tight truncate max-w-[200px]">
            {pageLabel}
          </span>
        )}
      </div>

      <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8 rounded-full">
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  )
}

// ── App layout ────────────────────────────────────────────────────────────────

function AppLayout() {
  const [location] = useLocation()

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-[100dvh] w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <AppHeader />
          <main
            key={location}
            className="flex-1 overflow-y-auto animate-page-enter"
          >
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/contacts" component={Contacts} />
              <Route path="/contacts/:id" component={ContactDetail} />
              <Route path="/leads" component={Leads} />
              <Route path="/calendar" component={CalendarPage} />
              <Route path="/jobs" component={Jobs} />
              <Route path="/calculator" component={Calculator} />
              <Route path="/quotes" component={Quotes} />
              <Route path="/subscriptions" component={Subscriptions} />
              <Route path="/pricebook" component={PriceBook} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/finance" component={Finance} />
              <Route path="/marketing" component={Marketing} />
              <Route path="/scratchpad" component={ScratchPad} />
              <Route path="/contractors" component={Contractors} />   {/* ← NEW (FIX 3) */}
              <Route>
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
                  <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
                </div>
              </Route>
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <ServicesProvider>
            <QuoteProvider>
              <Toaster />
              <Router hook={useHashLocation}>
                <AppLayout />
              </Router>
            </QuoteProvider>
          </ServicesProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
