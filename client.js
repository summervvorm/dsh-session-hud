/**
 * dsh-session-hud — Client half.
 *
 * Renders one floating panel in the frame-wide `shell.overlay` slot. The model
 * it shows is the framework's own Session status (`running`,
 * `pendingInteraction`, `completionUnread`) handed to root-scoped slots as the
 * `useSessionStatus` hook prop — the same source the sidebar's completion dot
 * reads. Openeding a Session clears its `completionUnread` there, so "打开即
 * 已读" needs no bookkeeping of ours and costs one subscription.
 *
 * The Host SSE stream stays as a fallback for a composition whose root slot
 * props do not expose that hook.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-hud',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-session-hud'
    const ENDPOINT = '/plugins/dsh-session-hud/events'
    const REPORT_ENDPOINT = '/plugins/dsh-session-hud/active'
    const STATE_ENDPOINT = '/plugins/dsh-session-hud/state'
    const POSITION_KEY = 'dsh-session-hud:position:v1'
    const DISMISS_KEY = 'dsh-session-hud:dismissed:v1'
    const MAX_ACTIVE_ROWS = 6
    const MAX_ALERT_ROWS = 6
    const MAX_DISMISSED = 200
    /** Mirrors the Host defaults: an unreachable `/state` must not switch motion off. */
    const DEFAULT_ANIMATIONS = { expandAnimation: true, sessionAlert: true, completionAlert: true }
    /** One width for both states, so opening the panel never moves the pill. */
    const PANEL_WIDTH = 292
    const ANCHOR_TOP = 56
    const ANCHOR_RIGHT = 14
    /** Frame-wide top layer while the HUD is pinned above every host surface. */
    const PINNED_Z = 2147483000
    /** Ordinary overlay layer when the pin is off, so host chrome may cover it. */
    const NORMAL_Z = 900
    /** Unpinned, the HUD stays clear of the window title bar instead of landing on it. */
    const TITLEBAR_SAFE = 44
    const DRAG_THRESHOLD = 5
    const EDGE_INSET = 4

    const DICTS = {
      zh: {
        'hud.title': '会话状态',
        'hud.toggle': '展开或收起会话状态',
        'hud.drag': '拖动可移动位置',
        'hud.idle': '空闲',
        'hud.running': '进行中',
        'hud.waiting': '等待确认',
        'hud.completed': '已完成',
        'hud.read': '全部已读',
        'hud.hint': '打开会话即视为已读',
        'hud.total': '累计完成',
        'hud.untitled': '未命名会话',
        'hud.more': '还有 %d 个',
        'hud.state.thinking': '思考中',
        'hud.state.tool': '执行工具',
        'hud.state.approval': '等待审批',
        'hud.state.question': '等待回答',
        'hud.state.blocked': '等待确认',
        'hud.state.completed': '已完成',
        'hud.state.aborted': '已停止',
        'hud.state.max-tokens': '上下文已满',
        'hud.state.error': '出错',
        'hud.empty': '当前没有进行中的会话',
      },
      en: {
        'hud.title': 'Session status',
        'hud.toggle': 'Expand or collapse session status',
        'hud.drag': 'Drag to move',
        'hud.idle': 'idle',
        'hud.running': 'running',
        'hud.waiting': 'waiting',
        'hud.completed': 'completed',
        'hud.read': 'Mark all read',
        'hud.hint': 'Open a session to read it',
        'hud.total': 'Completed turns',
        'hud.untitled': 'Untitled session',
        'hud.more': '%d more',
        'hud.state.thinking': 'Thinking',
        'hud.state.tool': 'Running tool',
        'hud.state.approval': 'Waiting for approval',
        'hud.state.question': 'Waiting for answer',
        'hud.state.blocked': 'Waiting for you',
        'hud.state.completed': 'Completed',
        'hud.state.aborted': 'Stopped',
        'hud.state.max-tokens': 'Context full',
        'hud.state.error': 'Failed',
        'hud.empty': 'No active sessions',
      },
    }

    const token = {
      surface: 'var(--dsw-alias-bg-overlay)',
      border: 'var(--dsw-alias-border-l1)',
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const wrapStyle = {
      position: 'fixed',
      zIndex: 2147482000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 8,
      width: PANEL_WIDTH,
      maxWidth: 'calc(100vw - 32px)',
      // Only the children take the pointer; the empty frame stays click-through.
      pointerEvents: 'none',
      fontFamily: 'inherit',
      fontSize: 12,
      lineHeight: 1.4,
      color: token.primary,
      userSelect: 'none',
      touchAction: 'none',
    }

    const pillStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 11px',
      borderRadius: 999,
      border: `1px solid ${token.border}`,
      background: token.surface,
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
      color: token.primary,
      font: 'inherit',
      fontSize: 12,
      // One line box for every child of the pill. Without it the text sits in a
      // 16.8px line (1.4 × 12) while a fixed-height badge sits in 16px, and the
      // two rows start drifting apart at the top and bottom edges.
      lineHeight: '18px',
      cursor: 'grab',
      pointerEvents: 'auto',
    }

    const panelStyle = {
      width: '100%',
      display: 'grid',
      gap: 8,
      padding: '10px 12px',
      borderRadius: 12,
      border: `1px solid ${token.border}`,
      background: token.surface,
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
      pointerEvents: 'auto',
      boxSizing: 'border-box',
    }

    const headStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }
    const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 1 }
    const rowStyle = { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }
    /** Rows get a 2px halo so hover/flash has something to paint inside. */
    const actionRowStyle = { ...rowStyle, padding: '2px 4px' }
    const labelStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
    const metaStyle = { color: token.secondary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
    const idStyle = { marginLeft: 5, color: token.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 11 }
    const sectionStyle = { color: token.secondary, fontSize: 11, letterSpacing: '0.02em' }
    const hintStyle = { color: token.secondary, fontSize: 11 }
    const readButtonStyle = {
      border: `1px solid ${token.border}`,
      background: 'transparent',
      color: token.primary,
      borderRadius: 8,
      padding: '2px 8px',
      font: 'inherit',
      fontSize: 11,
      cursor: 'pointer',
    }

    function dot(color, live) {
      return {
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        flex: 'none',
        animation: live ? 'dsh-hud-pulse 1.8s ease-in-out infinite' : 'none',
      }
    }

    const DOT_RUNNING = dot(token.brand, true)
    const DOT_WAITING = dot(token.warn, false)
    const DOT_DONE = dot(token.success, false)
    const DOT_FAILED = dot(token.error, false)
    const DOT_IDLE = dot('var(--dsw-alias-state-idle-primary)', false)

    const badgeStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 6px',
      borderRadius: 999,
      background: token.success,
      color: '#fff',
      fontWeight: 600,
      fontSize: 11,
      // Same 18px box as the pill's text row, and `border-box` so the padding
      // does not add height. Top and bottom edges then land on the same lines.
      lineHeight: '18px',
      height: 18,
      boxSizing: 'border-box',
    }

    function HudStyles() {
      return h('style', null, [
        '@keyframes dsh-hud-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }',
        '@keyframes dsh-hud-flash { from { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent) } to { background: transparent } }',
        '@keyframes dsh-hud-pop { 0% { transform: scale(1) } 40% { transform: scale(1.16) } 100% { transform: scale(1) } }',
        '.dsh-hud-pill { transition: background .12s ease, border-color .12s ease, box-shadow .12s ease; }',
        // The window title bar is an Electron drag region: an overlay parked on
        // it still paints on top, but the OS takes the press for a window drag
        // and the page never sees it. Opting the whole frame out restores clicks.
        '.dsh-hud-root, .dsh-hud-root * { -webkit-app-region: no-drag; }',
        '.dsh-hud-pill:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-overlay)); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-border-l1)); }',
        '.dsh-hud-pill:active { cursor: grabbing; }',
        '.dsh-hud-pill:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
        '.dsh-hud-panel { transform-origin: top right; }',
        // `visibility` rides along on a delay so the close animation still plays,
        // yet a closed panel is out of the tab order the moment it is closed.
        '.dsh-hud-panel[data-animated="true"] { transition: opacity .16s ease, transform .16s ease, visibility 0s linear .16s; }',
        '.dsh-hud-panel[data-animated="true"][data-open="true"] { transition: opacity .16s ease, transform .16s ease, visibility 0s linear 0s; }',
        '.dsh-hud-panel[data-open="false"] { opacity: 0; transform: translateY(-6px) scale(.985); pointer-events: none; visibility: hidden; }',
        '.dsh-hud-row { border-radius: 6px; transition: background .12s ease; }',
        '.dsh-hud-row[data-clickable="true"]:hover { background: color-mix(in srgb, currentColor 7%, transparent); }',
        '.dsh-hud-row[data-clickable="true"]:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
        '.dsh-hud-row[data-flash="true"] { animation: dsh-hud-flash .9s ease-out; }',
        '.dsh-hud-badge[data-flash="true"] { animation: dsh-hud-pop .45s ease-out; }',
        '.dsh-hud-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
        // Scope the motion opt-out to the whole HUD: the collapsed pill used to be
        // the only covered subtree, so panel rows kept pulsing under reduce.
        '@media (prefers-reduced-motion: reduce) { .dsh-hud-root, .dsh-hud-root * { animation: none !important; transition: none !important; } }',
      ].join('\n'))
    }

    function localeService(ctx) {
      try {
        if (ctx && typeof ctx.get === 'function') {
          const service = ctx.get('locale')
          if (service) return service
        }
      } catch {
        // A restricted context without get() falls through to the property.
      }
      return ctx?.locale
    }

    function useLocaleRevision(locale) {
      const [revision, bump] = useState(0)
      useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        try {
          return locale.subscribe(() => bump((value) => value + 1))
        } catch {
          return undefined
        }
      }, [locale])
      return revision
    }

    function useTranslator(locale, activeLocale) {
      return useMemo(() => {
        const preferred = activeLocale.startsWith('en') ? DICTS.en : DICTS.zh
        const fallback = (key) => preferred[key] ?? DICTS.zh[key] ?? DICTS.en[key] ?? key
        if (locale && typeof locale.bind === 'function') {
          try {
            const bound = locale.bind(NS)
            if (typeof bound === 'function') {
              return (key) => {
                const text = bound(key)
                return typeof text === 'string' && text !== key ? text : fallback(key)
              }
            }
          } catch {
            // Fall back to the built-in copy below.
          }
        }
        return fallback
      }, [locale, activeLocale])
    }

    /** The system-wide "reduce motion" setting; false where matchMedia is absent. */
    function useReducedMotion() {
      const read = () => {
        try {
          return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        } catch {
          return false
        }
      }
      const [reduced, setReduced] = useState(read)
      useEffect(() => {
        let query
        try {
          query = window.matchMedia('(prefers-reduced-motion: reduce)')
        } catch {
          return undefined
        }
        const onChange = (event) => setReduced(event.matches)
        if (typeof query.addEventListener !== 'function') return undefined
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
      }, [])
      return reduced
    }

    // ── geometry ────────────────────────────────────────────────────────────
    function readPosition() {
      try {
        const raw = window.localStorage.getItem(POSITION_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return { x: parsed.x, y: parsed.y }
      } catch {
        // A corrupted or unavailable store means "use the default corner".
      }
      return null
    }

    function writePosition(position) {
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(position))
      } catch {
        // Persisting is best effort.
      }
    }

    function clampPosition(position, width, height, minTop = EDGE_INSET) {
      const viewportWidth = Number(window.innerWidth) || 0
      const viewportHeight = Number(window.innerHeight) || 0
      const maxX = Math.max(EDGE_INSET, viewportWidth - width - EDGE_INSET)
      const maxY = Math.max(minTop, viewportHeight - height - EDGE_INSET)
      return {
        x: Math.min(Math.max(EDGE_INSET, position.x), maxX),
        y: Math.min(Math.max(minTop, position.y), maxY),
      }
    }

    // ── dismissal, fallback stream only ─────────────────────────────────────
    function readDismissed() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? 'null')
        if (parsed && typeof parsed.epoch === 'string' && Array.isArray(parsed.ids)) {
          return { epoch: parsed.epoch, ids: parsed.ids.filter((id) => typeof id === 'string') }
        }
      } catch {
        // Ignore a broken value.
      }
      return { epoch: '', ids: [] }
    }

    function writeDismissed(value) {
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify(value))
      } catch {
        // Persisting is best effort.
      }
    }

    // ── view builder ────────────────────────────────────────────────────────
    function cleanLabel(value) {
      const text = String(value ?? '').trim().replace(/\s+/gu, ' ')
      if (!text) return ''
      const parts = text.split(/[\\/]/u).filter(Boolean)
      const candidate = parts.length > 1 ? parts[parts.length - 1] : text
      return candidate.slice(0, 64)
    }

    function shortIdOf(sessionId) {
      return String(sessionId ?? '').replace(/^session-/u, '').slice(-4)
    }

    function buildFromStream(snapshot, dismissed) {
      const counts = snapshot?.counts ?? { running: 0, waiting: 0, completed: 0 }
      const epoch = snapshot?.epoch ?? ''
      const hidden = dismissed.epoch === epoch ? new Set(dismissed.ids) : new Set()
      const active = (Array.isArray(snapshot?.sessions) ? snapshot.sessions : [])
        .filter((session) => session && session.state !== 'idle')
        .map((session) => ({
          id: session.id,
          label: cleanLabel(session.label) || shortIdOf(session.id),
          state: session.state === 'waiting' ? 'waiting' : 'running',
          detail: String(session.detail ?? ''),
          // When this Session entered its current non-idle state; the Host has
          // always published it, the old mapping just dropped it.
          since: Number(session.since) || 0,
        }))
      const alerts = (Array.isArray(snapshot?.completions) ? snapshot.completions : [])
        // Keyed by Session *and* completion: reading one completion must not hide
        // the next one the same Session produces.
        .filter((entry) => entry && !hidden.has(`${entry.sessionId}#${entry.seq}`))
        .map((entry) => ({
          key: `${entry.sessionId}#${entry.seq}`,
          id: entry.sessionId,
          label: cleanLabel(entry.label) || shortIdOf(entry.sessionId),
          at: Number(entry.at) || 0,
          failed: entry.failed === true,
        }))
      return {
        mode: 'stream',
        running: Number(counts.running ?? 0),
        waiting: Number(counts.waiting ?? 0),
        completed: Number(counts.completed ?? 0),
        active,
        alerts,
      }
    }

    function describe(session, t) {
      const detail = String(session?.detail ?? '')
      if (detail.startsWith('tool:')) return `${t('hud.state.tool')} · ${detail.slice(5)}`
      if (!detail) return session?.state === 'waiting' ? t('hud.waiting') : t('hud.running')
      const key = `hud.state.${detail}`
      const text = t(key)
      return text === key ? t('hud.running') : text
    }

    function clockOf(at) {
      if (!at) return ''
      try {
        return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    /** Elapsed milliseconds → `12s` / `3m05s` / `1h02m`; empty when not yet known. */
    function formatElapsed(ms) {
      if (!Number.isFinite(ms) || ms < 1000) return ''
      const seconds = Math.floor(ms / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
      const hours = Math.floor(minutes / 60)
      return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
    }

    function reportMode(mode, slotProps) {
      try {
        if (typeof fetch !== 'function') return
        fetch(REPORT_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, keys: Object.keys(slotProps ?? {}).slice(0, 40) }),
        }).catch(() => {})
      } catch {
        // Diagnostic only.
      }
    }

    // ── which Session this page shows ───────────────────────────────────────
    // A Session-scoped seat reports the Session the shell has open, so opening
    // a row in the sidebar dismisses that row's alert.
    let activeSessionId = ''
    const activeListeners = new Set()

    function publishActiveSession(sessionId) {
      const next = String(sessionId ?? '')
      if (!next || next === activeSessionId) return
      activeSessionId = next
      for (const listener of activeListeners) {
        try {
          listener(next)
        } catch {
          // One broken listener must not stop the others.
        }
      }
    }

    /** Session-scoped slot props carry the bound Session in one of these fields. */
    function sessionIdOfProps(props) {
      const candidates = [
        props?.sessionId,
        props?.key,
        props?.session?.id,
        props?.session?.header?.id,
        props?.binding?.id,
      ]
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate) return candidate
      }
      return ''
    }

    function SessionProbe({ seat, ...props }) {
      const sessionId = sessionIdOfProps(props)
      const reported = useRef(false)
      useEffect(() => {
        if (sessionId) publishActiveSession(sessionId)
      }, [sessionId])
      useEffect(() => {
        if (reported.current) return
        reported.current = true
        try {
          if (typeof fetch === 'function') {
            fetch(REPORT_ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ mode: `probe:${seat}`, keys: Object.keys(props).slice(0, 40) }),
            }).catch(() => {})
          }
        } catch {
          // Diagnostic only.
        }
      }, [])
      return null
    }

    function useActiveSessionId() {
      const [sessionId, setSessionId] = useState(activeSessionId)
      useEffect(() => {
        const listener = (next) => setSessionId(next)
        activeListeners.add(listener)
        setSessionId(activeSessionId)
        return () => {
          activeListeners.delete(listener)
        }
      }, [])
      return sessionId
    }

    function SessionHud({ ctx, ...slotProps }) {
      const locale = localeService(ctx)
      const localeRevision = useLocaleRevision(locale)
      const activeLocale = useMemo(() => {
        try {
          const snapshot = locale?.getSnapshot?.()
          return typeof snapshot?.active === 'string' ? snapshot.active.toLowerCase() : ''
        } catch {
          return ''
        }
      }, [locale, localeRevision])
      const t = useTranslator(locale, activeLocale)

      // Data comes from the Host stream. The framework also offers
      // `useSessionStatus` on Session-scoped seats, but binding it at the root
      // seat is not stable across compositions, so the HUD keeps the response
      // path that is known to render and reads "which Session is open" from the
      // Session-scoped probe instead.
      const mode = 'stream'
      const activeSessionId = useActiveSessionId()

      const [stream, setStream] = useState(null)
      const [dismissed, setDismissed] = useState(readDismissed)
      const [open, setOpen] = useState(false)
      const [position, setPosition] = useState(readPosition)
      const wrapRef = useRef(null)
      const positionRef = useRef(position)
      const dragRef = useRef(null)
      const dragConsumedClick = useRef(false)
      const reported = useRef(false)

      useEffect(() => {
        if (reported.current) return
        reported.current = true
        reportMode(mode, slotProps)
      }, [mode])

      // Fallback transport: only when the composition exposes no status hook.
      useEffect(() => {
        if (typeof EventSource === 'undefined') return undefined
        let source
        try {
          source = new EventSource(ENDPOINT)
        } catch {
          return undefined
        }
        source.onmessage = (message) => {
          try {
            const next = JSON.parse(message.data)
            if (next && next.kind === 'hud' && Array.isArray(next.sessions)) setStream(next)
          } catch {
            // One malformed frame skips one update.
          }
        }
        return () => {
          try {
            source.close()
          } catch {
            // Already closed.
          }
        }
      }, [])

      const view = useMemo(() => buildFromStream(stream, dismissed), [stream, dismissed])

      // ── animation switches ────────────────────────────────────────────────
      // The switches live in the plugin config on the Host; the page reads them
      // back once over `/state`. A Host too old to answer leaves them all on.
      const [animations, setAnimations] = useState(DEFAULT_ANIMATIONS)
      // `alwaysOnTop` keeps the HUD above the whole interface, title bar
      // included. It is a Host config switch; the page only mirrors it.
      const [alwaysOnTop, setAlwaysOnTop] = useState(true)
      useEffect(() => {
        if (typeof fetch !== 'function') return undefined
        let live = true
        fetch(STATE_ENDPOINT)
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => {
            if (!live) return
            if (typeof body?.alwaysOnTop === 'boolean') setAlwaysOnTop(body.alwaysOnTop)
            const next = body?.animations
            if (!next || typeof next !== 'object') return
            setAnimations({
              expandAnimation: next.expandAnimation !== false,
              sessionAlert: next.sessionAlert !== false,
              completionAlert: next.completionAlert !== false,
            })
          })
          .catch(() => {})
        return () => {
          live = false
        }
      }, [])

      const reducedMotion = useReducedMotion()
      // A switch turning the animation off and the system asking for less motion
      // are the same outcome, so they share one predicate instead of two paths.
      const motion = {
        expand: animations.expandAnimation && !reducedMotion,
        session: animations.sessionAlert && !reducedMotion,
        completion: animations.completionAlert && !reducedMotion,
      }

      // ── elapsed time: the list is only honest if the numbers move ──────────
      const [nowAt, setNowAt] = useState(() => Date.now())
      const hasActive = view.active.length > 0
      useEffect(() => {
        if (!hasActive) return undefined
        const timer = setInterval(() => setNowAt(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [hasActive])

      // ── one-shot emphasis when something new shows up ─────────────────────
      const seenActive = useRef(null)
      const [flashActive, setFlashActive] = useState([])
      useEffect(() => {
        const ids = view.active.map((row) => row.id)
        const previous = seenActive.current
        seenActive.current = new Set(ids)
        // The first snapshot is the baseline, not news.
        if (previous === null || !motion.session) return undefined
        const added = ids.filter((id) => !previous.has(id))
        if (added.length === 0) return undefined
        setFlashActive(added)
        const timer = setTimeout(() => setFlashActive([]), 1000)
        return () => clearTimeout(timer)
      }, [view.active, motion.session])

      const seenAlerts = useRef(null)
      const [flashAlerts, setFlashAlerts] = useState([])
      useEffect(() => {
        const keys = view.alerts.map((alert) => alert.key)
        const previous = seenAlerts.current
        seenAlerts.current = new Set(keys)
        if (previous === null || !motion.completion) return undefined
        const added = keys.filter((key) => !previous.has(key))
        if (added.length === 0) return undefined
        setFlashAlerts(added)
        const timer = setTimeout(() => setFlashAlerts([]), 1000)
        return () => clearTimeout(timer)
      }, [view.alerts, motion.completion])

      // Pinned, the frame may reach the very top; unpinned it stops below the
      // title bar, where host chrome would otherwise sit on top of it.
      const minTop = alwaysOnTop ? EDGE_INSET : TITLEBAR_SAFE

      const beginDrag = (event) => {
        if (event.button !== undefined && event.button !== 0) return
        const wrapper = wrapRef.current
        if (!wrapper) return
        dragConsumedClick.current = false
        const rect = wrapper.getBoundingClientRect()
        dragRef.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          moved: false,
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Capture only keeps the drag alive outside the pill.
        }
      }

      const moveDrag = (event) => {
        const drag = dragRef.current
        if (!drag || drag.id !== event.pointerId) return
        if (!drag.moved) {
          const dx = event.clientX - drag.startX
          const dy = event.clientY - drag.startY
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
          // Rebase at the crossing point: a jittery click must not shift the panel.
          drag.moved = true
          dragConsumedClick.current = true
          const rect = wrapRef.current?.getBoundingClientRect()
          drag.left = rect ? rect.left : drag.left
          drag.top = rect ? rect.top : drag.top
          drag.startX = event.clientX
          drag.startY = event.clientY
          return
        }
        const next = clampPosition({
          x: drag.left + event.clientX - drag.startX,
          y: drag.top + event.clientY - drag.startY,
        }, drag.width, drag.height, minTop)
        positionRef.current = next
        setPosition(next)
        event.preventDefault()
      }

      const endDrag = (event) => {
        const drag = dragRef.current
        if (!drag || drag.id !== event.pointerId) return
        dragRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // Already released.
        }
        if (drag.moved && positionRef.current) writePosition(positionRef.current)
      }

      const settlePosition = () => {
        const wrapper = wrapRef.current
        const current = positionRef.current
        if (!wrapper || !current) return
        const rect = wrapper.getBoundingClientRect()
        const next = clampPosition(current, rect.width, rect.height, minTop)
        if (next.x === current.x && next.y === current.y) return
        positionRef.current = next
        setPosition(next)
        writePosition(next)
      }

      useEffect(() => {
        window.addEventListener('resize', settlePosition)
        return () => window.removeEventListener('resize', settlePosition)
      }, [])

      useEffect(() => {
        settlePosition()
      }, [open])

      // Flipping the pin moves the frame between layers; re-clamp so an unpinned
      // frame cannot keep sitting on the title bar it was pinned over.
      useEffect(() => {
        settlePosition()
      }, [alwaysOnTop])

      // Clicking anywhere outside the panel, or pressing Escape, puts it away.
      useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const wrapper = wrapRef.current
          const target = event.target
          if (wrapper && target && typeof wrapper.contains === 'function' && wrapper.contains(target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      const alertKey = view.alerts.map((alert) => alert.id).join('|')
      const announced = useRef('')
      useEffect(() => {
        if (view.alerts.length > 0 && alertKey !== announced.current) setOpen(true)
        announced.current = alertKey
      }, [alertKey, view.alerts.length])

      const dismissAll = useCallback(() => {
        if (view.mode !== 'stream' || !stream?.epoch) return
        const base = dismissed.epoch === stream.epoch ? dismissed.ids : []
        const ids = [...new Set([...base, ...view.alerts.map((alert) => alert.key)])].slice(-MAX_DISMISSED)
        const next = { epoch: stream.epoch, ids }
        writeDismissed(next)
        setDismissed(next)
        setOpen(false)
      }, [dismissed, stream, view.alerts, view.mode])

      const dismissOne = useCallback((key) => {
        if (view.mode !== 'stream' || !stream?.epoch) return
        const base = dismissed.epoch === stream.epoch ? dismissed.ids : []
        const next = { epoch: stream.epoch, ids: [...new Set([...base, key])].slice(-MAX_DISMISSED) }
        writeDismissed(next)
        setDismissed(next)
      }, [dismissed, stream, view.mode])

      // Opening a Session in the sidebar is reading it: dismiss that alert.
      useEffect(() => {
        if (view.mode !== 'stream' || !activeSessionId) return
        const hit = view.alerts.find((alert) => alert.id === activeSessionId)
        if (hit) dismissOne(hit.key)
      }, [activeSessionId, view.mode, view.alerts, dismissOne])

      if (view.mode === 'stream' && !stream) return null

      const idle = view.running === 0 && view.waiting === 0
      const activeRows = view.active.slice(0, MAX_ACTIVE_ROWS)
      const alertRows = view.alerts.slice(0, MAX_ALERT_ROWS)
      const hiddenActive = view.active.length - activeRows.length
      const hiddenAlerts = view.alerts.length - alertRows.length

      const pill = h('button', {
        type: 'button',
        className: 'dsh-hud-pill',
        onClick: () => {
          if (dragConsumedClick.current) return
          setOpen((value) => !value)
        },
        onPointerDown: beginDrag,
        onPointerMove: moveDrag,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        'aria-expanded': open,
        'aria-label': `${t('hud.toggle')} · ${t('hud.drag')}`,
        title: `${t('hud.toggle')} · ${t('hud.drag')}`,
        style: pillStyle,
      },
      idle && view.alerts.length === 0 ? h('span', { style: DOT_IDLE, 'aria-hidden': true }) : null,
      idle && view.alerts.length === 0 ? h('span', { style: { color: token.secondary } }, t('hud.idle')) : null,
      view.running > 0 ? h('span', { style: DOT_RUNNING, 'aria-hidden': true }) : null,
      view.running > 0 ? h('span', null, `${view.running} ${t('hud.running')}`) : null,
      view.waiting > 0 ? h('span', { style: DOT_WAITING, 'aria-hidden': true }) : null,
      view.waiting > 0 ? h('span', null, `${view.waiting} ${t('hud.waiting')}`) : null,
      view.alerts.length > 0
        ? h('span', {
            className: 'dsh-hud-badge',
            'data-flash': flashAlerts.length > 0 ? 'true' : 'false',
            style: badgeStyle,
          }, `${view.alerts.length} ${t('hud.completed')}`)
        : null,
      )

      const anchor = position
        ? { left: position.x, top: position.y }
        : { top: ANCHOR_TOP, right: ANCHOR_RIGHT }
      const container = {
        ref: wrapRef,
        className: 'dsh-hud-root',
        style: { ...wrapStyle, ...anchor, zIndex: alwaysOnTop ? PINNED_Z : NORMAL_Z },
      }

      const activeItems = activeRows.map((session) => {
        // `since` is 0 for a Session the Host never saw go non-idle: no number
        // beats "0s ago by 20000 hours".
        const elapsed = session.state === 'running' && session.since > 0 ? formatElapsed(nowAt - session.since) : ''
        return h('li', {
          key: session.id,
          className: 'dsh-hud-row',
          'data-flash': flashActive.includes(session.id) ? 'true' : 'false',
          style: actionRowStyle,
        },
        h('span', { style: session.state === 'waiting' ? DOT_WAITING : DOT_RUNNING, 'aria-hidden': true }),
        h('span', { style: labelStyle, title: session.label },
          session.label,
          h('span', { style: idStyle }, shortIdOf(session.id))),
        h('span', { style: metaStyle },
          describe(session, t),
          elapsed ? ` · ${elapsed}` : ''),
        )
      })

      const alertItems = alertRows.map((alert) => h('li', {
        key: alert.key,
        className: 'dsh-hud-row',
        'data-clickable': view.mode === 'stream' ? 'true' : 'false',
        'data-flash': flashAlerts.includes(alert.key) ? 'true' : 'false',
        style: { ...actionRowStyle, cursor: view.mode === 'stream' ? 'pointer' : 'default' },
        // Reading one alert is an action: it has to be reachable by keyboard too.
        ...(view.mode === 'stream'
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => dismissOne(alert.key),
              onKeyDown: (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                dismissOne(alert.key)
              },
            }
          : {}),
        title: view.mode === 'stream' ? t('hud.read') : t('hud.hint'),
      },
      h('span', { style: alert.failed ? DOT_FAILED : DOT_DONE, 'aria-hidden': true }),
      h('span', { style: labelStyle, title: alert.label },
        alert.label,
        h('span', { style: idStyle }, shortIdOf(alert.id))),
      h('span', { style: metaStyle }, clockOf(alert.at)),
      ))

      const summary = `${view.running} ${t('hud.running')} · ${view.waiting} ${t('hud.waiting')} · ${view.alerts.length} ${t('hud.completed')}`
      const empty = activeItems.length === 0 && alertItems.length === 0

      // The live region sits outside the panel: announcements are most useful
      // while the panel is closed, and an aria-hidden panel would swallow them.
      const live = h('span', { className: 'dsh-hud-sr', 'aria-live': 'polite' }, summary)

      const panel = h('div', {
        className: 'dsh-hud-panel',
        'data-open': open ? 'true' : 'false',
        'data-animated': motion.expand ? 'true' : 'false',
        'aria-hidden': open ? 'false' : 'true',
        style: panelStyle,
        role: 'dialog',
        'aria-label': t('hud.title'),
      },
      h('div', { style: headStyle },
        h('span', {
          style: { fontWeight: 600, flex: 1, cursor: 'grab', touchAction: 'none' },
          onPointerDown: beginDrag,
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          title: t('hud.drag'),
        }, t('hud.title')),
        view.mode === 'stream' && view.alerts.length > 0
          ? h('button', { type: 'button', onClick: dismissAll, style: readButtonStyle }, t('hud.read'))
          : h('span', { style: hintStyle }, t('hud.hint')),
      ),
      activeItems.length > 0
        ? h(React.Fragment, null,
          h('div', { style: sectionStyle },
            view.running > 0 ? `${t('hud.running')} · ${view.running}` : `${t('hud.waiting')} · ${view.waiting}`),
          h('ul', { style: listStyle }, activeItems),
          hiddenActive > 0 ? h('div', { style: sectionStyle }, t('hud.more').replace('%d', String(hiddenActive))) : null,
        )
        : null,
      alertItems.length > 0
        ? h(React.Fragment, null,
          h('div', { style: sectionStyle }, `${t('hud.completed')} · ${view.alerts.length}`),
          h('ul', { style: listStyle }, alertItems),
          hiddenAlerts > 0 ? h('div', { style: sectionStyle }, t('hud.more').replace('%d', String(hiddenAlerts))) : null,
        )
        : null,
      empty ? h('div', { style: { ...sectionStyle, padding: '2px 0' } }, t('hud.empty')) : null,
      view.mode === 'stream' && view.completed > 0
        ? h('div', { style: { ...sectionStyle, paddingTop: 2 } }, `${t('hud.total')} · ${view.completed}`)
        : null,
      )

      // The panel stays mounted: mounting/unmounting cannot be transitioned, and
      // the close half is what "expand/收起" means. `data-open` drives both ends.
      return h('div', container, h(HudStyles, null), live, pill, panel)
    }

    // A locale or slot API change must cost the HUD, never the page.
    function report(scope, error) {
      try {
        if (typeof console !== 'undefined' && console.error) console.error(`[dsh-session-hud] ${scope} failed`, error)
      } catch {
        // Logging is itself optional.
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          const locale = localeService(ctx)
          if (locale && typeof locale.register === 'function') {
            try {
              ctx.effect(() => locale.register(NS, { zh: DICTS.zh, en: DICTS.en }), 'dsh-session-hud: dictionaries')
            } catch (error) {
              report('registering the dictionaries', error)
            }
          }
        } catch (error) {
          report('resolving the locale service', error)
        }

        try {
          ctx.slots.inject('shell.overlay', () => {
            try {
              return ctx.slots.register({
                name: 'shell.overlay',
                id: 'dsh-session-hud',
                order: 900,
              }, (props) => h(SessionHud, { ...(props ?? {}), ctx }))
            } catch (error) {
              report('registering the overlay', error)
              return () => {}
            }
          })
        } catch (error) {
          report('injecting into shell.overlay', error)
        }

        // Session-scoped seats that render nothing: they report which Session
        // the shell has open, so opening a row reads it.
        for (const seat of ['conversation.composer.dock', 'conversation.session.header.utilities']) {
          try {
            ctx.slots.inject(seat, () => {
              try {
                return ctx.slots.register({
                  name: seat,
                  id: `dsh-session-hud-probe-${seat.split('.').pop()}`,
                  order: 950,
                }, (props) => h(SessionProbe, { ...(props ?? {}), seat }))
              } catch (error) {
                report(`registering the probe in ${seat}`, error)
                return () => {}
              }
            })
          } catch (error) {
            report(`injecting into ${seat}`, error)
          }
        }
      },
    }
  },
})
