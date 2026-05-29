// Ordinariate (Divine Worship: Daily Office) hour list. Fixed set of three
// offices; the actual content comes from api/hour_ord.js. Mirrors the shape
// of api/hours_it.js.

function todayCompact(tzOffsetMinutes) {
  const now = new Date()
  const local = new Date(now.getTime() - (tzOffsetMinutes || 0) * 60000)
  return `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, '0')}${String(local.getUTCDate()).padStart(2, '0')}`
}

const ORD_HOURS = [
  { slug: 'mattins', name: 'Mattins' },
  { slug: 'evensong', name: 'Evensong' },
  { slug: 'compline', name: 'Compline' },
]

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400')

  const tz = parseInt(req.query.tz || '0', 10)
  const dateArg = req.query.date || todayCompact(tz)
  const iso = /^\d{8}$/.test(dateArg)
    ? `${dateArg.slice(0, 4)}-${dateArg.slice(4, 6)}-${dateArg.slice(6, 8)}`
    : dateArg

  const hours = ORD_HOURS.map((h) => ({ ...h, date: iso }))
  res.json({ date: iso, hours })
}
