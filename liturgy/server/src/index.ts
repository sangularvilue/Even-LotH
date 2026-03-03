import express from 'express'
import cors from 'cors'
import { fetchHoursIndex, fetchHourContent } from './scraper.js'
import { cacheGet, cacheSet } from './cache.js'
import type { HoursIndex, HourContent } from './types.js'

const app = express()
const PORT = 3210

app.use(cors())

function todayDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/hours', async (req, res) => {
  try {
    const date = (req.query.date as string) || todayDate()
    const cacheKey = `hours:${date}`
    const cached = cacheGet<HoursIndex>(cacheKey)
    if (cached) {
      res.json(cached)
      return
    }

    const hours = await fetchHoursIndex(date)
    const result: HoursIndex = { date, hours }
    cacheSet(cacheKey, result)
    res.json(result)
  } catch (error) {
    console.error('Error fetching hours:', error)
    res.status(500).json({ error: 'Failed to fetch hours index' })
  }
})

app.get('/api/hour/:slug', async (req, res) => {
  try {
    const slug = req.params.slug
    const date = (req.query.date as string) || todayDate()
    const cacheKey = `hour:${slug}:${date}`
    const cached = cacheGet<HourContent>(cacheKey)
    if (cached) {
      res.json(cached)
      return
    }

    const content = await fetchHourContent(slug, date)
    cacheSet(cacheKey, content)
    res.json(content)
  } catch (error) {
    console.error(`Error fetching hour ${req.params.slug}:`, error)
    res.status(500).json({ error: 'Failed to fetch hour content' })
  }
})

app.listen(PORT, () => {
  console.log(`Liturgy server listening on http://localhost:${PORT}`)
})
