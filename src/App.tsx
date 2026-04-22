import { Switch, Route, Router, Link, useLocation } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { queryClient } from './lib/queryClient'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { QuoteProvider } from '@/lib/quote-context'
import { ServicesProvider } from '@/lib/services-context'
import { Button } from '@/components/ui/button'
import { useEffect } from 'react'
import { apiGet } from '@/lib/queryClient'
import { CompanySettings } from '@/types'
import {
  applyTheme, clearTheme,
  ALL_NAV_ITEMS, mergeNavItems,
} from '@/lib/theme'
import {
  LayoutDashboard, Calendar, Calculator as CalcIcon, FileText,
  Settings, Sun, Moon, RefreshCw, Users, Briefcase,
  BookOpen, TrendingUp, Megaphone,
} from 'lucide-react'
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

// Map nav id → lucide icon
const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard:     LayoutDashboard,
  contacts:      Users,
  calendar:      Calendar,
  jobs:          Briefcase,
  calculator:    CalcIcon,
  quotes:        FileText,
  subscriptions: RefreshCw,
  finance:       TrendingUp,
  pricebook:     BookOpen,
  leads:         Megaphone,
  settings:      Settings,
}

// ── Theme applicator — runs whenever settings change ─────────────────────────

function ThemeApplicator() {
  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet<CompanySettings>('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!settings?.themeConfig || Object.keys(settings.themeConfig).length === 0) {
      clearTheme()
      return
    }
    applyTheme(settings.themeConfig)
  }, [settings?.themeConfig])

  return null
}

// ── Header ───────────────────────────────────────────────────────────────────

function AppHeader() {
  const { theme, toggleTheme } = useTheme()
  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet<CompanySettings>('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-card px-4" style={{ minHeight: 48 }}>
      <h1 className="text-base font-bold tracking-tight">
        {settings?.companyName ?? 'Knox Exterior Care Co.'}
      </h1>
      <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>
    </header>
  )
}

// ── Dynamic bottom nav ───────────────────────────────────────────────────────

function BottomTabBar() {
  const [location] = useLocation()
  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet<CompanySettings>('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  const visibleItems = mergeNavItems(settings?.navConfig?.items ?? [])
    .filter(item => item.visible)
    .map(item => ALL_NAV_ITEMS.find(n => n.id === item.id)!)
    .filter(Boolean)
    .slice(0, 7)   // hard cap at 7 to prevent overflow

  return (
    <nav
      className="sticky bottom-0 z-50 flex items-center justify-around border-t bg-card"
      style={{ minHeight: 64, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {visibleItems.map(tab => {
        const isActive = tab.path === '/' ? location === '/' : location.startsWith(tab.path)
        const Icon = NAV_ICONS[tab.id] ?? Settings
        return (
          <Link
            key={tab.path}
            href={tab.path}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors min-h-[56px] ${
              isActive ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="h-6 w-6" />
            <span className="truncate max-w-[52px] text-center leading-tight">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

// ── App layout ───────────────────────────────────────────────────────────────

function AppLayout() {
  return (
    <div className="flex flex-col h-[100dvh]">
      <ThemeApplicator />
      <AppHeader />

      <main className="flex-1 overflow-y-auto">
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
          <Route>
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
              <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
            </div>
          </Route>
        </Switch>
      </main>
      <BottomTabBar />
    </div>
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
