import { scrapeHour, normalizeDate } from '../lib/scrape_it.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800')

  const slug = req.query.slug || req.url.split('?')[0].split('/').pop()
  const rawDate = req.query.date
  if (!slug) return res.status(400).json({ error: 'Missing slug' })
  if (!rawDate) return res.status(400).json({ error: 'Missing date' })

  try {
    const hour = await scrapeHour(slug, normalizeDate(rawDate))
    res.json(hour)
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch Italian hour', detail: err.message, slug, date: rawDate })
  }
}
