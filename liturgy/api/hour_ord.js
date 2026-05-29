// Ordinariate office content endpoint. Runs dwdo.uk's own engine (under jsdom)
// to render the requested office for the date, converts it to our marker
// sections, and embeds public-domain KJV text for the lessons (the source
// links its copyrighted RSV-2CE out to BibleGateway rather than embedding it).

import { renderOrdinariateHtml } from '../lib/ord_engine.js'
import { parseOrdinariate, enrichLessons } from '../lib/scrape_ord.js'
import { fetchKjvText } from '../lib/bible_kjv.js'

const LABELS = { mattins: 'Mattins', evensong: 'Evensong', compline: 'Compline' }

function toIso(date) {
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  return date
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800')

  const slug = (req.query.slug || '').toLowerCase()
  const rawDate = req.query.date
  if (!LABELS[slug]) return res.status(400).json({ error: 'Unknown office', slug })
  if (!rawDate) return res.status(400).json({ error: 'Missing date' })

  const iso = toIso(rawDate)
  try {
    const { html, dayTitle, readings } = await renderOrdinariateHtml(iso, slug)
    const result = await parseOrdinariate(html, {
      slug,
      date: iso,
      name: `${LABELS[slug]}${dayTitle ? ' — ' + dayTitle.split(' — ')[0] : ''}`,
      url: 'https://dwdo.uk/office.html',
    })
    await enrichLessons(result.sections, readings, fetchKjvText)
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: 'Failed to render Ordinariate office', detail: err.message, slug, date: iso })
  }
}
