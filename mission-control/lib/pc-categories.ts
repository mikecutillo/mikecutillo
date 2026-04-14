import type { AppCategory } from './pc-activity'

// ─── Process-name patterns ───────────────────────────────────────────────────
const PROCESS_MAP: [RegExp, AppCategory][] = [
  // Gaming
  [/roblox/i, 'gaming'],
  [/fortnite/i, 'gaming'],
  [/minecraft/i, 'gaming'],
  [/javaw/i, 'gaming'],             // Minecraft Java
  [/steam/i, 'gaming'],
  [/epicgameslauncher/i, 'gaming'],
  [/valorant/i, 'gaming'],
  [/overwatch/i, 'gaming'],
  [/genshinimpact/i, 'gaming'],
  [/terraria/i, 'gaming'],
  [/amongus/i, 'gaming'],
  [/rocketleague/i, 'gaming'],
  [/apexlegends/i, 'gaming'],
  [/leagueoflegends|league/i, 'gaming'],
  [/battlenet/i, 'gaming'],
  [/origin/i, 'gaming'],
  [/gog/i, 'gaming'],

  // Video / Streaming
  [/vlc/i, 'video'],
  [/plex/i, 'video'],
  [/netflix/i, 'video'],
  [/disney/i, 'video'],
  [/hbo/i, 'video'],
  [/mpv/i, 'video'],
  [/mpc-hc/i, 'video'],
  [/wmplayer/i, 'video'],
  [/movies/i, 'video'],

  // Social
  [/discord/i, 'social'],
  [/slack/i, 'social'],
  [/telegram/i, 'social'],
  [/whatsapp/i, 'social'],
  [/signal/i, 'social'],
  [/messenger/i, 'social'],

  // Productivity
  [/winword/i, 'productivity'],
  [/excel/i, 'productivity'],
  [/powerpnt/i, 'productivity'],
  [/onenote/i, 'productivity'],
  [/outlook/i, 'productivity'],
  [/teams/i, 'productivity'],
  [/zoom/i, 'productivity'],
  [/notepad/i, 'productivity'],
  [/code/i, 'productivity'],         // VS Code
  [/devenv/i, 'productivity'],       // Visual Studio
  [/wordpad/i, 'productivity'],
  [/calculator/i, 'productivity'],
  [/paint/i, 'productivity'],
]

// ─── Window-title patterns (for browsers) ────────────────────────────────────
const TITLE_MAP: [RegExp, AppCategory][] = [
  // Video
  [/youtube/i, 'video'],
  [/netflix/i, 'video'],
  [/twitch/i, 'video'],
  [/disney\+/i, 'video'],
  [/hulu/i, 'video'],
  [/hbo\s?max/i, 'video'],
  [/prime\s?video/i, 'video'],
  [/crunchyroll/i, 'video'],

  // Gaming (browser-based)
  [/roblox/i, 'gaming'],
  [/now\.gg/i, 'gaming'],
  [/poki\.com/i, 'gaming'],
  [/coolmathgames/i, 'gaming'],
  [/crazygames/i, 'gaming'],
  [/krunker/i, 'gaming'],
  [/steam/i, 'gaming'],

  // Social
  [/tiktok/i, 'social'],
  [/instagram/i, 'social'],
  [/snapchat/i, 'social'],
  [/facebook/i, 'social'],
  [/twitter|x\.com/i, 'social'],
  [/reddit/i, 'social'],
  [/discord/i, 'social'],
  [/whatsapp/i, 'social'],
  [/messenger/i, 'social'],
  [/tumblr/i, 'social'],

  // Productivity
  [/google\s?docs/i, 'productivity'],
  [/google\s?sheets/i, 'productivity'],
  [/google\s?slides/i, 'productivity'],
  [/google\s?classroom/i, 'productivity'],
  [/khan\s?academy/i, 'productivity'],
  [/wikipedia/i, 'productivity'],
  [/quizlet/i, 'productivity'],
  [/canvas/i, 'productivity'],
  [/schoology/i, 'productivity'],
  [/clever/i, 'productivity'],
  [/ixl/i, 'productivity'],
  [/desmos/i, 'productivity'],
]

const BROWSER_PROCESSES = /^(chrome|msedge|firefox|opera|brave|iexplore)$/i

// ─── Main categorization function ────────────────────────────────────────────
export function categorizeApp(
  processName: string,
  windowTitle?: string,
  customCategories?: Record<string, string>
): AppCategory {
  const proc = (processName || '').replace(/\.exe$/i, '')

  // Custom overrides first
  if (customCategories) {
    const custom = customCategories[proc.toLowerCase()]
    if (custom) return custom as AppCategory
  }

  // Check process name
  for (const [re, cat] of PROCESS_MAP) {
    if (re.test(proc)) return cat
  }

  // If it's a browser, check window title for context
  if (BROWSER_PROCESSES.test(proc) && windowTitle) {
    for (const [re, cat] of TITLE_MAP) {
      if (re.test(windowTitle)) return cat
    }
    return 'browsing'
  }

  // If not a browser but we have a title, still check title patterns
  if (windowTitle) {
    for (const [re, cat] of TITLE_MAP) {
      if (re.test(windowTitle)) return cat
    }
  }

  return 'other'
}

// ─── Category display metadata ───────────────────────────────────────────────
export const CATEGORY_COLORS: Record<AppCategory, string> = {
  gaming:       '#26c26e',
  video:        '#e05c5c',
  social:       '#5e6ad2',
  browsing:     '#3b82f6',
  productivity: '#f5a623',
  other:        'rgba(255,255,255,0.2)',
}

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  gaming:       'Gaming',
  video:        'Video',
  social:       'Social',
  browsing:     'Browsing',
  productivity: 'Productivity',
  other:        'Other',
}
