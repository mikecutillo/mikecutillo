'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import LLMSwitcher, { type LLMProvider } from './llm-switcher'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LucideIcon } from 'lucide-react'
import {
  CheckSquare,
  FolderKanban,
  Brain,
  FileText,
  Users,
  Building2,
  Bot,
  Briefcase,
  FileSignature,
  ShieldCheck,
  Radar,
  LockKeyhole,
  Code2,
  Zap,
  TrendingUp,
  SlidersHorizontal,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  LayoutGrid,
  Globe,
  HardDrive,
  CreditCard,
  Settings2,
  Router,
  CalendarDays,
  Newspaper,
  Skull,
  Calendar,
  BarChart3,
  Palette,
  GripVertical,
  Pencil,
  Save,
  X,
  Sun,
  Moon,
  BookOpen,
} from 'lucide-react'

type IconName =
  | 'CheckSquare'
  | 'FolderKanban'
  | 'Brain'
  | 'FileText'
  | 'Users'
  | 'Building2'
  | 'Bot'
  | 'Briefcase'
  | 'FileSignature'
  | 'ShieldCheck'
  | 'Radar'
  | 'LockKeyhole'
  | 'Code2'
  | 'Zap'
  | 'TrendingUp'
  | 'SlidersHorizontal'
  | 'Lightbulb'
  | 'Sparkles'
  | 'LayoutGrid'
  | 'Globe'
  | 'HardDrive'
  | 'CreditCard'
  | 'Settings2'
  | 'Router'
  | 'CalendarDays'
  | 'Newspaper'
  | 'Skull'
  | 'Calendar'
  | 'BarChart3'
  | 'Palette'
  | 'BookOpen'

const iconMap: Record<IconName, LucideIcon> = {
  CheckSquare,
  FolderKanban,
  Brain,
  FileText,
  Users,
  Building2,
  Bot,
  Briefcase,
  FileSignature,
  ShieldCheck,
  Radar,
  LockKeyhole,
  Code2,
  Zap,
  TrendingUp,
  SlidersHorizontal,
  Lightbulb,
  Sparkles,
  LayoutGrid,
  Globe,
  HardDrive,
  CreditCard,
  Settings2,
  Router,
  CalendarDays,
  Newspaper,
  Skull,
  Calendar,
  BarChart3,
  Palette,
  BookOpen,
}

/** Per-page semantic accent colors — gives every nav item its own identity */
const ITEM_ACCENT: Record<string, string> = {
  '/office':                       '#3b82f6',  // blue — control center
  '/team':                         '#ec4899',  // pink — people
  '/projects':                     '#8b5cf6',  // purple — projects
  '/tasks':                        '#3b82f6',  // blue — tasks
  '/models':                       '#10b981',  // emerald — AI models
  '/vault':                        '#f59e0b',  // amber — vault / secrets
  '/memory':                       '#8b5cf6',  // purple — memory
  '/docs':                         '#06b6d4',  // cyan — docs
  '/content-hub':                  '#ec4899',  // pink — content hub
  '/news-feed-v2':                 '#f97316',  // orange — news
  '/viral-posts':                  '#ef4444',  // red — viral
  '/contentbot-settings':          '#6b7280',  // gray — settings
  '/cutillo-cloud':                '#3b82f6',  // blue — galaxy map
  '/cloud-command':                '#06b6d4',  // cyan — cloud command
  '/cloud-storage':                '#10b981',  // emerald — storage
  '/cloud-accounts':               '#8b5cf6',  // purple — accounts
  '/household-calendar':           '#06b6d4',  // cyan — calendar
  '/router':                       '#f97316',  // orange — router
  '/utilities/capability-matrix':  '#10b981',  // emerald — AI guide
  '/sandbox':                      '#f59e0b',  // amber — sandbox
  '/spellbook':                     '#a78bfa',  // violet — spellbook
  '/job-pipeline':                 '#22c55e',  // green — jobs
  '/job-pipeline/analytics':       '#22c55e',  // green
  '/answer-bank':                  '#22c55e',  // green — answer bank
  '/approval-queue':               '#f59e0b',  // amber
  '/calendar':                     '#06b6d4',  // cyan
}

type NavItem = {
  id: string
  href: string
  icon: IconName | string
  label: string
}

type NavSection = {
  id: string
  label: string
  color?: string
  items: NavItem[]
}

type SidebarConfig = {
  title: string
  subtitle: string
  statusLabel: string
  avatarImage: string
  avatarFallback: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
}

const sidebarDefaults: SidebarConfig = {
  title: 'turbodot',
  subtitle: 'mission control',
  statusLabel: 'live',
  avatarImage: '',
  avatarFallback: 'T',
  defaultWidth: 244,
  minWidth: 188,
  maxWidth: 360,
}

const defaultNavSections: NavSection[] = [
  {
    id: 'section-city',
    label: 'City',
    color: '#7c8cff',
    items: [
      { id: 'nav-office', href: '/office', icon: 'Building2', label: 'Control Center' },
      { id: 'nav-team', href: '/team', icon: 'Users', label: 'People' },
      { id: 'nav-projects', href: '/projects', icon: 'FolderKanban', label: 'Projects' },
      { id: 'nav-tasks', href: '/tasks', icon: 'CheckSquare', label: 'Tasks' },
      { id: 'nav-models', href: '/models', icon: 'Bot', label: 'Models' },
      { id: 'nav-vault', href: '/vault', icon: 'LockKeyhole', label: 'Vault' },
      { id: 'nav-memory', href: '/memory', icon: 'Brain', label: 'Memory' },
      { id: 'nav-docs', href: '/docs', icon: 'FileText', label: 'Docs' },
    ],
  },
  {
    id: 'section-social-ai',
    label: 'SOCIAL.AI',
    color: '#ec4899',
    items: [
      { id: 'nav-content-hub', href: '/content-hub', icon: 'Sparkles', label: 'Content Hub' },
      { id: 'nav-news-feed', href: '/news-feed-v2', icon: 'Newspaper', label: 'News Feed' },
      { id: 'nav-viral-posts', href: '/viral-posts', icon: 'Zap', label: 'Viral Posts' },
      { id: 'nav-content-settings', href: '/contentbot-settings', icon: 'SlidersHorizontal', label: 'Settings & Profiles' },
    ],
  },
  {
    id: 'section-control-center',
    label: 'Cutillo Cloud',
    color: '#5eead4',
    items: [
      { id: 'nav-cloud-map', href: '/cutillo-cloud', icon: 'Globe', label: 'Galaxy Map' },
      { id: 'nav-cloud-command', href: '/cloud-command', icon: 'LayoutGrid', label: 'Cloud Command' },
      { id: 'nav-cloud-storage', href: '/cloud-storage', icon: 'HardDrive', label: 'Storage Core' },
      { id: 'nav-cloud-accounts', href: '/cloud-accounts', icon: 'Settings2', label: 'Accounts & Subs' },
      { id: 'nav-calendar', href: '/household-calendar', icon: 'CalendarDays', label: 'Household Calendar' },
      { id: 'nav-router', href: '/router', icon: 'Router', label: 'Router' },
    ],
  },
  {
    id: 'section-utilities',
    label: 'Utilities',
    color: '#f59e0b',
    items: [
      { id: 'nav-spellbook', href: '/spellbook', icon: 'Sparkles', label: 'SpellBook' },
      { id: 'nav-capability-matrix', href: '/utilities/capability-matrix', icon: 'Bot', label: 'AI Capability Guide' },
      { id: 'nav-sandbox', href: '/sandbox', icon: 'Code2', label: 'HTML Sandbox' },
    ],
  },
  {
    id: 'section-unemployment',
    label: 'Unemployment',
    color: '#22c55e',
    items: [
      { id: 'nav-job-pipeline', href: '/job-pipeline', icon: 'Briefcase', label: 'Job Pipeline' },
      { id: 'nav-resumes', href: '/resume-workshop', icon: 'FileSignature', label: 'Resumes' },
      { id: 'nav-approvals', href: '/approval-queue', icon: 'ShieldCheck', label: 'Approvals' },
      { id: 'nav-scout', href: '/scout-config', icon: 'Radar', label: 'Scout' },
      { id: 'nav-reports', href: '/unemployment-reports', icon: 'TrendingUp', label: 'Reports' },
    ],
  },
  {
    id: 'section-labs',
    label: 'Labs',
    color: '#a78bfa',
    items: [
      { id: 'nav-ai-tasks', href: '/ai-capability-matrix', icon: 'Bot', label: 'AI Tasks' },
      { id: 'nav-iba', href: '/iba', icon: 'Sparkles', label: 'IBA' },
      { id: 'nav-hue-lights', href: '/hue-lights', icon: 'Lightbulb', label: 'HUE Lights' },
      { id: 'nav-google-command', href: '/google-command-center', icon: 'LayoutGrid', label: 'Google Command Center' },
      { id: 'nav-m365', href: '/m365', icon: 'LayoutGrid', label: 'M365' },
    ],
  },
  {
    id: 'section-graveyard',
    label: 'Graveyard',
    color: '#f87171',
    items: [
      { id: 'nav-social-news', href: '/social-news', icon: 'Skull', label: 'Social News' },
      { id: 'nav-content-analytics', href: '/content-analytics', icon: 'BarChart3', label: 'Content Analytics' },
      { id: 'nav-branding', href: '/branding', icon: 'Palette', label: 'Branding' },

      { id: 'nav-cloud-subscriptions', href: '/cloud-subscriptions', icon: 'CreditCard', label: 'Cloud Subscriptions' },
    ],
  },
]

function normalizeSections(sections: NavSection[]): NavSection[] {
  return sections.map((section, sectionIndex) => ({
    id: String(section.id || `section-${sectionIndex + 1}`),
    label: String(section.label || `Section ${sectionIndex + 1}`),
    color: section.color || defaultNavSections[sectionIndex % defaultNavSections.length]?.color || '#7c8cff',
    items: Array.isArray(section.items)
      ? section.items.map((item, itemIndex) => ({
          id: String(item.id || `${section.id || `section-${sectionIndex + 1}`}-item-${itemIndex + 1}`),
          href: String(item.href || '#'),
          icon: String(item.icon || 'LayoutGrid'),
          label: String(item.label || `Item ${itemIndex + 1}`),
        }))
      : [],
  }))
}

function findSectionByItemId(sections: NavSection[], itemId: string) {
  return sections.find(section => section.items.some(item => item.id === itemId))
}

function getIcon(iconName: string): LucideIcon {
  return iconMap[(iconName as IconName)] || LayoutGrid
}

function mixColor(hex: string, alpha: number) {
  if (!hex.startsWith('#')) return `rgba(124, 140, 255, ${alpha})`
  const raw = hex.slice(1)
  const normalized = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function miniActionButtonStyle(color: string) {
  return {
    width: 20,
    height: 20,
    borderRadius: 5,
    border: `1px solid ${mixColor(color, 0.42)}`,
    background: mixColor(color, 0.16),
    color: '#f5f7ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  } as const
}

const miniGhostButtonStyle = {
  width: 20,
  height: 20,
  borderRadius: 5,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
} as const

function SortableNavItem({
  item,
  sectionColor,
  pathname,
  navCollapsed,
  editingItemId,
  itemDraft,
  setItemDraft,
  startEditItem,
  saveItem,
  cancelEdit,
}: {
  item: NavItem
  sectionColor: string
  pathname: string
  navCollapsed: boolean
  editingItemId: string | null
  itemDraft: string
  setItemDraft: (value: string) => void
  startEditItem: (item: NavItem) => void
  saveItem: (itemId: string) => void
  cancelEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  const Icon = getIcon(item.icon)
  const itemColor = ITEM_ACCENT[item.href] ?? sectionColor
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.66 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: navCollapsed ? 0 : 6,
          padding: navCollapsed ? '0' : '0 4px 0 2px',
          marginBottom: 2,
          borderRadius: 8,
          background: isActive ? mixColor(itemColor, 0.14) : isDragging ? mixColor(itemColor, 0.10) : 'transparent',
          border: `1px solid ${isActive ? mixColor(itemColor, 0.36) : 'transparent'}`,
          boxShadow: isActive ? `inset 0 0 0 1px ${mixColor(itemColor, 0.07)}` : 'none',
        }}
      >
        {!navCollapsed && (
          <button
            {...attributes}
            {...listeners}
            title="Drag menu item"
            style={{
              width: 18,
              height: 28,
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.24)',
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <GripVertical size={12} />
          </button>
        )}

        <Link
          href={item.href}
          title={item.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: navCollapsed ? 'center' : 'flex-start',
            gap: 8,
            width: '100%',
            padding: navCollapsed ? '8px 0' : '6px 8px',
            borderRadius: 7,
            color: isActive ? 'var(--nav-text-active)' : 'var(--nav-text)',
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: isActive ? 700 : 500,
            minWidth: 0,
          }}
        >
          <Icon size={14} style={{ flexShrink: 0, color: isActive ? itemColor : mixColor(itemColor, 0.75), opacity: isActive ? 1 : 0.88 }} />
          {!navCollapsed && (
            editingItemId === item.id ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }} onClick={e => e.preventDefault()}>
                <input
                  value={itemDraft}
                  onChange={e => setItemDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveItem(item.id)
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    }
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: '#0f141d',
                    border: `1px solid ${mixColor(sectionColor, 0.45)}`,
                    color: '#f5f7ff',
                    borderRadius: 6,
                    padding: '4px 6px',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                <button onClick={e => { e.preventDefault(); saveItem(item.id) }} style={miniActionButtonStyle(sectionColor)}><Save size={11} /></button>
                <button onClick={e => { e.preventDefault(); cancelEdit() }} style={miniGhostButtonStyle}><X size={11} /></button>
              </span>
            ) : (
              <>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{item.label}</span>
                <button
                  onClick={e => {
                    e.preventDefault()
                    startEditItem(item)
                  }}
                  title="Rename menu item"
                  style={miniGhostButtonStyle}
                >
                  <Pencil size={11} />
                </button>
              </>
            )
          )}
        </Link>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [sections, setSections] = useState<NavSection[]>(defaultNavSections)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [sectionDraft, setSectionDraft] = useState('')
  const [itemDraft, setItemDraft] = useState('')
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [sidebarConfig, setSidebarConfig] = useState<SidebarConfig>(sidebarDefaults)
  const [sidebarWidth, setSidebarWidth] = useState(sidebarDefaults.defaultWidth)
  const [isResizing, setIsResizing] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    const stored = window.localStorage.getItem('mission-control-sidebar-collapsed')
    if (stored === '1') setNavCollapsed(true)
    const width = Number(window.localStorage.getItem('mission-control-sidebar-width') || '')
    if (Number.isFinite(width) && width > 0) setSidebarWidth(width)
    // Restore theme
    const savedTheme = window.localStorage.getItem('turbodot-theme') as 'dark' | 'light' | null
    if (savedTheme === 'light') {
      setTheme('light')
      document.documentElement.classList.add('light')
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    window.localStorage.setItem('turbodot-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', navCollapsed ? '52px' : `${sidebarWidth}px`)
    window.localStorage.setItem('mission-control-sidebar-collapsed', navCollapsed ? '1' : '0')
    if (!navCollapsed) window.localStorage.setItem('mission-control-sidebar-width', String(sidebarWidth))
  }, [navCollapsed, sidebarWidth])

  useEffect(() => {
    let active = true
    async function loadNavigation() {
      try {
        const response = await fetch('/api/navigation')
        if (!response.ok) throw new Error('Failed to load navigation')
        const data = (await response.json()) as NavSection[]
        if (active) setSections(normalizeSections(data.length ? data : defaultNavSections))
      } catch {
        if (active) setSections(normalizeSections(defaultNavSections))
      } finally {
        if (active) setLoading(false)
      }
    }
    loadNavigation()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    async function loadSidebarConfig() {
      try {
        const response = await fetch('/api/sidebar-config')
        if (!response.ok) throw new Error('Failed to load sidebar config')
        const data = (await response.json()) as SidebarConfig
        if (!active) return
        setSidebarConfig(data)
        setSidebarWidth(prev => {
          const hasStored = Number(window.localStorage.getItem('mission-control-sidebar-width') || '')
          return Number.isFinite(hasStored) && hasStored > 0 ? clamp(hasStored, data.minWidth, data.maxWidth) : data.defaultWidth
        })
      } catch {
        if (active) setSidebarConfig(sidebarDefaults)
      }
    }
    loadSidebarConfig()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (navCollapsed || !isResizing) return
    function onMove(event: PointerEvent) {
      setSidebarWidth(clamp(event.clientX, sidebarConfig.minWidth, sidebarConfig.maxWidth))
    }
    function onUp() {
      setIsResizing(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [isResizing, navCollapsed, sidebarConfig.maxWidth, sidebarConfig.minWidth])

  const sectionIds = useMemo(() => sections.map(section => section.id), [sections])

  async function persistSections(nextSections: NavSection[]) {
    setSections(nextSections)
    setSaving(true)
    try {
      const response = await fetch('/api/navigation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSections),
      })
      if (!response.ok) throw new Error('Failed to save navigation')
      const result = await response.json()
      setSections(normalizeSections(result.sections || nextSections))
    } catch (error) {
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const toggleSection = (sectionId: string) =>
    setCollapsedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }))

  function startEditSection(section: NavSection) {
    setEditingItemId(null)
    setEditingSectionId(section.id)
    setSectionDraft(section.label)
  }

  function startEditItem(item: NavItem) {
    setEditingSectionId(null)
    setEditingItemId(item.id)
    setItemDraft(item.label)
  }

  async function saveSection(sectionId: string) {
    const trimmed = sectionDraft.trim()
    if (!trimmed) return
    const nextSections = sections.map(section => section.id === sectionId ? { ...section, label: trimmed } : section)
    setEditingSectionId(null)
    await persistSections(nextSections)
  }

  async function saveItem(itemId: string) {
    const trimmed = itemDraft.trim()
    if (!trimmed) return
    const nextSections = sections.map(section => ({
      ...section,
      items: section.items.map(item => item.id === itemId ? { ...item, label: trimmed } : item),
    }))
    setEditingItemId(null)
    await persistSections(nextSections)
  }

  function cancelEdit() {
    setEditingItemId(null)
    setEditingSectionId(null)
    setItemDraft('')
    setSectionDraft('')
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveItemId(String(event.active.id))
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    const activeSection = findSectionByItemId(sections, activeId)
    if (!activeSection) return
    const overSection = sections.find(section => section.id === overId) || findSectionByItemId(sections, overId)
    if (!overSection || activeSection.id === overSection.id) return
    const activeItem = activeSection.items.find(item => item.id === activeId)
    if (!activeItem) return

    setSections(prev => {
      const source = findSectionByItemId(prev, activeId)
      const target = prev.find(section => section.id === overSection.id) || findSectionByItemId(prev, overId)
      if (!source || !target || source.id === target.id) return prev
      const sourceItems = source.items.filter(item => item.id !== activeId)
      const targetItems = [...target.items]
      const targetIndex = target.items.findIndex(item => item.id === overId)
      const insertAt = targetIndex >= 0 ? targetIndex : targetItems.length
      targetItems.splice(insertAt, 0, activeItem)
      return prev.map(section => {
        if (section.id === source.id) return { ...section, items: sourceItems }
        if (section.id === target.id) return { ...section, items: targetItems }
        return section
      })
    })
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveItemId(null)
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    let nextSections = sections
    const activeSection = findSectionByItemId(sections, activeId)
    const overSection = sections.find(section => section.id === overId) || findSectionByItemId(sections, overId)
    if (!activeSection || !overSection) return

    if (activeSection.id === overSection.id) {
      const oldIndex = activeSection.items.findIndex(item => item.id === activeId)
      const newIndex = activeSection.items.findIndex(item => item.id === overId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      nextSections = sections.map(section =>
        section.id === activeSection.id
          ? { ...section, items: arrayMove(section.items, oldIndex, newIndex) }
          : section
      )
    }

    await persistSections(nextSections)
  }

  const avatar = sidebarConfig.avatarImage?.trim()
  const sidebarLiveLabel = loading ? 'loading' : saving ? 'saving...' : activeItemId ? 'moving' : sidebarConfig.statusLabel || 'live'

  return (
    <div
      style={{
        position: 'relative',
        width: navCollapsed ? '52px' : `${sidebarWidth}px`,
        minWidth: navCollapsed ? '52px' : `${sidebarWidth}px`,
        height: '100vh',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: isResizing ? 'none' : 'width 0.18s ease, min-width 0.18s ease',
        boxShadow: 'inset -1px 0 0 rgba(128,128,180,0.04)',
      }}
    >
      <div style={{ padding: navCollapsed ? '9px 7px' : '9px 10px', borderBottom: '1px solid var(--sidebar-header-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: navCollapsed ? 'center' : 'space-between', gap: '8px' }}>
          {/* Brand mark — always visible */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M8 0.5L14.928 4.5V11.5L8 15.5L1.072 11.5V4.5L8 0.5Z" fill="#5E6AD2" opacity="0.9"/>
              <path d="M8 4L12 6.5V11L8 13.5L4 11V6.5L8 4Z" fill="#06080d" opacity="0.65"/>
              <path d="M8 6.5L10.5 8V11L8 12.5L5.5 11V8L8 6.5Z" fill="#5E6AD2" opacity="0.55"/>
            </svg>
            {!navCollapsed && (
              <span style={{
                fontSize: '10px',
                fontWeight: 800,
                color: '#5E6AD2',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-display, inherit)',
                userSelect: 'none',
              }}>
                TurboDot
              </span>
            )}
          </div>
          {!navCollapsed && (
            <button
              onClick={() => setNavCollapsed(true)}
              title="Collapse sidebar"
              style={{
                width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: '#11141c',
                color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <PanelLeftClose size={13} />
            </button>
          )}
        </div>
      </div>

      <nav style={{ padding: navCollapsed ? '6px 5px' : '8px 6px', flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          {sections.map(section => {
            const isSectionCollapsed = !!collapsedSections[section.id]
            const accent = section.color || '#7c8cff'
            return (
              <div
                key={section.id}
                style={{
                  marginBottom: navCollapsed ? 0 : 4,
                  borderRadius: 12,
                  background: navCollapsed ? 'transparent' : `linear-gradient(180deg, ${mixColor(accent, 0.09)} 0%, rgba(255,255,255,0.015) 100%)`,
                  border: navCollapsed ? 'none' : `1px solid ${mixColor(accent, 0.16)}`,
                  boxShadow: navCollapsed ? 'none' : `inset 0 1px 0 ${mixColor(accent, 0.08)}`,
                  padding: navCollapsed ? 0 : '4px 4px 5px',
                }}
              >
                {!navCollapsed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 3px 5px 3px' }}>
                    <button
                      onClick={() => toggleSection(section.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0 }}
                    >
                      {editingSectionId === section.id ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }} onClick={e => e.stopPropagation()}>
                          <input
                            value={sectionDraft}
                            onChange={e => setSectionDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                saveSection(section.id)
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEdit()
                              }
                            }}
                            autoFocus
                            style={{
                              flex: 1,
                              minWidth: 0,
                              background: '#0f141d',
                              border: `1px solid ${mixColor(accent, 0.45)}`,
                              color: '#f5f7ff',
                              borderRadius: 6,
                              padding: '4px 6px',
                              fontSize: 11,
                              outline: 'none',
                              textTransform: 'uppercase',
                              letterSpacing: '0.08em',
                            }}
                          />
                          <button onClick={e => { e.preventDefault(); e.stopPropagation(); saveSection(section.id) }} style={miniActionButtonStyle(accent)}><Save size={11} /></button>
                          <button onClick={e => { e.preventDefault(); e.stopPropagation(); cancelEdit() }} style={miniGhostButtonStyle}><X size={11} /></button>
                        </span>
                      ) : (
                        <>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 999, background: accent, boxShadow: `0 0 12px ${mixColor(accent, 0.5)}` }} />
                            <span style={{ fontSize: '9px', fontWeight: 800, color: mixColor(accent, 0.94), textTransform: 'uppercase', letterSpacing: '0.14em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {section.label}
                            </span>
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', transform: isSectionCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                          </span>
                        </>
                      )}
                    </button>

                    {editingSectionId !== section.id && (
                      <button onClick={() => startEditSection(section)} title="Rename section" style={miniGhostButtonStyle}>
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                )}

                {(!isSectionCollapsed || navCollapsed) && (
                  <SortableContext items={section.items.map(item => item.id)} strategy={verticalListSortingStrategy}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: navCollapsed ? 2 : 1 }}>
                      {section.items.map(item => (
                        <SortableNavItem
                          key={item.id}
                          item={item}
                          sectionColor={accent}
                          pathname={pathname}
                          navCollapsed={navCollapsed}
                          editingItemId={editingItemId}
                          itemDraft={itemDraft}
                          setItemDraft={setItemDraft}
                          startEditItem={startEditItem}
                          saveItem={saveItem}
                          cancelEdit={cancelEdit}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </div>
            )
          })}
          <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
            <></>
          </SortableContext>
        </DndContext>
      </nav>

      <div style={{ padding: navCollapsed ? '8px 6px' : '9px 8px', borderTop: '1px solid var(--sidebar-header-border)', display: 'flex', flexDirection: navCollapsed ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {!navCollapsed ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <LLMSwitcher
              onProviderChange={(provider: LLMProvider, endpoint: string) => {
                window.dispatchEvent(new CustomEvent('llm-provider-change', { detail: { provider, endpoint } }))
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setNavCollapsed(false)}
            title="Expand sidebar"
            style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--sidebar-border)', background: 'var(--surface)', color: 'var(--nav-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <PanelLeftOpen size={14} />
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: theme === 'light' ? 'rgba(94,106,210,0.1)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${theme === 'light' ? 'rgba(94,106,210,0.25)' : 'rgba(255,255,255,0.08)'}`,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme === 'light' ? '#5E6AD2' : 'rgba(255,255,255,0.5)',
            transition: 'all 0.15s',
          }}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        <button
          onClick={() => window.dispatchEvent(new CustomEvent('turbo-chat-toggle'))}
          title="Open chat"
          style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: 'rgba(38,194,110,0.09)', border: '1px solid rgba(38,194,110,0.18)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(38,194,110,0.18)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(38,194,110,0.09)' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>

      {!navCollapsed && (
        <button
          onPointerDown={() => setIsResizing(true)}
          title="Resize sidebar"
          style={{
            position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'ew-resize',
            background: isResizing ? 'rgba(124,140,255,0.18)' : 'transparent', border: 'none', padding: 0,
          }}
        />
      )}
    </div>
  )
}
