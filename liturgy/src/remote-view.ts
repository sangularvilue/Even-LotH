// Remote mode — turn the phone into a big two-zone remote for the glasses.
// Tap the right half to advance a page, the left half to go back. Designed for
// landscape but works either way (the halves are full-height columns).

type RemoteController = {
  scrollUp: () => Promise<void>
  scrollDown: () => Promise<void>
  getState: () => { pageIndex: number; pages: string[]; view: string }
}

type RemoteOpts = {
  hourName: string
  ui: { prev: string; next: string; done: string; fol: string; of: string }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function showRemote(controller: RemoteController, opts: RemoteOpts): void {
  const overlay = document.createElement('div')
  overlay.className = 'remote-overlay'
  overlay.innerHTML = `
    <div class="remote-half remote-left" data-act="prev">
      <div class="remote-arrow">‹</div><div class="remote-word">${esc(opts.ui.prev)}</div>
    </div>
    <div class="remote-center">
      <div class="remote-hour">${esc(opts.hourName)}</div>
      <div class="remote-prog" id="remote-prog"></div>
      <button class="remote-done" id="remote-done">${esc(opts.ui.done)}</button>
    </div>
    <div class="remote-half remote-right" data-act="next">
      <div class="remote-word">${esc(opts.ui.next)}</div><div class="remote-arrow">›</div>
    </div>`
  document.body.appendChild(overlay)

  const progEl = overlay.querySelector('#remote-prog') as HTMLElement
  const update = () => {
    const st = controller.getState()
    const i = (st.pageIndex || 0) + 1
    const n = Array.isArray(st.pages) && st.pages.length ? st.pages.length : 1
    progEl.textContent = `${opts.ui.fol} ${i} ${opts.ui.of} ${n}`
  }
  update()

  const flash = (el: Element | null) => { if (!el) return; el.classList.add('remote-tap'); setTimeout(() => el.classList.remove('remote-tap'), 140) }

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('#remote-done')) { overlay.remove(); return }
    const zone = target.closest<HTMLElement>('.remote-half')
    if (!zone) return
    flash(zone)
    const act = zone.dataset.act
    if (act === 'next') void controller.scrollDown().then(update)
    else if (act === 'prev') void controller.scrollUp().then(update)
  })
}
