// Italian hours-list endpoint. Unlike the English side (which queries
// divineoffice.org's REST API to discover per-day slugs), the Italian
// source has a fixed static list of hour slugs that work for every day.
// So this endpoint just returns the canonical list.

import { IT_HOUR_SLUGS, prettyName, normalizeDate } from '../lib/scrape_it.js'

function todayCompact(tzOffsetMinutes) {
  const now = new Date()
  const local = new Date(now.getTime() - (tzOffsetMinutes || 0) * 60000)
  return `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, '0')}${String(local.getUTCDate()).padStart(2, '0')}`
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400')

  const tz = parseInt(req.query.tz || '0', 10)
  const dateArg = req.query.date || todayCompact(tz)
  const iso = normalizeDate(dateArg)

  const hours = IT_HOUR_SLUGS.map((slug) => ({
    slug,
    name: prettyName(slug),
    date: iso,
  }))

  res.json({ date: iso, hours })
}
