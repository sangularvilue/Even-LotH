import https from 'https'

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(new URL(res.headers.location, url).href).then(resolve, reject)
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch (e) { reject(new Error('Invalid JSON')) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

const KNOWN_HOURS = [
  'invitatory', 'office of readings', 'morning prayer',
  'midmorning prayer', 'midday prayer', 'midafternoon prayer',
  'evening prayer', 'night prayer',
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300')

  // Compute user's local date from timezone offset
  const tzOffset = parseInt(req.query.tz || '0', 10)
  const now = new Date()
  const localNow = new Date(now.getTime() - tzOffset * 60000)
  const localDate = `${localNow.getUTCFullYear()}${String(localNow.getUTCMonth() + 1).padStart(2, '0')}${String(localNow.getUTCDate()).padStart(2, '0')}`
  const requestedDate = req.query.date || localDate

  try {
    // Use divineoffice.org's REST API — returns correct slugs for any date
    const data = await fetchJson(
      `https://divineoffice.org/wp-json/do/v1/prayers/?date_start=${requestedDate}`
    )

    const dayData = data[requestedDate]
    if (!dayData || !dayData.prayers) {
      return res.json({ date: requestedDate, hours: [] })
    }

    const hours = []
    for (const prayer of dayData.prayers) {
      const nameLower = (prayer.post_title || '').toLowerCase()
      if (!KNOWN_HOURS.some(kh => nameLower.includes(kh))) continue

      // Extract slug from guid URL
      const guidMatch = (prayer.guid || '').match(/divineoffice\.org\/([^/?]+)/)
      if (!guidMatch) continue

      hours.push({
        slug: guidMatch[1],
        name: prayer.post_title,
        date: requestedDate,
      })
    }

    res.json({ date: requestedDate, hours })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hours', detail: err.message })
  }
}
