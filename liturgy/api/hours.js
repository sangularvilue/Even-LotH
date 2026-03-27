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

const DAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

/**
 * Rewrite slugs to match the target date's day-of-week.
 * e.g. if slugs say "fri" but target date is Thursday, swap fri→thu.
 */
function rewriteSlugsForDate(hours, targetDate) {
  const y = parseInt(targetDate.slice(0, 4))
  const m = parseInt(targetDate.slice(4, 6)) - 1
  const d = parseInt(targetDate.slice(6, 8))
  const targetDay = DAY_ABBREVS[new Date(y, m, d).getDay()]

  return hours.map(h => {
    let newSlug = h.slug
    // Find which day abbreviation is in the slug
    for (const day of DAY_ABBREVS) {
      // Match day abbreviation as a whole segment (between hyphens)
      const pattern = new RegExp(`(^|-)${day}(-|$)`)
      if (pattern.test(newSlug) && day !== targetDay) {
        newSlug = newSlug.replace(pattern, `$1${targetDay}$2`)
        break
      }
    }
    return { ...h, slug: newSlug, date: targetDate }
  })
}

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
    const html = await fetchUrl(`https://divineoffice.org/?date=${requestedDate}`)

    let hours = parseHours(html)

    // If the links point to a different date than requested,
    // rewrite the day-of-week in each slug to match the requested date
    const linksDifferent = hours.length > 0 && hours[0].linkDate !== requestedDate
    if (linksDifferent) {
      hours = rewriteSlugsForDate(hours, requestedDate)
    }

    res.json({
      date: requestedDate,
      hours: hours.map(h => ({ slug: h.slug, name: h.name, date: h.date || h.linkDate })),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hours', detail: err.message })
  }
}
