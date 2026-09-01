/**
 * The long-press menu.
 *
 * SDK 0.0.14 added a system overlay menu: declare `menuObject` on the page and
 * a long press on the touchpad opens it; picking an item delivers an
 * `itemID` through the normal event stream. It is fire-and-forget — no
 * acknowledgement, no way to update the overlay while it is open — so every
 * item here is a verb that completes on its own.
 *
 * This is what finally gets navigation off the touchpad. Tap and swipe now mean
 * only "turn the page", and everything else lives behind the hold.
 *
 * Two constraints worth remembering:
 *  - `itemID` must be a non-zero uint32.
 *  - Omitting `menuObject` on a rebuild **clears** the menu, so every page
 *    builder has to declare it again. `menuFor()` exists so none of them forget.
 */

import { MenuContainerProperty, MenuItemProperty } from '@evenrealities/even_hub_sdk'
import type { Locale } from './breviaries'

/** Non-zero, stable across releases — the glasses only send us the number. */
export const MenuAction = {
  NextHour: 1,
  PrevHour: 2,
  ScrollMode: 3,
  Recentre: 4,
  HourList: 5,
  Exit: 6,
  OpenCurrentHour: 7,
} as const

export type MenuActionId = typeof MenuAction[keyof typeof MenuAction]

type Labels = Record<MenuActionId, string>

// Verbs, under ~16 characters, in the language of the active breviary.
const LABELS: Record<Locale, Labels> = {
  en: {
    [MenuAction.NextHour]: 'Next hour',
    [MenuAction.PrevHour]: 'Previous hour',
    [MenuAction.ScrollMode]: 'Scroll mode',
    [MenuAction.Recentre]: 'Recentre tilt',
    [MenuAction.HourList]: 'Hour list',
    [MenuAction.Exit]: 'Close',
    [MenuAction.OpenCurrentHour]: 'Pray now',
  },
  it: {
    [MenuAction.NextHour]: 'Ora successiva',
    [MenuAction.PrevHour]: 'Ora precedente',
    [MenuAction.ScrollMode]: 'Scorrimento',
    [MenuAction.Recentre]: 'Ricentra',
    [MenuAction.HourList]: 'Elenco ore',
    [MenuAction.Exit]: 'Chiudi',
    [MenuAction.OpenCurrentHour]: 'Prega ora',
  },
  ord: {
    [MenuAction.NextHour]: 'Next office',
    [MenuAction.PrevHour]: 'Previous office',
    [MenuAction.ScrollMode]: 'Scroll mode',
    [MenuAction.Recentre]: 'Recentre tilt',
    [MenuAction.HourList]: 'Office list',
    [MenuAction.Exit]: 'Close',
    [MenuAction.OpenCurrentHour]: 'Pray now',
  },
}

/** Which actions each view offers, in the order they appear in the overlay. */
const VIEW_ITEMS: Record<'hours' | 'reading', MenuActionId[]> = {
  hours: [MenuAction.OpenCurrentHour, MenuAction.ScrollMode, MenuAction.Exit],
  reading: [
    MenuAction.NextHour,
    MenuAction.PrevHour,
    MenuAction.ScrollMode,
    MenuAction.Recentre,
    MenuAction.HourList,
    MenuAction.Exit,
  ],
}

/**
 * Build the `menuObject` for a view. Returns undefined when the SDK in use
 * predates menus, so an older build degrades to "long press does nothing"
 * rather than failing to render the page at all.
 */
export function menuFor(view: 'hours' | 'reading', locale: Locale): MenuContainerProperty | undefined {
  if (typeof MenuContainerProperty !== 'function' || typeof MenuItemProperty !== 'function') return undefined
  const labels = LABELS[locale] ?? LABELS.en
  return new MenuContainerProperty({
    menuItems: VIEW_ITEMS[view].map(id => new MenuItemProperty({ itemID: id, itemName: labels[id] })),
  })
}

/** Pull the action out of an event, tolerating both SDK and raw host shapes. */
export function menuActionFrom(event: any): MenuActionId | null {
  const raw = event?.menuItemClickEvent?.itemID
    ?? event?.menuItemClickEvent?.Item_ID
    ?? event?.jsonData?.menuItemClickEvent?.itemID
  const id = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
  if (typeof id !== 'number' || !Number.isFinite(id) || id === 0) return null
  return (Object.values(MenuAction) as number[]).includes(id) ? (id as MenuActionId) : null
}
