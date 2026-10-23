/**
 * dsh-api-cost — Client half.
 *
 * One ambient entry below the composer: today's estimated API spend, with an
 * expandable ledger (today / 7d / 30d / all-time, per model) and a price editor
 * for relay "sub-API" rates.
 */
window.__ModuleLoader__.load({
  id: 'dsh-api-cost',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-api-cost'
    const API = '/dsh-cost-meter'

    const ZH = {
      trigger: 'API 花费',
      loading: '读取中…',
      unavailable: '不可用',
      close: '收起',
      refresh: '刷新',
      overview: '概览',
      prices: '单价',
      today: '今日',
      week: '近 7 天',
      month: '近 30 天',
      total: '累计',
      tokens: 'tokens',
      model: '模型',
      cost: '花费',
      empty: '还没有会话用量记录。发一条消息后这里会自动累计。',
      unpricedWarn: '有 {n} 个模型未配置单价，只统计了 token。',
      note: '按会话日志里的真实 usage 估算，只统计本机 DSH 会话（含子智能体）。',
      ledger: '账本',
      currency: '币种',
      multiplier: '倍率',
      cacheRead: '缓存命中',
      input: '输入',
      output: '输出',
      perMillion: '单价单位：{symbol} / 百万 token',
      priceIntro: '内置价目为 DeepSeek 官方标准价（人民币）。中转站 / 子 API 可按倍率折算，或直接填写你的实际单价。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败',
      reset: '恢复内置价',
      resetHint: '清除自定义单价，回到内置价目。',
      scanning: '正在扫描历史会话…',
      scanUnavailable: '（历史会话扫描不可用，仅统计启动后的用量）',
      unknownPrice: '未定价',
      priceSourceCustom: '自定义',
      priceSourceBuiltin: '内置',
      closePanel: '收起面板',
    }

    const EN = {
      trigger: 'API spend',
      loading: 'Loading…',
      unavailable: 'Unavailable',
      close: 'Collapse',
      refresh: 'Refresh',
      overview: 'Overview',
      prices: 'Pricing',
      today: 'Today',
      week: '7 days',
      month: '30 days',
      total: 'All time',
      tokens: 'tokens',
      model: 'Model',
      cost: 'Cost',
      empty: 'No session usage recorded yet. Send a message and this fills in automatically.',
      unpricedWarn: '{n} model(s) have no price; only tokens are counted.',
      note: 'Estimated from the real usage in local session logs (this machine, subagents included).',
      ledger: 'Ledger',
      currency: 'Currency',
      multiplier: 'Multiplier',
      cacheRead: 'Cache hit',
      input: 'Input',
      output: 'Output',
      perMillion: 'Price unit: {symbol} per 1M tokens',
      priceIntro: 'Built-in prices are the DeepSeek list prices in CNY. For a relay sub-API, set a multiplier or enter your own unit prices.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed',
      reset: 'Reset to built-in',
      resetHint: 'Remove custom prices and fall back to the built-in table.',
      scanning: 'Scanning historical sessions…',
      scanUnavailable: '(historical scan unavailable; only usage since startup is counted)',
      unknownPrice: 'No price',
      priceSourceCustom: 'custom',
      priceSourceBuiltin: 'built-in',
      closePanel: 'Collapse panel',
    }

    const CSS = `
.dshac { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.dshac-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; line-height: 18px; }
.dshac-trigger:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dshac-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshac-mark { font-size: 11px; color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dshac-value { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshac-dim { color: var(--dsw-alias-label-secondary); }
.dshac-chevron { font-size: 10px; opacity: 0.7; }
.dshac-panel { width: min(560px, 92vw); box-sizing: border-box; text-align: left;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  border-radius: 12px; padding: 12px 14px; color: var(--dsw-alias-label-primary); font-size: 12px; }
.dshac-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.dshac-title { font-size: 13px; font-weight: 600; }
.dshac-spacer { flex: 1 1 auto; }
.dshac-tabs { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.dshac-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit;
  padding: 3px 10px; cursor: pointer; }
.dshac-tab[data-active="true"] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshac-btn { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
.dshac-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dshac-btn-primary { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dshac-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
.dshac-stat { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 8px; background: var(--dsw-alias-bg-base); }
.dshac-stat-label { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dshac-stat-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
.dshac-stat-sub { color: var(--dsw-alias-label-secondary); font-size: 10px; margin-top: 1px; }
.dshac-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dshac-table th { text-align: left; font-weight: 500; color: var(--dsw-alias-label-secondary); font-size: 11px;
  padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshac-table td { padding: 5px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); vertical-align: middle; }
.dshac-table tr:last-child td { border-bottom: 0; }
.dshac-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dshac-model { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.dshac-provider { color: var(--dsw-alias-label-secondary); font-size: 10px; margin-left: 6px; }
.dshac-warn { color: var(--dsw-alias-state-warn-primary); }
.dshac-foot { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 9px; line-height: 1.5; }
.dshac-row { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; flex-wrap: wrap; }
.dshac-field { display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); }
.dshac-input, .dshac-select { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 3px 6px; font: inherit; font-size: 12px; }
.dshac-input { width: 68px; text-align: right; font-variant-numeric: tabular-nums; }
.dshac-input:focus-visible, .dshac-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshac-price-table td { padding: 4px 4px; }
.dshac-price-table th { padding: 4px 4px; }
.dshac-price-table th.dshac-num, .dshac-price-table td.dshac-num { text-align: right; }
.dshac-note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; margin: 0 0 9px; }
.dshac-error { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
.dshac-ok { color: var(--dsw-alias-state-success-primary); font-size: 11px; }
@media (max-width: 560px) { .dshac-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`

    let translate = (key) => ZH[key] || key

    function installLocale(ctx) {
      const local = (key) => ZH[key] || key
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          const disposers = [
            ctx.locale.register(NS, 'zh', ZH),
            ctx.locale.register(NS, 'en', EN),
          ]
          const bound = ctx.locale.bind(NS)
          if (typeof bound === 'function') {
            translate = (key) => {
              try {
                const value = bound(key)
                return typeof value === 'string' && value ? value : local(key)
              } catch {
                return local(key)
              }
            }
          }
          return () => {
            for (const dispose of disposers) {
              try {
                if (typeof dispose === 'function') dispose()
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* locale is optional: fall back to the built-in Chinese copy */
      }
      return () => {}
    }

    function formatMoney(value, symbol) {
      const n = Number(value)
      const amount = Number.isFinite(n) && n > 0 ? n : 0
      if (amount === 0) return `${symbol}0.00`
      if (amount < 0.01) return `<${symbol}0.01`
      if (amount >= 1000) return `${symbol}${Math.round(amount).toLocaleString('en-US')}`
      return `${symbol}${amount.toFixed(2)}`
    }

    function formatTokens(value) {
      const n = Number(value)
      const amount = Number.isFinite(n) && n > 0 ? n : 0
      if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`
      if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`
      if (amount >= 1e3) return `${(amount / 1e3).toFixed(1)}k`
      return String(Math.round(amount))
    }

    async function callApi(path, init) {
      const response = await fetch(path, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
      })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || !data || data.ok === false) {
        const reason = data && data.error ? String(data.error) : `HTTP ${response.status}`
        throw new Error(reason)
      }
      return data
    }

    function useSnapshot(active) {
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState('')
      const alive = useRef(true)

      const load = useCallback(async () => {
        try {
          const data = await callApi(`${API}/snapshot`)
          if (!alive.current) return
          setSnapshot(data)
          setError('')
        } catch (err) {
          if (!alive.current) return
          setError(String((err && err.message) || err))
        }
      }, [])

      useEffect(() => {
        alive.current = true
        load()
        const timer = setInterval(load, active ? 15_000 : 45_000)
        const onFocus = () => load()
        window.addEventListener('focus', onFocus)
        return () => {
          alive.current = false
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [active, load])

      return { snapshot, error, reload: load, apply: setSnapshot }
    }

    function Stat(props) {
      const { label, value, sub } = props
      return h(
        'div',
        { className: 'dshac-stat' },
        h('div', { className: 'dshac-stat-label' }, label),
        h('div', { className: 'dshac-stat-value' }, value),
        sub ? h('div', { className: 'dshac-stat-sub' }, sub) : null,
      )
    }

    function Overview(props) {
      const { snapshot, t } = props
      const symbol = snapshot.symbol || '¥'
      const windows = snapshot.windows || {}
      const models = Array.isArray(snapshot.models) ? snapshot.models : []

      const stat = (key, label) => {
        const window = windows[key] || {}
        return h(Stat, {
          key,
          label,
          value: formatMoney(window.cost, symbol),
          sub: `${formatTokens(window.tokens)} ${t('tokens')}`,
        })
      }

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dshac-stats' },
          stat('today', t('today')),
          stat('week', t('week')),
          stat('month', t('month')),
          stat('total', t('total')),
        ),
        models.length === 0
          ? h('div', { className: 'dshac-foot' }, t('empty'))
          : h(
              'table',
              { className: 'dshac-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('model')),
                  h('th', { className: 'dshac-num' }, t('tokens')),
                  h('th', { className: 'dshac-num' }, t('cost')),
                ),
              ),
              h(
                'tbody',
                null,
                models.map((row) =>
                  h(
                    'tr',
                    { key: row.key },
                    h(
                      'td',
                      null,
                      h('span', { className: 'dshac-model' }, row.model || row.key),
                      row.provider ? h('span', { className: 'dshac-provider' }, row.provider) : null,
                    ),
                    h('td', { className: 'dshac-num' }, formatTokens(row.tokens)),
                    h(
                      'td',
                      { className: 'dshac-num' + (row.priceSource === 'none' ? ' dshac-warn' : '') },
                      row.priceSource === 'none'
                        ? `${formatMoney(row.cost, symbol)} · ${t('unknownPrice')}`
                        : formatMoney(row.cost, symbol),
                    ),
                  ),
                ),
              ),
            ),
        snapshot.unpriced && snapshot.unpriced.length
          ? h(
              'div',
              { className: 'dshac-foot dshac-warn' },
              t('unpricedWarn').replace('{n}', String(snapshot.unpriced.length)),
            )
          : null,
        h(
          'div',
          { className: 'dshac-foot' },
          t('note'),
          snapshot.scan && snapshot.scan.running ? ` ${t('scanning')}` : '',
          snapshot.scan && snapshot.scan.result === 'unavailable' ? ` ${t('scanUnavailable')}` : '',
        ),
      )
    }

    function draftFrom(snapshot) {
      const draft = {}
      for (const row of snapshot.models || []) {
        const price = row.price || { input: 0, cacheRead: 0, output: 0 }
        draft[row.key] = {
          input: String(price.input ?? 0),
          cacheRead: String(price.cacheRead ?? 0),
          output: String(price.output ?? 0),
        }
      }
      return draft
    }

    function PriceEditor(props) {
      const { snapshot, t, apply, reload } = props
      const signature = (snapshot.models || []).map((row) => row.key).join('|')
      const [draft, setDraft] = useState(() => draftFrom(snapshot))
      const [multiplier, setMultiplier] = useState(String(snapshot.multiplier ?? 1))
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const [failed, setFailed] = useState(false)
      const lastDraftSignature = useRef(signature)

      useEffect(() => {
        if (lastDraftSignature.current === signature) return
        lastDraftSignature.current = signature
        setDraft(draftFrom(snapshot))
        setMultiplier(String(snapshot.multiplier ?? 1))
      }, [signature, snapshot])

      const currency = 'CNY'
      const symbol = '¥'
      const models = Array.isArray(snapshot.models) ? snapshot.models : []

      function edit(key, field, value) {
        setDraft((current) => ({
          ...current,
          [key]: { ...(current[key] || {}), [field]: value },
        }))
      }

      async function submit(overrides) {
        if (busy) return
        setBusy(true)
        setFailed(false)
        setMessage('')
        try {
          const payload = { currency, multiplier: Number(multiplier), prices: overrides || {} }
          if (!overrides) {
            for (const [key, price] of Object.entries(draft)) {
              payload.prices[key] = {
                input: Number(price.input) || 0,
                cacheRead: Number(price.cacheRead) || 0,
                output: Number(price.output) || 0,
              }
            }
          }
          const data = await callApi(`${API}/prices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          apply(data)
          setDraft(draftFrom(data))
          setMultiplier(String(data.multiplier ?? 1))
          setMessage(t('saved'))
          setFailed(false)
          reload()
        } catch (err) {
          setFailed(true)
          setMessage(`${t('saveFailed')}：${String((err && err.message) || err)}`)
        } finally {
          setBusy(false)
        }
      }

      function resetToBuiltin() {
        const overrides = {}
        for (const row of models) {
          if (row.priceSource === 'custom') overrides[row.key] = null
        }
        if (!Object.keys(overrides).length) {
          setMessage(t('saved'))
          return
        }
        submit(overrides)
      }

      return h(
        'div',
        null,
        h('p', { className: 'dshac-note' }, t('priceIntro')),
        h(
          'div',
          { className: 'dshac-row' },
          h(
            'span',
            { className: 'dshac-field' },
            t('currency'),
            h('span', { className: 'dshac-dim' }, 'CNY ¥'),
          ),
          h(
            'label',
            { className: 'dshac-field' },
            t('multiplier'),
            h('input', {
              className: 'dshac-input',
              type: 'number',
              min: '0.0001',
              step: '0.01',
              value: multiplier,
              onChange: (event) => setMultiplier(event.target.value),
            }),
          ),
          h('span', { className: 'dshac-dim' }, t('perMillion').replace('{symbol}', symbol)),
        ),
        models.length === 0
          ? h('div', { className: 'dshac-foot' }, t('empty'))
          : h(
              'table',
              { className: 'dshac-table dshac-price-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('model')),
                  h('th', { className: 'dshac-num' }, t('cacheRead')),
                  h('th', { className: 'dshac-num' }, t('input')),
                  h('th', { className: 'dshac-num' }, t('output')),
                ),
              ),
              h(
                'tbody',
                null,
                models.map((row) => {
                  const value = draft[row.key] || { input: '0', cacheRead: '0', output: '0' }
                  const field = (name) =>
                    h('input', {
                      className: 'dshac-input',
                      type: 'number',
                      min: '0',
                      step: '0.01',
                      value: value[name],
                      'aria-label': `${row.model} ${t(name)}`,
                      onChange: (event) => edit(row.key, name, event.target.value),
                    })
                  return h(
                    'tr',
                    { key: row.key },
                    h(
                      'td',
                      null,
                      h('span', { className: 'dshac-model' }, row.model || row.key),
                      h(
                        'span',
                        { className: 'dshac-provider' },
                        row.priceSource === 'custom' ? t('priceSourceCustom') : t('priceSourceBuiltin'),
                      ),
                    ),
                    h('td', { className: 'dshac-num' }, field('cacheRead')),
                    h('td', { className: 'dshac-num' }, field('input')),
                    h('td', { className: 'dshac-num' }, field('output')),
                  )
                }),
              ),
            ),
        h(
          'div',
          { className: 'dshac-row', style: { marginTop: '10px', marginBottom: 0 } },
          h(
            'button',
            {
              type: 'button',
              className: 'dshac-btn dshac-btn-primary',
              disabled: busy,
              onClick: () => submit(),
            },
            busy ? t('saving') : t('save'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshac-btn',
              disabled: busy,
              title: t('resetHint'),
              onClick: resetToBuiltin,
            },
            t('reset'),
          ),
          message
            ? h('span', { className: failed ? 'dshac-error' : 'dshac-ok' }, message)
            : null,
        ),
        h('div', { className: 'dshac-foot' }, `${t('ledger')}: ${snapshot.ledgerPath || ''}`),
      )
    }

    function ApiCostDock() {
      const [open, setOpen] = useState(false)
      const [tab, setTab] = useState('overview')
      const { snapshot, error, reload, apply } = useSnapshot(open)
      const t = translate

      const symbol = (snapshot && snapshot.symbol) || '¥'
      const today = snapshot && snapshot.windows && snapshot.windows.today
      const summary = !snapshot
        ? error
          ? t('unavailable')
          : t('loading')
        : `${t('today')} ${formatMoney(today && today.cost, symbol)}`
      const tokenSummary =
        snapshot && today ? `${formatTokens(today.tokens)} ${t('tokens')}` : ''

      return h(
        'div',
        { className: 'dshac' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h(
          'button',
          {
            type: 'button',
            className: 'dshac-trigger',
            'aria-expanded': open ? 'true' : 'false',
            title: error ? error : t('trigger'),
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: 'dshac-mark' }, symbol),
          h('span', null, t('trigger')),
          h('span', { className: 'dshac-value' }, summary),
          tokenSummary ? h('span', { className: 'dshac-dim' }, `· ${tokenSummary}`) : null,
          h('span', { className: 'dshac-chevron' }, open ? '▾' : '▸'),
        ),
        open
          ? h(
              'div',
              { className: 'dshac-panel', role: 'region', 'aria-label': t('trigger') },
              h(
                'div',
                { className: 'dshac-head' },
                h('span', { className: 'dshac-title' }, t('trigger')),
                h('span', { className: 'dshac-spacer' }),
                h(
                  'div',
                  { className: 'dshac-tabs' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshac-tab',
                      'data-active': tab === 'overview' ? 'true' : 'false',
                      onClick: () => setTab('overview'),
                    },
                    t('overview'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshac-tab',
                      'data-active': tab === 'prices' ? 'true' : 'false',
                      onClick: () => setTab('prices'),
                    },
                    t('prices'),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshac-btn',
                    title: t('refresh'),
                    onClick: () => reload(),
                  },
                  t('refresh'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshac-btn',
                    title: t('closePanel'),
                    'aria-label': t('closePanel'),
                    onClick: () => setOpen(false),
                  },
                  '×',
                ),
              ),
              error ? h('div', { className: 'dshac-error' }, error) : null,
              snapshot
                ? tab === 'prices'
                  ? h(PriceEditor, { snapshot, t, apply, reload })
                  : h(Overview, { snapshot, t })
                : h('div', { className: 'dshac-foot' }, t('loading')),
            )
          : null,
      )
    }

    return {
      name: 'api-cost-client',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => installLocale(ctx))
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'api-cost',
              order: 6,
            },
            ApiCostDock,
          ),
        )
      },
    }
  },
})
