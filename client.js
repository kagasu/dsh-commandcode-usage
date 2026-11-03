/**
 * Client half of the Command Code usage bundle.
 *
 * Two surfaces share one snapshot:
 *  - a small icon below the composer card (`conversation.composer.dock`);
 *  - a panel in the frame-wide floating layer (`shell.overlay`) that the icon
 *    opens, with the three window graphs, their exact figures, and the current
 *    peak/off-peak billing state.
 *
 * The API key never reaches the browser: both surfaces read the Host's JSON
 * route.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-commandcode-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'commandcode-usage'
    const ROUTE = '/commandcode-usage'
    const REFRESH_MS = 60_000
    const TICK_MS = 30_000
    const ICON_SLOT = 'conversation.composer.dock'
    const PANEL_SLOT = 'shell.overlay'
    const PANEL_WIDTH = 340
    const PANEL_MARGIN = 12

    /**
     * Peak/off-peak billing, as Command Code's pricing page states it: full
     * price on Monday–Friday (UTC) inside 01:00–04:00 and 06:00–10:00 UTC,
     * half price in every other hour and all weekend.
     *
     * This is the only known source. The official CLI (`command-code` 1.88.2)
     * carries no peak/off-peak concept at all, and the pricing page renders
     * client-side, so the snapshot below is taken from the sibling MIT plugin
     * `@mars-sea/dsh-commandcode-provider`, which vendors the same windows.
     * It applies only to the models that carry time-of-day pricing; every
     * other model is flat-priced and unaffected. If Command Code moves the
     * windows, change them here.
     */
    const PEAK_WINDOWS_UTC = [[1, 4], [6, 10]]
    /** Catalog ids whose rates follow the windows above. */
    const TIME_OF_DAY_MODELS = [
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-flash-vision-exp',
      'deepseek/deepseek-v4.1-flash',
      'deepseek/deepseek-v4.1-flash-fast',
    ]

    const EN = {
      title: 'Command Code usage',
      iconLabel: 'Command Code usage',
      iconTitle: 'Command Code usage ({state}, busiest window {usage})',
      loading: 'Reading Command Code usage…',
      noKey: 'Command Code: no API key',
      unavailable: 'Command Code: usage unavailable',
      fiveHour: '5-hour',
      weekly: 'Weekly',
      monthly: 'Monthly',
      reset: 'resets',
      resetIn: '{time} left',
      resetNone: 'no reset time',
      peak: 'Peak',
      offPeak: 'Off-peak',
      peakNow: 'Peak hours — full price',
      offPeakNow: 'Off-peak — half price',
      peakChanges: 'next change {time}',
      peakWindows: 'Windows: Mon–Fri, {zone} {windows}. Weekends are off-peak all day.',
      peakModels: 'Applies to {count} time-of-day priced models.',
      requests: '{count} requests this period',
      updated: 'updated {time}',
      plan: 'Plan',
      account: 'Account',
      close: 'Close',
      day: '{n}d',
      hour: '{n}h',
      minute: '{n}m',
    }

    const JA = {
      title: 'Command Code 使用量',
      iconLabel: 'Command Code 使用量',
      iconTitle: 'Command Code 使用量（{state}・最大 {usage}）',
      loading: 'Command Code の使用量を読み込み中…',
      noKey: 'Command Code: APIキーが未設定です',
      unavailable: 'Command Code: 使用量を取得できません',
      fiveHour: '5時間',
      weekly: '週間',
      monthly: '月間',
      reset: 'リセット',
      resetIn: 'あと {time}',
      resetNone: 'リセット時刻なし',
      peak: 'ピーク',
      offPeak: 'オフピーク',
      peakNow: 'ピーク時間（通常料金）',
      offPeakNow: 'オフピーク（半額）',
      peakChanges: '次は {time}',
      peakWindows: '対象: {zone} 平日 {windows}。週末は終日オフピーク。',
      peakModels: '時間帯料金の {count} モデルにのみ適用。',
      requests: '今期 {count} リクエスト',
      updated: '更新 {time}',
      plan: 'プラン',
      account: 'アカウント',
      close: '閉じる',
      day: '{n}日',
      hour: '{n}時間',
      minute: '{n}分',
    }

    const CSS = `
.ccu-dockRow { display: flex; align-items: center; justify-content: center; padding: 2px 0 0; }
.ccu-anchor {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.ccu-anchor:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ccu-anchor:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.ccu-anchorPeak { color: var(--dsw-alias-state-warn-primary); }
.ccu-anchorOpen { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ccu-underline {
  position: absolute;
  left: 5px;
  right: 5px;
  bottom: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l1);
  overflow: hidden;
  pointer-events: none;
}
.ccu-underlineFill { display: block; height: 100%; background: var(--dsw-alias-state-success-primary); }
.ccu-underlineWarn { background: var(--dsw-alias-state-warn-primary); }
.ccu-underlineHigh { background: var(--dsw-alias-state-error-primary); }

.ccu-panel {
  position: fixed;
  box-sizing: border-box;
  width: 340px;
  max-height: 70vh;
  overflow: auto;
  padding: 12px 14px;
  /* The host's own anchored floating surface: bg-layer-2 with the prominent
     elevation stroke and no border. Kept in step with the shipped stylesheet's
     eze_pW_panel rule so this reads as the same material as the host's
     token-usage and typography panels. */
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-prominent);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: auto;
}
.ccu-panelHead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ccu-panelTitle { font-weight: 600; }
.ccu-pill {
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.ccu-pillPeak { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.ccu-pillOff { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.ccu-close {
  margin-left: auto;
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.ccu-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ccu-peakRow { display: flex; align-items: center; gap: 8px; }
.ccu-note { margin-bottom: 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.ccu-row { margin-bottom: 9px; }
.ccu-rowTop { display: flex; justify-content: space-between; gap: 8px; }
.ccu-rowLabel { color: var(--dsw-alias-label-secondary); }
.ccu-rowValue { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.ccu-bar {
  height: 6px;
  margin: 3px 0 2px;
  border-radius: 3px;
  background: var(--dsw-alias-border-l1);
  overflow: hidden;
}
.ccu-barFill { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-state-success-primary); }
.ccu-barFillWarn { background: var(--dsw-alias-state-warn-primary); }
.ccu-barFillHigh { background: var(--dsw-alias-state-error-primary); }
.ccu-rowMeta { color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.ccu-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.ccu-loading { color: var(--dsw-alias-label-secondary); }
`

    function fill(template, values) {
      if (typeof template !== 'string') return ''
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
      )
    }

    function clamp(value, low, high) {
      return Math.min(high, Math.max(low, value))
    }

    function formatCredits(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const rounded = Math.round(value * 100) / 100
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
    }

    function percentOf(window) {
      if (window === null || window === undefined || typeof window !== 'object') return null
      const used = typeof window.used === 'number' ? window.used : null
      const cap = typeof window.cap === 'number' && window.cap > 0 ? window.cap : null
      if (used === null || cap === null) return null
      return clamp((used / cap) * 100, 0, 100)
    }

    function toneOf(percent) {
      if (percent === null) return ''
      if (percent >= 90) return 'High'
      if (percent >= 70) return 'Warn'
      return ''
    }

    function formatClock(ms, withDate) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
      try {
        return new Date(ms).toLocaleString(undefined, {
          ...(withDate ? { month: 'numeric', day: 'numeric' } : {}),
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return null
      }
    }

    function formatSpan(ms, t) {
      const totalMinutes = Math.max(0, Math.round(ms / 60_000))
      const days = Math.floor(totalMinutes / 1440)
      const hours = Math.floor((totalMinutes % 1440) / 60)
      const minutes = totalMinutes % 60
      if (days > 0) {
        return hours > 0 ? `${fill(t('day'), { n: days })} ${fill(t('hour'), { n: hours })}` : fill(t('day'), { n: days })
      }
      if (hours > 0) {
        return minutes > 0
          ? `${fill(t('hour'), { n: hours })} ${fill(t('minute'), { n: minutes })}`
          : fill(t('hour'), { n: hours })
      }
      return fill(t('minute'), { n: minutes })
    }

    /** Whether `ms` is inside a peak window: a UTC weekday within [start, end) UTC hours. */
    function isPeakAt(ms) {
      const at = new Date(ms)
      const day = at.getUTCDay()
      if (day === 0 || day === 6) return false
      const hour = at.getUTCHours()
      return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end)
    }

    /** The next instant the state flips. Windows move only on a UTC hour boundary. */
    function nextPeakChange(ms) {
      const current = isPeakAt(ms)
      const firstBoundary = Math.ceil(ms / 3_600_000) * 3_600_000
      for (let step = 0; step <= 24 * 8; step += 1) {
        const at = firstBoundary + step * 3_600_000
        if (isPeakAt(at) !== current) return at
      }
      return null
    }

    /**
     * Well-known zone abbreviations, so a reader in Japan sees `JST` rather
     * than the `UTC` the pricing page states. Chromium answers `GMT+9` for
     * `Asia/Tokyo` even with `timeZoneName: 'short'`, so the zones below are
     * named explicitly and anything else keeps whatever `Intl` returned.
     */
    const ZONE_ABBREVIATIONS = {
      'Asia/Tokyo': 'JST',
      'Asia/Seoul': 'KST',
      'Asia/Shanghai': 'CST',
      'Asia/Taipei': 'CST',
      'Asia/Hong_Kong': 'HKT',
      'Asia/Singapore': 'SGT',
      'Asia/Kolkata': 'IST',
      'Australia/Sydney': 'AEST',
      'Europe/London': 'GMT',
      'Europe/Berlin': 'CET',
      'Europe/Paris': 'CET',
      'America/New_York': 'ET',
      'America/Chicago': 'CT',
      'America/Denver': 'MT',
      'America/Los_Angeles': 'PT',
      UTC: 'UTC',
      'Etc/UTC': 'UTC',
    }

    let zoneLabelCache = null

    /** The viewer's own zone, named the way a clock app would name it. */
    function localZone() {
      if (zoneLabelCache !== null) return zoneLabelCache
      let label = 'UTC'
      try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (typeof zone === 'string' && Object.prototype.hasOwnProperty.call(ZONE_ABBREVIATIONS, zone)) {
          label = ZONE_ABBREVIATIONS[zone]
        } else {
          const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date())
          const name = parts.find((part) => part.type === 'timeZoneName')?.value
          label = typeof name === 'string' && name.length > 0 ? name : typeof zone === 'string' ? zone : 'UTC'
        }
      } catch {
        label = 'UTC'
      }
      zoneLabelCache = label
      return label
    }

    /** Render one UTC window as the viewer's own clock times. */
    function localWindowLabel([start, end]) {
      const base = new Date()
      const dayStart = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
      const from = new Date(dayStart + start * 3_600_000)
      const to = new Date(dayStart + end * 3_600_000)
      const options = { hour: '2-digit', minute: '2-digit' }
      try {
        return `${from.toLocaleTimeString(undefined, options)}–${to.toLocaleTimeString(undefined, options)}`
      } catch {
        return `${String(start)}:00–${String(end)}:00 ${localZone()}`
      }
    }

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get() {
          return state
        },
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch }
          if (next === state) return
          state = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.error('[commandcode-usage] subscriber failed:', error)
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    const store = createStore({
      open: false,
      anchor: null,
      phase: 'loading',
      data: null,
      reason: null,
      message: null,
    })

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store.get)
      React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), [])
      return snapshot
    }

    /** Re-render on a wall-clock interval so countdowns and the peak state stay current. */
    function useTick(intervalMs) {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const timer = setInterval(() => bump((value) => value + 1), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
    }

    function useLocaleRevision(ctx) {
      const [, bump] = React.useState(0)
      React.useEffect(() => ctx.locale.subscribe(() => bump((value) => value + 1)), [])
    }

    function Meter(props) {
      const t = props.t
      const meter = props.meter
      const percent = percentOf(meter)
      const used = typeof meter?.used === 'number' ? formatCredits(meter.used) : null
      const cap = typeof meter?.cap === 'number' && meter.cap > 0 ? formatCredits(meter.cap) : null
      const value = percent === null ? (used ?? '—') : `${used ?? '—'} / ${cap ?? '—'} · ${String(Math.round(percent))}%`
      const reset = formatClock(meter?.resetAt, true)
      const remaining = typeof meter?.resetAt === 'number' ? meter.resetAt - Date.now() : null
      const meta =
        reset === null
          ? t('resetNone')
          : `${t('reset')} ${reset}${remaining !== null && remaining > 0 ? ` · ${fill(t('resetIn'), { time: formatSpan(remaining, t) })}` : ''}`

      return h('div', { className: 'ccu-row' }, [
        h('div', { className: 'ccu-rowTop', key: 'top' }, [
          h('span', { className: 'ccu-rowLabel', key: 'label' }, props.label),
          h('span', { className: 'ccu-rowValue', key: 'value' }, value),
        ]),
        h(
          'div',
          { className: 'ccu-bar', key: 'bar' },
          percent === null
            ? null
            : h('span', {
                className: `ccu-barFill${toneOf(percent) === '' ? '' : toneOf(percent) === 'Warn' ? ' ccu-barFillWarn' : ' ccu-barFillHigh'}`,
                style: { width: `${percent.toFixed(1)}%` },
              }),
        ),
        h('div', { className: 'ccu-rowMeta', key: 'meta' }, meta),
      ])
    }

    function PeakRow(props) {
      const t = props.t
      const now = Date.now()
      const peak = isPeakAt(now)
      const change = nextPeakChange(now)
      const changeText = change === null ? null : `${formatClock(change, false) ?? ''} · ${formatSpan(change - now, t)}`
      return h('div', { key: 'peak' }, [
        h('div', { className: 'ccu-peakRow', key: 'row' }, [
          h('span', { className: `ccu-pill ${peak ? 'ccu-pillPeak' : 'ccu-pillOff'}`, key: 'pill' }, t(peak ? 'peak' : 'offPeak')),
          h('span', { key: 'state' }, t(peak ? 'peakNow' : 'offPeakNow')),
          changeText === null
            ? null
            : h('span', { className: 'ccu-rowMeta', key: 'change' }, fill(t('peakChanges'), { time: changeText })),
        ]),
        h(
          'div',
          { className: 'ccu-note', key: 'note' },
          fill(t('peakWindows'), {
            zone: localZone(),
            windows: PEAK_WINDOWS_UTC.map(localWindowLabel).join(' / '),
          }),
        ),
        h('div', { className: 'ccu-note', key: 'models' }, fill(t('peakModels'), { count: TIME_OF_DAY_MODELS.length })),
      ])
    }

    function Icon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        [
          h('rect', {
            key: 'frame',
            x: 1.25,
            y: 1.25,
            width: 13.5,
            height: 13.5,
            rx: 4,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
          }),
          h('rect', { key: 'a', x: 4, y: 4.4, width: 8, height: 1.8, rx: 0.9, fill: 'currentColor' }),
          h('rect', { key: 'b', x: 4, y: 7.1, width: 5.6, height: 1.8, rx: 0.9, fill: 'currentColor', opacity: 0.7 }),
          h('rect', { key: 'c', x: 4, y: 9.8, width: 3.2, height: 1.8, rx: 0.9, fill: 'currentColor', opacity: 0.45 }),
        ],
      )
    }

    function createIcon(ctx) {
      return function UsageIcon() {
        useLocaleRevision(ctx)
        useTick(TICK_MS)
        const t = ctx.locale.bind(NS)
        const state = useStore()
        const anchorRef = React.useRef(null)

        React.useEffect(() => {
          let live = true
          const load = async () => {
            try {
              const response = await fetch(ROUTE, { headers: { accept: 'application/json' }, cache: 'no-store' })
              if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
              const payload = await response.json()
              if (!live) return
              if (payload?.ok === true) store.set({ phase: 'ready', data: payload, reason: null, message: null })
              else
                store.set({
                  phase: 'unavailable',
                  data: null,
                  reason: payload?.reason ?? 'error',
                  message: payload?.message ?? null,
                })
            } catch (error) {
              if (!live) return
              store.set({
                phase: 'unavailable',
                data: null,
                reason: 'error',
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }

          void load()
          const timer = setInterval(() => {
            if (document.visibilityState !== 'hidden') void load()
          }, REFRESH_MS)
          return () => {
            live = false
            clearInterval(timer)
          }
        }, [])

        const windows = state.data?.windows ?? {}
        const percents = [windows.fiveHour, windows.weekly, windows.monthly]
          .map(percentOf)
          .filter((value) => value !== null)
        const worst = percents.length === 0 ? null : Math.max(...percents)
        const peak = isPeakAt(Date.now())
        const tone = toneOf(worst)

        const open = () => {
          const rect = anchorRef.current?.getBoundingClientRect()
          store.set((current) => ({
            ...current,
            open: !current.open,
            anchor:
              rect === undefined
                ? current.anchor
                : { centerX: rect.left + rect.width / 2, top: rect.top },
          }))
        }

        const title = fill(t('iconTitle'), {
          state: t(peak ? 'peak' : 'offPeak'),
          usage: worst === null ? '—' : `${String(Math.round(worst))}%`,
        })

        return h('div', { className: 'ccu-dockRow' }, [
          h('style', { key: 'style' }, CSS),
          h(
            'button',
            {
              key: 'button',
              ref: anchorRef,
              type: 'button',
              className: `ccu-anchor${peak ? ' ccu-anchorPeak' : ''}${state.open ? ' ccu-anchorOpen' : ''}`,
              'data-ccu-anchor': '1',
              title,
              'aria-label': t('iconLabel'),
              'aria-haspopup': 'dialog',
              'aria-expanded': state.open,
              onClick: open,
            },
            [
              h(Icon, { key: 'icon' }),
              h(
                'span',
                { className: 'ccu-underline', key: 'underline' },
                worst === null
                  ? null
                  : h('span', {
                      className: `ccu-underlineFill${tone === '' ? '' : tone === 'Warn' ? ' ccu-underlineWarn' : ' ccu-underlineHigh'}`,
                      style: { width: `${worst.toFixed(1)}%` },
                    }),
              ),
            ],
          ),
        ])
      }
    }

    function createPanel(ctx) {
      return function UsagePanel() {
        useLocaleRevision(ctx)
        useTick(TICK_MS)
        const t = ctx.locale.bind(NS)
        const state = useStore()
        const panelRef = React.useRef(null)
        const [viewport, setViewport] = React.useState({ width: 0, height: 0 })

        React.useEffect(() => {
          const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
          measure()
          window.addEventListener('resize', measure)
          return () => window.removeEventListener('resize', measure)
        }, [])

        React.useEffect(() => {
          if (!state.open) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') store.set({ open: false })
          }
          const onPointerDown = (event) => {
            const target = event.target
            if (target instanceof Element && target.closest('[data-ccu-panel],[data-ccu-anchor]') !== null) return
            store.set({ open: false })
          }
          document.addEventListener('keydown', onKey)
          document.addEventListener('pointerdown', onPointerDown, true)
          return () => {
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('pointerdown', onPointerDown, true)
          }
        }, [state.open])

        if (!state.open) return null

        const anchor = state.anchor
        const style = { maxHeight: '70vh' }
        if (anchor !== null && viewport.width > 0) {
          const width = Math.min(PANEL_WIDTH, viewport.width - PANEL_MARGIN * 2)
          style.width = `${String(width)}px`
          style.left = `${String(clamp(anchor.centerX - width / 2, PANEL_MARGIN, viewport.width - width - PANEL_MARGIN))}px`
          style.bottom = `${String(clamp(viewport.height - anchor.top + 8, PANEL_MARGIN, viewport.height - 80))}px`
          style.maxHeight = `${String(Math.max(160, anchor.top - PANEL_MARGIN * 2))}px`
        } else {
          style.left = '50%'
          style.bottom = '96px'
          style.transform = 'translateX(-50%)'
        }

        const body = []
        if (state.phase === 'loading') {
          body.push(h('div', { className: 'ccu-loading', key: 'loading' }, t('loading')))
        } else if (state.phase !== 'ready') {
          body.push(
            h(
              'div',
              { className: 'ccu-loading', key: 'error', title: state.message ?? undefined },
              t(state.reason === 'no-key' ? 'noKey' : 'unavailable'),
            ),
          )
        } else {
          const data = state.data
          const windows = data.windows ?? {}
          body.push(h(PeakRow, { t, key: 'peak' }))
          body.push(h(Meter, { t, label: t('fiveHour'), meter: windows.fiveHour, key: 'five' }))
          body.push(h(Meter, { t, label: t('weekly'), meter: windows.weekly, key: 'weekly' }))
          body.push(h(Meter, { t, label: t('monthly'), meter: windows.monthly, key: 'monthly' }))
          body.push(
            h('div', { className: 'ccu-foot', key: 'foot' }, [
              h('span', { key: 'requests' }, fill(t('requests'), { count: (data.requests ?? 0).toLocaleString() })),
              h('span', { key: 'updated' }, fill(t('updated'), { time: formatClock(data.fetchedAt, false) ?? '—' })),
            ]),
          )
        }

        const plan = state.data?.plan
        const head = [
          h('span', { className: 'ccu-panelTitle', key: 'title' }, t('title')),
          plan === null || plan === undefined
            ? null
            : h(
                'span',
                { className: 'ccu-pill', key: 'plan' },
                `${plan.name}${state.data.status === null ? '' : ` · ${state.data.status}`}`,
              ),
          h(
            'button',
            {
              className: 'ccu-close',
              key: 'close',
              type: 'button',
              'aria-label': t('close'),
              onClick: () => store.set({ open: false }),
            },
            '✕',
          ),
        ]

        return h(
          'div',
          {
            ref: panelRef,
            className: 'ccu-panel',
            style,
            role: 'dialog',
            'aria-label': t('title'),
            'data-ccu-panel': '1',
          },
          [h('style', { key: 'style' }, CSS), h('div', { className: 'ccu-panelHead', key: 'head' }, head), ...body],
        )
      }
    }

    let ctx

    return {
      inject: ['slots', 'locale'],
      apply(context) {
        ctx = context
        context.effect(() => context.locale.register(NS, 'en', EN), 'commandcode-usage: English copy')
        context.effect(() => context.locale.register(NS, 'ja', JA), 'commandcode-usage: Japanese copy')
        context.slots.inject(ICON_SLOT, () =>
          context.slots.register({ name: ICON_SLOT, id: 'commandcode-usage', order: 3 }, createIcon(context)),
        )
        context.slots.inject(PANEL_SLOT, () =>
          context.slots.register(
            { name: PANEL_SLOT, id: 'commandcode-usage-panel', order: 100 },
            createPanel(context),
          ),
        )
      },
    }
  },
})
