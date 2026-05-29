// Fetch public-domain Authorized Version (KJV) passages for the Ordinariate
// lessons. DW:DO links its readings out to BibleGateway's copyrighted RSV-2CE
// rather than embedding text; the RSV-2CE can't be redistributed, so we
// substitute the public-domain KJV (which the Ordinariate also permits) via
// bible-api.com (serves the PD KJV).
//
// DW reading refs look like: "Exodus 35:30-36:1", "Galatians 5:13-100",
// "1 Peter 1:3-12", "Isaiah 61" (whole chapter). "100" is their code for
// "to the end of the chapter".

import https from 'https'

const API = 'https://bible-api.com/'
const _cache = new Map()

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LotH-Even-G2' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(new URL(res.headers.location, url).href).then(resolve, reject); res.resume(); return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function api(ref) {
  const key = ref.toLowerCase()
  if (_cache.has(key)) return _cache.get(key)
  const url = `${API}${encodeURIComponent(ref)}?translation=kjv`
  let data
  try { data = JSON.parse(await httpGet(url)) } catch { data = null }
  _cache.set(key, data)
  return data
}

function assemble(verses) {
  if (!verses || !verses.length) return ''
  // Join as continuous prose (lessons are read straight through); collapse
  // the verse-internal newlines bible-api includes.
  return verses.map((v) => (v.text || '').replace(/\s+/g, ' ').trim()).join(' ').trim()
}

// Returns { reference, text } in the KJV, or null if it couldn't be resolved.
export async function fetchKjvText(rawRef) {
  if (!rawRef || typeof rawRef !== 'string') return null
  let ref = rawRef.trim()
  if (ref.startsWith('[O]')) return null // special reading — text already embedded by the engine

  // End-of-chapter marker: "Book C:V-100" -> fetch whole chapter, keep V..end
  const eoc = ref.match(/^(.+?)\s+(\d+):(\d+)-100$/)
  if (eoc) {
    const [, book, chap, startV] = eoc
    const data = await api(`${book} ${chap}`)
    const verses = (data?.verses || []).filter((v) => Number(v.verse) >= Number(startV))
    const text = assemble(verses)
    return text ? { reference: `${book} ${chap}:${startV}-end`, text } : null
  }
  // Bare "Book C-100" (whole-ish) — fall back to whole chapter
  const eoc2 = ref.match(/^(.+?)\s+(\d+)-100$/)
  if (eoc2) ref = `${eoc2[1]} ${eoc2[2]}`

  const data = await api(ref)
  const text = assemble(data?.verses)
  return text ? { reference: data?.reference || ref, text } : null
}
