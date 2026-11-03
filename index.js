/**
 * Host half of the Command Code usage bundle.
 *
 * It owns the account credential and the network conversation with the Command
 * Code Provider API, and publishes one JSON snapshot on an exact HTTP route of
 * the Harness Web server. The Client half renders that snapshot; it never sees
 * the API key.
 *
 * The four reads are the ones the official CLI's `/usage` overlay performs
 * (`command-code` 1.88.2): `whoami` for the organization, then the billing
 * credits, the subscription, and the usage summary of the current billing
 * period. Every figure this bundle shows comes from the API, never from a local
 * guess: `windowLimits.fiveHour`/`weekly` carry the rolling windows and
 * `credits.monthlyCredits` plus the period summary carry the monthly one.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const inject = ['webServer']

const DEFAULT_API_BASE = 'https://api.commandcode.ai'
const DEFAULT_ROUTE_PATH = '/commandcode-usage'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_API_KEY_ENV = 'COMMANDCODE_API_KEY'
/** An unchanged snapshot is served for this long, so a poll storm cannot multiply API calls. */
const CACHE_MS = 15_000

/**
 * Monthly credit allowance per plan id, as `command-code` 1.88.2 declares it.
 * Only used to label the monthly window's cap; when a plan is absent the cap is
 * derived from live figures instead (remaining + spent this period).
 */
const PLAN_CREDITS = {
  'individual-go': 10,
  'individual-go-v1': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
  'individual-max': 150,
  'individual-ultra': 300,
  'teams-pro': 40,
}

const PLAN_NAMES = {
  'individual-go': 'Go',
  'individual-go-v1': 'Go',
  'individual-goat': 'GOAT',
  'individual-pro': 'Pro',
  'individual-pro-v1': 'Pro',
  'individual-provider': 'Provider',
  'individual-max': 'Max',
  'individual-ultra': 'Ultra',
  'teams-pro': 'Teams Pro',
}

/** @param {unknown} value @returns {number | null} */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** @param {unknown} value @returns {string | null} */
function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** @param {unknown} raw */
function readWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const window = /** @type {Record<string, unknown>} */ (raw)
  return {
    used: numberOrNull(window.used),
    cap: numberOrNull(window.cap),
    resetAt: numberOrNull(window.resetAt),
    exceeded: window.exceeded === true,
  }
}

/**
 * Resolve the account credential the way the official CLI does: an explicit
 * configuration value, then the launching environment, then the file `cmd
 * login` writes.
 *
 * @param {{ apiKey: string | null, apiKeyEnv: string }} options
 * @returns {Promise<string | null>}
 */
async function resolveApiKey({ apiKey, apiKeyEnv }) {
  if (apiKey !== null) return apiKey
  const fromEnvironment = stringOrNull(process.env[apiKeyEnv])
  if (fromEnvironment !== null) return fromEnvironment
  try {
    const raw = await readFile(join(homedir(), '.commandcode', 'auth.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return stringOrNull(parsed?.apiKey)
  } catch {
    return null
  }
}

/**
 * @param {string} base
 * @param {string} path
 * @param {string} key
 * @param {AbortSignal} signal
 * @param {Record<string, string | null>} [params]
 */
async function requestJson(base, path, key, signal, params) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) query.set(name, value)
  }
  const search = query.toString()
  const response = await fetch(`${base}${path}${search.length > 0 ? `?${search}` : ''}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`${path} answered HTTP ${String(response.status)}`)
  return await response.json()
}

/**
 * Shape the four API answers into the one snapshot the Client renders.
 *
 * @param {{ whoami: any, credits: any, subscription: any, summary: any }} answers
 */
function normalize({ whoami, credits, subscription, summary }) {
  const creditData = credits?.credits ?? {}
  const windowLimits = credits?.windowLimits ?? {}
  const subscriptionData = subscription?.data ?? null

  const planId = stringOrNull(subscriptionData?.planId) ?? stringOrNull(creditData.planId)
  const monthlyRemaining = numberOrNull(creditData.monthlyCredits)
  const monthlySpent = numberOrNull(summary?.totalMonthlyCredits) ?? numberOrNull(summary?.totalCost)
  const planCredits = planId === null ? null : PLAN_CREDITS[planId] ?? null
  const monthlyCap =
    planCredits ?? (monthlyRemaining !== null && monthlySpent !== null ? monthlyRemaining + monthlySpent : null)

  const periodEnd = typeof subscriptionData?.currentPeriodEnd === 'string'
    ? Date.parse(subscriptionData.currentPeriodEnd)
    : Number.NaN

  return {
    account: stringOrNull(whoami?.user?.userName),
    plan: planId === null ? null : { id: planId, name: PLAN_NAMES[planId] ?? planId, monthlyCredits: planCredits },
    status: stringOrNull(subscriptionData?.status),
    period: {
      start: stringOrNull(subscriptionData?.currentPeriodStart),
      end: stringOrNull(subscriptionData?.currentPeriodEnd),
    },
    windows: {
      fiveHour: readWindow(windowLimits.fiveHour),
      weekly: readWindow(windowLimits.weekly),
      monthly: {
        used: monthlySpent,
        cap: monthlyCap,
        resetAt: Number.isFinite(periodEnd) ? periodEnd : null,
        remaining: monthlyRemaining,
        purchasedRemaining: numberOrNull(creditData.purchasedCredits),
        freeRemaining: numberOrNull(creditData.freeCredits),
        windowLimited: windowLimits.limited === true,
      },
    },
    requests: numberOrNull(summary?.totalCount),
  }
}

/** @param {{ apiBase: string, apiKey: string | null, apiKeyEnv: string, timeoutMs: number }} options */
async function loadUsage(options) {
  const key = await resolveApiKey(options)
  if (key === null) return { ok: false, reason: 'no-key', fetchedAt: Date.now() }

  const base = options.apiBase.replace(/\/+$/, '')
  const signal = AbortSignal.timeout(options.timeoutMs)

  const whoami = await requestJson(base, '/alpha/whoami', key, signal, { limits: '1' })
  const orgId = stringOrNull(whoami?.org?.id)
  const [credits, subscription] = await Promise.all([
    requestJson(base, '/alpha/billing/credits', key, signal, { orgId }),
    requestJson(base, '/alpha/billing/subscriptions', key, signal, { orgId }),
  ])
  const since = stringOrNull(subscription?.data?.currentPeriodStart)
  const summary = await requestJson(base, '/alpha/usage/summary', key, signal, { orgId, since })

  return { ok: true, fetchedAt: Date.now(), ...normalize({ whoami, credits, subscription, summary }) }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ routePath?: string, apiBase?: string, apiKey?: string, apiKeyEnv?: string, timeoutMs?: number } | undefined} config
 */
export function apply(ctx, config) {
  const settings = config ?? {}
  const routePath =
    typeof settings.routePath === 'string' && settings.routePath.startsWith('/')
      ? settings.routePath
      : DEFAULT_ROUTE_PATH
  const apiBase = stringOrNull(settings.apiBase) ?? DEFAULT_API_BASE
  const apiKeyEnv = stringOrNull(settings.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
  const apiKey = stringOrNull(settings.apiKey)
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? Number(settings.timeoutMs) : DEFAULT_TIMEOUT_MS

  /** @type {{ at: number, value: any } | null} */
  let cached = null

  const readUsage = async () => {
    const now = Date.now()
    if (cached !== null && now - cached.at < CACHE_MS) return cached.value

    let value
    try {
      value = await loadUsage({ apiBase, apiKey, apiKeyEnv, timeoutMs })
    } catch (error) {
      // A failure carries its reason and is never cached, so the next poll retries.
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
        fetchedAt: now,
      }
    }
    cached = { at: now, value }
    return value
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: routePath,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' })
            res.end('{"ok":false,"reason":"method"}')
            return
          }
          const payload = await readUsage()
          const body = JSON.stringify(payload)
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(body),
          })
          if (req.method === 'HEAD') res.end()
          else res.end(body)
        },
      }),
    'commandcode-usage: usage route',
  )
}
