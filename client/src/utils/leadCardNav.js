import { useSyncExternalStore } from 'react';

// Phase 81 — the bottom nav stays visible while a lead card is open.
// Open cards register here so the nav (App.jsx AppShellNav) knows a card is on screen:
//  • "לוח שנה" opens the calendar OVER the card (the card stays mounted, so a call in
//    progress and half-typed text survive) with a × that returns to the card;
//  • any other tab closes the card(s) and navigates as usual.
const cards = [];            // stack of { name, close }
let calendarOpen = false;
let calendarBase = 0;        // how many cards were open when the calendar overlay opened
let snapshot = { count: 0, calendarOpen: false, name: '' };
const subs = new Set();

function emit() {
  const base = cards[calendarOpen ? Math.max(0, calendarBase - 1) : cards.length - 1];
  snapshot = { count: cards.length, calendarOpen, name: base?.name || '' };
  subs.forEach(f => f());
}

export function registerLeadCard(entry) {
  cards.push(entry);
  emit();
  return () => {
    const i = cards.indexOf(entry);
    if (i !== -1) cards.splice(i, 1);
    if (cards.length < calendarBase || !cards.length) { calendarOpen = false; calendarBase = 0; }
    emit();
  };
}

export function setLeadCardName(entry, name) {
  if (entry.name === name) return;
  entry.name = name;
  emit();
}

// Cards opened from inside the calendar overlay (a lead tapped in the calendar).
function closeNested() {
  cards.slice(calendarBase).reverse().forEach(c => c.close());
}

export function openCalendarOverCard() {
  if (calendarOpen) { closeNested(); return; }   // already there → just drop back to the calendar
  calendarOpen = true;
  calendarBase = cards.length;
  emit();
}

export function closeCalendarOverCard() {
  if (!calendarOpen) return;
  closeNested();
  calendarOpen = false;
  calendarBase = 0;
  emit();
}

export function closeTopLeadCard() {
  cards[cards.length - 1]?.close();
}

export function closeAllLeadCards() {
  calendarOpen = false;
  calendarBase = 0;
  [...cards].reverse().forEach(c => c.close());
  emit();
}

export function useLeadCardNav() {
  return useSyncExternalStore(
    cb => { subs.add(cb); return () => subs.delete(cb); },
    () => snapshot,
  );
}
