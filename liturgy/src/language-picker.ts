import type { Language } from './types'
import { setLanguage } from './settings'

// Renders a full-screen language picker and resolves with the chosen language.
// Removes itself from the DOM after a selection.
export function showLanguagePicker(): Promise<Language> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'lang-picker-overlay'
    overlay.innerHTML = `
      <div class="lang-picker-card card">
        <p class="eyebrow">Even G2</p>
        <h1 class="page-title">Liturgy of the Hours</h1>
        <p class="page-subtitle">Choose your language · Scegli la lingua</p>
        <div class="lang-picker-buttons">
          <button class="btn btn-primary lang-btn" data-lang="en" type="button">
            <span class="lang-btn-flag">🇺🇸</span>
            <span class="lang-btn-label">English</span>
            <span class="lang-btn-sub">divineoffice.org</span>
          </button>
          <button class="btn btn-primary lang-btn" data-lang="it" type="button">
            <span class="lang-btn-flag">🇮🇹</span>
            <span class="lang-btn-label">Italiano</span>
            <span class="lang-btn-sub">CEI (beta)</span>
          </button>
        </div>
        <p class="hint" style="margin-top:16px">You can change this later in Settings.</p>
      </div>
    `
    document.body.appendChild(overlay)

    overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.lang-btn')
      if (!btn) return
      const lang = btn.dataset.lang as Language | undefined
      if (lang !== 'en' && lang !== 'it') return
      setLanguage(lang)
      overlay.remove()
      resolve(lang)
    })
  })
}
