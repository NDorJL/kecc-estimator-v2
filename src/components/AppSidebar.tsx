import { useLocation } from 'wouter'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar
} from '@/components/ui/sidebar'
import {
  LayoutDashboard, Users, Calendar, Briefcase, Target,
  FileText, RefreshCw, TrendingUp, Megaphone,
  Calculator, BookOpen, Settings, NotebookPen, HardHat,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/queryClient'
import { CompanySettings } from '@/types'

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { id: 'dashboard',  label: 'Dashboard',     path: '/',             icon: LayoutDashboard },
      { id: 'leads',      label: 'Leads',          path: '/leads',        icon: Target },
      { id: 'contacts',   label: 'Contacts',       path: '/contacts',     icon: Users },
      { id: 'calendar',   label: 'Calendar',       path: '/calendar',     icon: Calendar },
      { id: 'jobs',       label: 'Jobs',           path: '/jobs',         icon: Briefcase },
    ],
  },
  {
    label: 'Business',
    items: [
      { id: 'quotes',        label: 'Quotes',        path: '/quotes',        icon: FileText },
      { id: 'subscriptions', label: 'Subscriptions', path: '/subscriptions', icon: RefreshCw },
      { id: 'finance',       label: 'Finance',       path: '/finance',       icon: TrendingUp },
      { id: 'marketing',     label: 'Marketing',     path: '/marketing',     icon: Megaphone },
      { id: 'contractors',   label: 'Contractors',   path: '/contractors',   icon: HardHat },
    ],
  },
  {
    label: 'Tools',
    items: [
      { id: 'calculator',  label: 'Calculator',  path: '/calculator',  icon: Calculator },
      { id: 'pricebook',   label: 'Price Book',  path: '/pricebook',   icon: BookOpen },
      { id: 'scratchpad',  label: 'Scratch Pad', path: '/scratchpad',  icon: NotebookPen },
    ],
  },
]

export function AppSidebar() {
  const [location] = useLocation()
  const { state } = useSidebar()
  const isCollapsed = state === 'collapsed'

  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ['/settings'],
    queryFn: () => apiGet('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  function isActive(path: string) {
    return path === '/' ? location === '/' : location.startsWith(path)
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      {/* Brand header */}
      <SidebarHeader className="border-b border-sidebar-border px-3 py-2.5">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          {settings?.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt="Company logo"
              className="h-9 w-9 rounded-md object-contain shrink-0 bg-card border border-border/40 p-0.5"
            />
          ) : (
            <div className="h-9 w-9 rounded-md bg-primary flex items-center justify-center shrink-0">
              <span className="text-[11px] font-black text-primary-foreground tracking-tighter">KC</span>
            </div>
          )}
          {!isCollapsed && (
            <div className="flex-1 min-w-0 pl-1">
              <p className="text-xs font-semibold leading-none truncate">
                {settings?.companyName ?? 'Knox Exterior Care'}
              </p>
              <p className="text-[10px] text-sidebar-foreground/50 mt-0.5">CRM</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* Navigation groups */}
      <SidebarContent className="py-2">
        {NAV_GROUPS.map(group => (
          <SidebarGroup key={group.label}>
            {!isCollapsed && (
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-3 mb-1">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {group.items.map(item => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.path)}
                    tooltip={item.label}
                    className={`mx-1 rounded-lg transition-colors ${
                      isActive(item.path)
                        ? 'bg-sidebar-accent text-primary font-semibold'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                    }`}
                  >
                    <a href={`#${item.path}`}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Settings pinned at bottom */}
      <SidebarFooter className="border-t border-sidebar-border py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive('/settings')}
              tooltip="Settings"
              className={`mx-1 rounded-lg transition-colors ${
                isActive('/settings')
                  ? 'bg-sidebar-accent text-primary font-semibold'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
              }`}
            >
              <a href="#/settings">
                <Settings className="h-4 w-4 shrink-0" />
                <span>Settings</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
