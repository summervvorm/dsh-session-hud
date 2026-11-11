/**
 * dsh-session-hud — Host half.
 *
 * Folds every live Session's committed events into one small activity model
 * (running / waiting / idle) and publishes a single snapshot to the browser
 * over a local Server-Sent-Events route. The Client half renders that snapshot
 * in the `shell.overlay` slot; no state is invented here that the session log
 * does not already carry.
 *
 * Session events are observed on the unscoped root bus, because a Loader entry
 * may live inside a scoped composition. A handler never throws into that shared
 * bus: the HUD is optional, the Session is not.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-session-hud'
export const inject = ['sessions']
export const EVENTS_ENDPOINT = '/plugins/dsh-session-hud/events'
export const STATE_ENDPOINT = '/plugins/dsh-session-hud/state'
export const ACTIVE_ENDPOINT = '/plugins/dsh-session-hud/active'

/** Sessions kept resident; a host that stops emitting `session/disposed` must not leak. */
const MAX_SESSIONS = 200
/** Completion alerts kept for late subscribers. */
const MAX_COMPLETIONS = 24

/**
 * Which HUD animations are allowed. Three switches, one per animation, all on by
 * default so an untouched profile looks the way it always did.
 */
export const DEFAULT_ANIMATIONS = {
  /** Panel open/close transition. */
  expandAnimation: true,
  /** A Session appearing in the running/waiting lists. */
  sessionAlert: true,
  /** A Session finishing (the alert row and the badge). */
  completionAlert: true,
}

const ANIMATION_KEYS = Object.keys(DEFAULT_ANIMATIONS)

/**
 * `Config` is the only switch surface: the profile (or the settings page) writes
 * these keys, and the Client reads the normalized result back over `/state`.
 * A missing key keeps its default — an old config must not turn animation off.
 */
export function normalizeAnimations(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of ANIMATION_KEYS) out[key] = typeof input[key] === 'boolean' ? input[key] : DEFAULT_ANIMATIONS[key]
  return out
}

/** Standard-schema shape: the Loader calls `validate` and takes `value`. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-session-hud',
    validate(raw) {
      return { value: normalizeAnimations(raw) }
    },
  },
}

/** Tool names that suspend a Turn until the user answers. */
const WAITING_TOOL = /(^|[^a-z0-9])(ask_user|exit_plan|request_approval|approval_required)/i

/** Identifies this Host process so a persisted read marker from an earlier run is ignored. */
const EPOCH = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// ── durable cumulative counter ──────────────────────────────────────────────
// The alert list is per-run, but "累计完成" has to survive a Host restart, or a
// long-running number looks like it stopped recording.
function stateFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'state', 'dsh-session-hud.json')
}

function readTotal() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'))
    const value = Number(parsed?.completions)
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}

function writeTotal(value) {
  try {
    const file = stateFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ completions: value, updatedAt: Date.now() }))
  } catch {
    // A read-only home only costs persistence; the running count still works.
  }
}

function sessionIdOf(session) {
  const id = session?.header?.id ?? session?.id
  return typeof id === 'string' ? id : ''
}

function cleanLabel(value) {
  const text = String(value ?? '').trim().replace(/\s+/gu, ' ')
  if (!text) return ''
  const parts = text.split(/[\\/]/u).filter(Boolean)
  const candidate = parts.length > 1 ? parts[parts.length - 1] : text
  return candidate.slice(0, 64)
}

/** The freshest human-facing name the live Session exposes. */
function labelOf(session) {
  const candidates = [
    session?.header?.title,
    session?.title,
    session?.header?.name,
    session?.name,
    session?.header?.cwd,
    session?.cwd,
  ]
  for (const candidate of candidates) {
    const label = cleanLabel(candidate)
    if (label) return label
  }
  return ''
}

/** Delegated children are work inside another Session, not Sessions the user counts. */
function isDelegated(session) {
  return session?.header?.origin === 'subagent' || Number(session?.header?.delegationDepth ?? 0) > 0
}

/**
 * Pure activity fold. Every method answers whether the published snapshot changed.
 */
export function createTracker(options = {}) {
  const now = options.now ?? (() => Date.now())
  const sessionTitle = options.sessionTitle ?? (() => '')
  const sessions = new Map()
  const completions = []
  let completionSeq = 0
  /** Cumulative finished Turns, carried across Host runs when a total is given. */
  let total = Number(options.total) > 0 ? Math.floor(Number(options.total)) : 0
  let revision = 0

  function evict() {
    const idle = [...sessions.values()].filter((record) => record.state === 'idle')
    const victim = idle.sort((left, right) => left.updatedAt - right.updatedAt)[0]
      ?? [...sessions.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0]
    if (victim) sessions.delete(victim.id)
  }

  /** A generated title beats the workspace folder name the live header still carries. */
  function nameOf(session) {
    try {
      const title = sessionTitle(session)
      if (typeof title === 'string') {
        const trimmed = title.trim().replace(/\s+/gu, ' ')
        if (trimmed) return trimmed.slice(0, 64)
      }
    } catch {
      // A projection that is not ready yet falls back to the static candidates.
    }
    return labelOf(session)
  }

  function ensure(session, at) {
    const id = sessionIdOf(session)
    if (!id) return undefined
    let record = sessions.get(id)
    if (!record) {
      record = { id, label: nameOf(session), state: 'idle', detail: '', since: 0, updatedAt: at }
      sessions.set(id, record)
      if (sessions.size > MAX_SESSIONS) evict()
    }
    return record
  }

  function relabel(record, session) {
    const label = nameOf(session)
    if (!label || label === record.label) return
    record.label = label
    revision += 1
  }

  function move(record, state, detail, at) {
    if (record.state === state && record.detail === detail) return false
    if (state !== 'idle' && record.state === 'idle') record.since = at
    record.state = state
    record.detail = detail
    record.updatedAt = at
    revision += 1
    return true
  }

  function finish(record, reason, at) {
    completionSeq += 1
    total += 1
    // One completion per Session: finishing again replaces the earlier notice so
    // the alert list stays "one row per Session", while `total` keeps counting
    // every finished Turn for the cumulative number.
    for (let index = completions.length - 1; index >= 0; index -= 1) {
      if (completions[index].sessionId === record.id) completions.splice(index, 1)
    }
    completions.unshift({
      seq: completionSeq,
      sessionId: record.id,
      label: record.label,
      at,
      reason,
      failed: reason !== 'completed',
    })
    if (completions.length > MAX_COMPLETIONS) completions.length = MAX_COMPLETIONS
    revision += 1
    try {
      options.onTotal?.(total)
    } catch {
      // Persistence is best effort and must not disturb the fold.
    }
  }

  function handle(session, event) {
    if (!event || typeof event.type !== 'string') return false
    if (isDelegated(session)) return false
    const at = now()
    const record = ensure(session, at)
    if (!record) return false

    // Titles arrive after the first eligible prompt and can be renamed later, so
    // refresh them at Turn boundaries instead of on every event.
    if (event.type === 'turn/start' || event.type === 'turn/end' || !record.label) {
      relabel(record, session)
    }

    switch (event.type) {
      case 'turn/start':
        return move(record, 'running', 'thinking', at)

      case 'tool/call': {
        const tool = String(event.data?.name ?? event.data?.message?.name ?? 'tool')
        const waiting = WAITING_TOOL.test(tool)
        return move(record, waiting ? 'waiting' : 'running', waiting ? 'question' : `tool:${tool}`, at)
      }

      case 'tool/result':
        if (record.state === 'idle') return false
        return move(record, 'running', 'thinking', at)

      case 'approval/asked':
        return move(record, 'waiting', 'approval', at)

      case 'approval/decided':
        if (record.state !== 'waiting' || record.detail !== 'approval') return false
        return move(record, 'running', 'thinking', at)

      case 'user/message':
        if (record.detail !== 'question') return false
        return move(record, 'running', 'thinking', at)

      case 'turn/end': {
        const reason = String(event.data?.reason?.kind ?? 'completed')
        if (reason === 'blocked') return move(record, 'waiting', 'blocked', at)
        const changed = move(record, 'idle', reason, at)
        // A cancelled Turn is not a completion: the user stopped it on purpose.
        if (reason !== 'aborted') {
          finish(record, reason, at)
          return true
        }
        return changed
      }

      default:
        return false
    }
  }

  function dispose(session) {
    const id = sessionIdOf(session)
    if (!id || !sessions.delete(id)) return false
    revision += 1
    return true
  }

  function snapshot() {
    let running = 0
    let waiting = 0
    const active = []
    for (const record of sessions.values()) {
      if (record.state === 'running') running += 1
      else if (record.state === 'waiting') waiting += 1
      else continue
      active.push({
        id: record.id,
        label: record.label,
        state: record.state,
        detail: record.detail,
        since: record.since,
        updatedAt: record.updatedAt,
      })
    }
    active.sort((left, right) => {
      if (left.state !== right.state) return left.state === 'waiting' ? -1 : 1
      return right.updatedAt - left.updatedAt
    })
    return {
      kind: 'hud',
      epoch: EPOCH,
      revision,
      at: now(),
      // `completed` counts finished Turns (kept across Host runs), not the
      // number of Sessions that ever finished: ten Turns count ten times.
      counts: { running, waiting, completed: total },
      sessions: active,
      completions: completions.map((entry) => ({ ...entry })),
    }
  }

  return { handle, dispose, snapshot, get sessionCount() { return sessions.size } }
}

/** Fan-out for the SSE route, with the latest snapshot replayed to a late subscriber. */
export function createHub() {
  const clients = new Set()
  function write(res, snapshot) {
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
  }
  return {
    get clientCount() {
      return clients.size
    },
    publish(snapshot) {
      for (const res of clients) {
        try {
          write(res, snapshot)
        } catch {
          clients.delete(res)
        }
      }
    },
    attach(res, snapshot) {
      clients.add(res)
      try {
        write(res, snapshot)
      } catch {
        clients.delete(res)
      }
      return () => clients.delete(res)
    },
  }
}

function isLocalRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false
  if (req.headers?.host) {
    try {
      const host = new URL(`http://${req.headers.host}`)
      if (host.username || host.password) return false
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false
    } catch {
      return false
    }
  }
  if (!req.headers?.origin) return true
  try {
    const origin = new URL(req.headers.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host
  } catch {
    return false
  }
}

export function createEventsHandler(tracker, hub) {
  return (req, res) => {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'local access only' }))
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write('retry: 2000\n\n')
    const detach = hub.attach(res, tracker.snapshot())
    req.on('close', detach)
  }
}

/** One-shot snapshot plus the number of pages currently watching it. */
export function createStateHandler(tracker, hub, view, animations = DEFAULT_ANIMATIONS) {
  return (req, res) => {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'local access only' }))
      return
    }
    const body = JSON.stringify({
      ...tracker.snapshot(),
      watchers: hub.clientCount,
      activeSessionId: view?.activeSessionId ?? '',
      hudMode: view?.hudMode ?? '',
      probeMode: view?.probeMode ?? '',
      probeKeys: view?.probeKeys ?? null,
      animations,
    })
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  }
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > limit) {
        reject(new Error('body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The page tells the Host which Session it is showing; `/state` echoes it. */
export function createActiveHandler(view) {
  return (req, res) => {
    const reply = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    }
    if (!isLocalRequest(req)) {
      reply(403, { error: 'local access only' })
      return
    }
    if (req.method !== 'POST') {
      reply(405, { error: 'method not allowed' })
      return
    }
    readBody(req)
      .then((text) => {
        const parsed = JSON.parse(text)
        if (typeof parsed?.sessionId === 'string') view.activeSessionId = parsed.sessionId.slice(0, 128)
        if (typeof parsed?.mode === 'string') {
          const mode = parsed.mode.slice(0, 40)
          if (mode.startsWith('probe:')) view.probeMode = mode
          else view.hudMode = mode
        }
        if (Array.isArray(parsed?.keys)) {
          view.probeKeys = parsed.keys.filter((key) => typeof key === 'string').slice(0, 40)
        }
        reply(200, { ok: true, activeSessionId: view.activeSessionId })
      })
      .catch((error) => {
        reply(400, { error: error instanceof Error ? error.message : String(error) })
      })
  }
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  // The Client cannot see this process, so the switches ride along on `/state`.
  const animations = normalizeAnimations(config)
  let titleService
  const tracker = createTracker({
    total: readTotal(),
    onTotal: (value) => writeTotal(value),
    sessionTitle: (session) => {
      try {
        return titleService?.get?.(session) ?? ''
      } catch {
        return ''
      }
    },
  })
  const hub = createHub()
  /** What this browser page is showing, reported by its Session-scoped probe. */
  const view = { activeSessionId: '' }

  if (typeof ctx.inject === 'function') {
    // Optional: without the title service every Session still shows its folder name.
    ctx.inject(['sessionTitle'], (titleCtx) => {
      titleCtx.effect(() => {
        titleService = titleCtx.sessionTitle
        return () => {
          titleService = undefined
        }
      }, 'dsh-session-hud: session titles')
    })
  }

  const publish = () => {
    // No page is on the fallback stream: skip building a snapshot nobody reads.
    if (hub.clientCount === 0) return
    try {
      hub.publish(tracker.snapshot())
    } catch (error) {
      logger.warn?.(`dsh-session-hud could not publish a snapshot: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let offEvent
  let offDisposed
  try {
    offEvent = ctx.on('session/event', (session, event) => {
      try {
        if (tracker.handle(session, event)) publish()
      } catch (error) {
        logger.warn?.(`dsh-session-hud ignored a session event: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, { global: true })
    offDisposed = ctx.on('session/disposed', (session) => {
      try {
        if (tracker.dispose(session)) publish()
      } catch {
        // A disposed Session only ever removes one row; never let it reach the bus.
      }
    }, { global: true })
  } catch (error) {
    logger.warn?.(`dsh-session-hud could not observe session events: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: EVENTS_ENDPOINT,
          handler: createEventsHandler(tracker, hub),
        }),
        'dsh-session-hud: local snapshot stream',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: STATE_ENDPOINT,
          handler: createStateHandler(tracker, hub, view, animations),
        }),
        'dsh-session-hud: local snapshot endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({
          kind: 'exact',
          path: ACTIVE_ENDPOINT,
          handler: createActiveHandler(view),
        }),
        'dsh-session-hud: active-session report',
      )
    })
  } else {
    logger.warn?.('dsh-session-hud needs the webServer service; the HUD stays without data on this host')
  }

  ctx.effect(() => () => {
    offEvent?.()
    offDisposed?.()
  })
}
