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

function parseHours(html) {
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
    hours.push({ slug, name, linkDate })
  }

  return hours
}

function prevDate(dateStr) {
  const y = parseInt(dateStr.slice(0, 4))
  const m = parseInt(dateStr.slice(4, 6)) - 1
  const d = parseInt(dateStr.slice(6, 8))
  const prev = new Date(y, m, d - 1)
  return `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}${String(prev.getDate()).padStart(2, '0')}`
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300')

  // Frontend sends its local date + timezone offset
  const tzOffset = parseInt(req.query.tz || '0', 10)
  const now = new Date()
  const localNow = new Date(now.getTime() - tzOffset * 60000)
  const localDate = `${localNow.getUTCFullYear()}${String(localNow.getUTCMonth() + 1).padStart(2, '0')}${String(localNow.getUTCDate()).padStart(2, '0')}`
  const requestedDate = req.query.date || localDate

  try {
    const html = await fetchUrl(`https://divineoffice.org/?date=${requestedDate}`)

    // Get server's date from the page
    const serverDateMatch = html.match(/data-server-time="(\d{8})"/)
    const serverDate = serverDateMatch ? serverDateMatch[1] : null

    let hours = parseHours(html)

    // If all links point to a different date than requested (the liturgical
    // day shifted after Vespers), also try fetching yesterday's page
    const allLinksSameDate = hours.length > 0 && hours.every(h => h.linkDate === hours[0].linkDate)
    if (allLinksSameDate && hours[0].linkDate !== requestedDate) {
      // The site is showing tomorrow's office. Try fetching yesterday to
      // get today's slugs.
      try {
        const prevHtml = await fetchUrl(`https://divineoffice.org/?date=${prevDate(requestedDate)}`)
        const prevHours = parseHours(prevHtml)
        // If yesterday's page has links matching our requested date, use those
        const matchingHours = prevHours.filter(h => h.linkDate === requestedDate)
        if (matchingHours.length > 0) {
          hours = matchingHours
        }
      } catch {
        // Fall through to the original hours
      }
    }

    res.json({
      date: requestedDate,
      serverDate,
      hours: hours.map(h => ({ slug: h.slug, name: h.name, date: h.linkDate })),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hours', detail: err.message })
  }
}
