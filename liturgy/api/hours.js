import https from 'https'

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(new URL(res.headers.location, url).href).then(resolve, reject)
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString()))
      res.on('error', reject)
    }).on('error', reject)
  })
}

const KNOWN_HOURS = [
  'invitatory', 'office of readings', 'morning prayer',
  'midmorning prayer', 'midday prayer', 'midafternoon prayer',
  'evening prayer', 'night prayer',
]

function todayDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function parseHours(html, date) {
  const hours = []
  const linkRegex = /href="(https?:\/\/divineoffice\.org\/([^/?]+)[^"]*\?date=(\d+)[^"]*)"/g
  let match

  while ((match = linkRegex.exec(html)) !== null) {
    const slug = match[2]
    const linkDate = match[3]

    const afterHref = html.slice(match.index)
    const textMatch = afterHref.match(/>([\s\S]*?)<\/a>/)
    const rawName = textMatch ? textMatch[1].replace(/<[^>]*>/g, '').trim() : slug

    if (hours.some((h) => h.slug === slug)) continue

    const nameLower = rawName.toLowerCase()
    if (!KNOWN_HOURS.some((kh) => nameLower.includes(kh))) continue

    const name = rawName.replace(/^[A-Z][a-z]+ \d+,\s*/, '')
    // Store the slug and the actual date from the link (may differ from requested)
    hours.push({ slug, name, linkDate })
  }

  return hours
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=900')

  const date = req.query.date || todayDate()

  try {
    const html = await fetchUrl(`https://divineoffice.org/?date=${date}`)
    const hours = parseHours(html, date)

    // Return hours with the actual linkDate so the frontend
    // can fetch each hour with the correct date
    res.json({
      date,
      hours: hours.map(h => ({ slug: h.slug, name: h.name, date: h.linkDate })),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hours', detail: err.message })
  }
}
