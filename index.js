/**
 * dsh-api-cost — Host half.
 *
 * Folds the *real* token usage recorded in this machine's session logs
 * (`assistant/message.usage`) into a local ledger, prices it with a
 * user-editable table (built for relay / sub-API keys whose rate is not the
 * vendor's list price), and serves one read-only snapshot plus one small
 * write endpoint to the Client half over the loopback web server.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-api-cost'
export const inject = ['webServer']

const ROUTE = '/dsh-cost-meter'

/** DeepSeek official list prices (CNY per 1M tokens, standard/peak tier). */
const BUILTIN_PRICES = {
  'deepseek-flash': { input: 2, cacheRead: 0.04, output: 8 },
  'deepseek-v4-flash': { input: 2, cacheRead: 0.04, output: 8 },
  'deepseek-v4-flash-vision-exp': { input: 2, cacheRead: 0.04, output: 8 },
  'deepseek-v4-pro': { input: 9, cacheRead: 0.3, output: 27 },
  'deepseek-reasoner': { input: 9, cacheRead: 0.3, output: 27 },
}

const CURRENCIES = {
  CNY: { code: 'CNY', symbol: '¥' },
  USD: { code: 'USD', symbol: '$' },
}

const DAY_MS = 86_400_000
const MAX_DAYS = 400

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function nonNegative(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

function ledgerFile() {
  return path.join(dshHome(), '.dsh-api-cost.json')
}

function dayKey(ms) {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayKeyOffset(days) {
  return dayKey(Date.now() - days * DAY_MS)
}

function emptyState() {
  return {
    version: 1,
    currency: 'CNY',
    multiplier: 1,
    prices: {},
    days: {},
    seq: {},
    scanned: {},
    updatedAt: 0,
  }
}

function normalizePrice(raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = Number(raw.input)
  const cacheRead = Number(raw.cacheRead)
  const output = Number(raw.output)
  if (![input, cacheRead, output].every((n) => Number.isFinite(n) && n >= 0)) return null
  return { input, cacheRead, output }
}

function loadState() {
  const state = emptyState()
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(ledgerFile(), 'utf8'))
  } catch {
    return state
  }
  if (!parsed || typeof parsed !== 'object') return state

  if (parsed.currency === 'USD' || parsed.currency === 'CNY') state.currency = parsed.currency
  const multiplier = Number(parsed.multiplier)
  if (Number.isFinite(multiplier) && multiplier > 0) state.multiplier = multiplier

  if (parsed.prices && typeof parsed.prices === 'object') {
    for (const [key, value] of Object.entries(parsed.prices)) {
      const price = normalizePrice(value)
      if (price) state.prices[key] = price
    }
  }

  if (parsed.days && typeof parsed.days === 'object') {
    for (const [day, models] of Object.entries(parsed.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !models || typeof models !== 'object') continue
      const cells = {}
      for (const [key, cell] of Object.entries(models)) {
        if (!cell || typeof cell !== 'object') continue
        cells[key] = {
          input: nonNegative(cell.input),
          cacheRead: nonNegative(cell.cacheRead),
          output: nonNegative(cell.output),
          calls: nonNegative(cell.calls),
        }
      }
      if (Object.keys(cells).length) state.days[day] = cells
    }
  }

  if (parsed.seq && typeof parsed.seq === 'object') {
    for (const [id, seq] of Object.entries(parsed.seq)) {
      const n = Number(seq)
      if (Number.isFinite(n) && n >= 0) state.seq[id] = n
    }
  }
  if (parsed.scanned && typeof parsed.scanned === 'object') {
    for (const [id, flag] of Object.entries(parsed.scanned)) {
      if (flag) state.scanned[id] = true
    }
  }
  return state
}

function trimDays(state) {
  const keys = Object.keys(state.days).sort()
  if (keys.length <= MAX_DAYS) return
  for (const key of keys.slice(0, keys.length - MAX_DAYS)) delete state.days[key]
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (Number(parts[0]) !== 127) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(text)
}

function readJsonBody(req, limit = 65_536) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : null)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const state = loadState()
  let saveTimer = null
  let scanning = false
  let scanResult = 'idle'
  let lastEventAt = 0
  let disposed = false

  function persistNow() {
    if (disposed) return
    trimDays(state)
    state.updatedAt = Date.now()
    const target = ledgerFile()
    const temp = `${target}.tmp`
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(temp, JSON.stringify(state), 'utf8')
      fs.renameSync(temp, target)
    } catch {
      try {
        fs.unlinkSync(temp)
      } catch {
        /* ignore */
      }
    }
  }

  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistNow()
    }, 800)
    if (typeof saveTimer?.unref === 'function') saveTimer.unref()
  }

  /** Fold one `assistant/message` usage record. Idempotent by session + seq. */
  function recordUsage(sessionId, seq, time, provider, model, usage) {
    const sid = String(sessionId || '')
    if (!sid || !usage || typeof usage !== 'object') return false
    const n = Math.floor(finite(seq, 0))
    if (n > 0 && n <= finite(state.seq[sid], 0)) return false

    const input = nonNegative(usage.inputTokens)
    const cacheRead = nonNegative(usage.cacheReadTokens)
    const output = nonNegative(usage.outputTokens)
    if (!input && !cacheRead && !output) {
      if (n > 0) state.seq[sid] = n
      return false
    }

    const at = finite(time, Date.now())
    const day = dayKey(at)
    const key = `${provider || 'unknown'}/${model || 'unknown'}`
    const bucket = state.days[day] || (state.days[day] = {})
    const cell = bucket[key] || (bucket[key] = { input: 0, cacheRead: 0, output: 0, calls: 0 })
    cell.input += input
    cell.cacheRead += cacheRead
    cell.output += output
    cell.calls += 1

    if (n > 0) state.seq[sid] = n
    if (at > lastEventAt) lastEventAt = at
    scheduleSave()
    return true
  }

  function priceFor(key) {
    const slash = key.indexOf('/')
    const model = slash >= 0 ? key.slice(slash + 1) : key
    const provider = slash >= 0 ? key.slice(0, slash) : ''
    const direct = state.prices[key] || state.prices[model]
    if (direct) return { price: direct, source: 'custom' }
    const builtin = BUILTIN_PRICES[model] || BUILTIN_PRICES[key]
    if (builtin) return { price: builtin, source: 'builtin' }
    if (/flash/i.test(model)) return { price: BUILTIN_PRICES['deepseek-flash'], source: 'builtin' }
    if (/(^|[^a-z])(pro|reasoner)([^a-z]|$)/i.test(model)) {
      return { price: BUILTIN_PRICES['deepseek-v4-pro'], source: 'builtin' }
    }
    return { price: null, source: 'none' }
  }

  function costOf(cell, price) {
    if (!price) return 0
    const raw =
      (cell.cacheRead / 1e6) * price.cacheRead +
      (cell.input / 1e6) * price.input +
      (cell.output / 1e6) * price.output
    return raw * state.multiplier
  }

  function emptyTotals() {
    return { cost: 0, tokens: 0, input: 0, cacheRead: 0, output: 0, calls: 0 }
  }

  function addInto(total, cell, cost) {
    total.cost += cost
    total.input += cell.input
    total.cacheRead += cell.cacheRead
    total.output += cell.output
    total.calls += cell.calls
    total.tokens += cell.input + cell.cacheRead + cell.output
  }

  function buildSnapshot() {
    const currency = CURRENCIES[state.currency] || CURRENCIES.CNY
    const today = dayKey(Date.now())
    const d7 = dayKeyOffset(6)
    const d30 = dayKeyOffset(29)

    const todayTotal = emptyTotals()
    const weekTotal = emptyTotals()
    const monthTotal = emptyTotals()
    const allTotal = emptyTotals()
    const models = new Map()
    const daily = []

    const sortedDays = Object.keys(state.days).sort()
    for (const day of sortedDays) {
      const dayTotal = emptyTotals()
      for (const [key, cell] of Object.entries(state.days[day])) {
        const resolved = priceFor(key)
        const cost = costOf(cell, resolved.price)

        const slash = key.indexOf('/')
        const model = slash >= 0 ? key.slice(slash + 1) : key
        const provider = slash >= 0 ? key.slice(0, slash) : ''

        let entry = models.get(key)
        if (!entry) {
          entry = {
            key,
            provider,
            model,
            cost: 0,
            tokens: 0,
            input: 0,
            cacheRead: 0,
            output: 0,
            calls: 0,
            price: resolved.price,
            priceSource: resolved.source,
          }
          models.set(key, entry)
        }
        entry.cost += cost
        entry.input += cell.input
        entry.cacheRead += cell.cacheRead
        entry.output += cell.output
        entry.calls += cell.calls
        entry.tokens += cell.input + cell.cacheRead + cell.output

        addInto(dayTotal, cell, cost)
        addInto(allTotal, cell, cost)
        if (day === today) addInto(todayTotal, cell, cost)
        if (day >= d7) addInto(weekTotal, cell, cost)
        if (day >= d30) addInto(monthTotal, cell, cost)
      }
      daily.push({ day, ...dayTotal })
    }

    const modelRows = Array.from(models.values()).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    const unpriced = modelRows.filter((row) => row.priceSource === 'none').map((row) => row.key)

    return {
      ok: true,
      currency: currency.code,
      symbol: currency.symbol,
      multiplier: state.multiplier,
      today,
      generatedAt: Date.now(),
      windows: {
        today: todayTotal,
        week: weekTotal,
        month: monthTotal,
        total: allTotal,
      },
      models: modelRows,
      days: daily.slice(-31),
      unpriced,
      scan: {
        running: scanning,
        result: scanResult,
        sessions: Object.keys(state.scanned).length,
        lastEventAt,
      },
      ledgerPath: ledgerFile(),
    }
  }

  /**
   * One-time (per session) replay of the persisted log, so the first screen is
   * not empty: every `assistant/message` usage event at or after
   * `inheritedEventCount` is folded. Forks keep their parent's tail out, which
   * avoids counting the same tokens twice.
   */
  async function backfill(query) {
    if (!query || typeof query.listSessions !== 'function' || typeof query.readSession !== 'function') {
      scanResult = 'unavailable'
      return
    }

    scanning = true
    scanResult = 'running'
    try {
      const records = await query.listSessions()
      for (const record of Array.isArray(records) ? records : []) {
        if (disposed) break
        const header = record?.header || record
        const id = String(header?.id || '')
        if (!id || state.scanned[id]) continue
        let snapshot
        try {
          snapshot = await query.readSession(id)
        } catch {
          continue
        }
        const inherited = Math.floor(finite(snapshot?.inheritedEventCount, 0))
        const events = Array.isArray(snapshot?.events) ? snapshot.events : []
        let maxSeq = finite(state.seq[id], 0)
        for (const event of events) {
          const seq = Math.floor(finite(event?.seq, 0))
          if (seq > maxSeq) maxSeq = seq
          if (event?.type !== 'assistant/message' || seq < inherited) continue
          const data = event.data || {}
          if (!data.usage) continue
          const source = data.message?.source || {}
          recordUsage(id, seq, event.time, source.provider, source.model, data.usage)
        }
        state.seq[id] = maxSeq
        state.scanned[id] = true
      }
      scanResult = 'done'
      scheduleSave()
    } catch {
      scanResult = 'failed'
    } finally {
      scanning = false
    }
  }

  ctx.on('session/event', (session, event) => {
    try {
      if (!event || event.type !== 'assistant/message') return
      const data = event.data || {}
      if (!data.usage) return
      const sid = String(session?.id || '')
      const inherited = Math.floor(finite(session?.inheritedEventCount, 0))
      const seq = Math.floor(finite(event.seq, 0))
      if (seq > 0 && seq < inherited) return
      const source = data.message?.source || {}
      recordUsage(sid, seq, event.time, source.provider, source.model, data.usage)
    } catch {
      /* never let a fold break the append feed */
    }
  })

  function admit(req) {
    const headers = req?.headers || {}
    let hostUrl
    try {
      hostUrl = new URL(`http://${String(headers.host || '')}`)
    } catch {
      return 403
    }
    if (!isLoopbackHostname(hostUrl.hostname)) return 403
    if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      try {
        if (new URL(origin).host.toLowerCase() !== hostUrl.host.toLowerCase()) return 403
      } catch {
        return 403
      }
    }
    try {
      const connection = ctx.get('connection')
      if (connection && typeof connection.requestRejection === 'function') {
        const rejected = connection.requestRejection(req)
        if (rejected) return typeof rejected === 'number' ? rejected : 403
      }
    } catch {
      /* no fence available: the loopback + same-origin checks above stand */
    }
    return 0
  }

  function guard(req, res) {
    const code = admit(req)
    if (!code) return false
    res.statusCode = code
    res.end()
    return true
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/snapshot`,
      handler: (req, res) => {
        if (guard(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        try {
          sendJson(res, 200, buildSnapshot())
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err?.message || err) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/prices`,
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid-json' })
          return
        }
        if (!body || typeof body !== 'object') {
          sendJson(res, 400, { ok: false, error: 'invalid-body' })
          return
        }

        if (body.currency === 'CNY' || body.currency === 'USD') state.currency = body.currency
        if (body.multiplier !== undefined) {
          const multiplier = Number(body.multiplier)
          if (Number.isFinite(multiplier) && multiplier > 0 && multiplier <= 1000) state.multiplier = multiplier
        }
        if (body.prices && typeof body.prices === 'object') {
          for (const [key, raw] of Object.entries(body.prices)) {
            if (!key || typeof key !== 'string') continue
            if (raw === null) {
              delete state.prices[key]
              continue
            }
            const price = normalizePrice(raw)
            if (price) state.prices[key] = price
          }
        }

        persistNow()
        sendJson(res, 200, buildSnapshot())
      },
    }),
  )

  ctx.effect(() => () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    persistNow()
    disposed = true
  })

  let backfillStarted = false
  function startBackfill(query) {
    if (backfillStarted || disposed) return
    backfillStarted = true
    backfill(query).catch(() => {
      scanning = false
      scanResult = 'failed'
    })
  }

  let queryService
  try {
    queryService = ctx.get('sessionQuery')
  } catch {
    queryService = undefined
  }
  if (queryService && typeof queryService.listSessions === 'function') {
    startBackfill(queryService)
  } else if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['sessionQuery'], (scoped) => startBackfill(scoped.sessionQuery))
    } catch {
      scanResult = 'unavailable'
    }
  } else {
    scanResult = 'unavailable'
  }
}
