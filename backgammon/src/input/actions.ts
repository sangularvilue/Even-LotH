/**
 * Input mapper — translates Even Hub SDK events into app-level Actions.
 * Adapted from chess app with debounce/cooldown.
 */

import {
  OsEventTypeList,
  type EvenHubEvent,
  type List_ItemEvent,
  type Text_ItemEvent,
  type Sys_ItemEvent,
} from '@evenrealities/even_hub_sdk';
import type { Action, GameState } from '../state/contracts';

const DEBOUNCE_MS = 8;
const SAME_DIRECTION_SCROLL_DEDUPE_MS = 10;
let lastRawScrollEventTime = 0;
let lastAcceptedScrollTime = 0;
let lastAcceptedScrollDirection: 'up' | 'down' | null = null;

function isScrollDebounced(direction: 'up' | 'down'): boolean {
  const now = Date.now();
  const rawDt = now - lastRawScrollEventTime;
  lastRawScrollEventTime = now;
  if (rawDt < DEBOUNCE_MS) return true;
  const acceptedDt = now - lastAcceptedScrollTime;
  if (lastAcceptedScrollDirection === direction && acceptedDt < SAME_DIRECTION_SCROLL_DEDUPE_MS) return true;
  lastAcceptedScrollTime = now;
  lastAcceptedScrollDirection = direction;
  return false;
}

export const TAP_COOLDOWN_MS = 220;
let tapCooldownUntil = 0;

export function extendTapCooldown(durationMs: number = TAP_COOLDOWN_MS): void {
  const newCooldownUntil = Date.now() + durationMs;
  if (newCooldownUntil > tapCooldownUntil) tapCooldownUntil = newCooldownUntil;
}

function isInTapCooldown(): boolean {
  return Date.now() < tapCooldownUntil;
}

const SCROLL_SUPPRESS_AFTER_TAP_MS = 150;
let lastTapTime = 0;

function recordTap(): void {
  lastTapTime = Date.now();
}

function isScrollSuppressed(): boolean {
  return Date.now() - lastTapTime < SCROLL_SUPPRESS_AFTER_TAP_MS;
}

function tryConsumeTap(): boolean {
  recordTap();
  return !isInTapCooldown();
}

export function mapEvenHubEvent(event: EvenHubEvent, _state: GameState): Action | null {
  if (!event) return null;

  try {
    if (event.listEvent) return mapListEvent(event.listEvent);
    if (event.textEvent) return mapTextEvent(event.textEvent);
    if (event.sysEvent) return mapSysEvent(event.sysEvent);
    return null;
  } catch (err) {
    console.error('[InputMapper] Error processing event:', err);
    return null;
  }
}

function mapListEvent(event: List_ItemEvent): Action | null {
  if (!event) return null;
  switch (event.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced('up') || isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced('down') || isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };
    case OsEventTypeList.CLICK_EVENT:
      if (!tryConsumeTap()) return null;
      return { type: 'TAP', selectedIndex: event.currentSelectItemIndex ?? 0, selectedName: event.currentSelectItemName ?? '' };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (!tryConsumeTap()) return null;
      return { type: 'DOUBLE_TAP' };
    default:
      if (event.currentSelectItemIndex != null) {
        if (!tryConsumeTap()) return null;
        return { type: 'TAP', selectedIndex: event.currentSelectItemIndex, selectedName: event.currentSelectItemName ?? '' };
      }
      return null;
  }
}

function mapTextEvent(event: Text_ItemEvent): Action | null {
  if (!event) return null;
  switch (event.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced('up') || isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced('down') || isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };
    case OsEventTypeList.CLICK_EVENT:
      if (!tryConsumeTap()) return null;
      return { type: 'TAP', selectedIndex: 0, selectedName: '' };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (!tryConsumeTap()) return null;
      return { type: 'DOUBLE_TAP' };
    default:
      if (event.eventType == null) {
        if (!tryConsumeTap()) return null;
        return { type: 'TAP', selectedIndex: 0, selectedName: '' };
      }
      return null;
  }
}

function mapSysEvent(event: Sys_ItemEvent): Action | null {
  if (!event) return null;
  switch (event.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (isScrollDebounced('up') || isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'up' };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (isScrollDebounced('down') || isScrollSuppressed()) return null;
      return { type: 'SCROLL', direction: 'down' };
    case OsEventTypeList.CLICK_EVENT:
      if (!tryConsumeTap()) return null;
      return { type: 'TAP', selectedIndex: 0, selectedName: '' };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      if (!tryConsumeTap()) return null;
      return { type: 'DOUBLE_TAP' };
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return { type: 'FOREGROUND_ENTER' };
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return { type: 'FOREGROUND_EXIT' };
    default:
      if (event.eventType == null) {
        if (!tryConsumeTap()) return null;
        return { type: 'TAP', selectedIndex: 0, selectedName: '' };
      }
      return null;
  }
}
