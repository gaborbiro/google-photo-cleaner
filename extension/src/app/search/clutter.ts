// Suggested searches for clutter (an experiment, shown only on the developer page dev-clutter.html).
// A shipped list of kinds of clutter (receipts, screenshots, parking…) competes with kinds of photo
// people keep (people, children, pets, holidays) and ordinary ones (a street, a meal). Each photo goes
// to the one kind it looks most like, and counts only when that kind is clearly ahead of the next.
// So a family photo in a car park goes to "people", not "parking", and the counts never overlap.
// Which photos may be counted at all comes from the shared protection rules (LibraryPhoto.eligible).

import { dot } from '../ai/similar';

export type CategoryKind = 'clutter' | 'keep';

export interface Category {
  id: string;
  label: string;
  /** clutter: may be suggested for the trash. keep: never suggested; only takes photos away from clutter. */
  kind: CategoryKind;
  /** Ways of describing it to the AI model; the category scores as its best-matching description. */
  descriptions: string[];
}

const clutter = (id: string, label: string, descriptions: string[]): Category => ({ id, label, kind: 'clutter', descriptions });
const keep = (id: string, label: string, descriptions: string[]): Category => ({ id, label, kind: 'keep', descriptions });

export const CATEGORIES: readonly Category[] = [
  clutter('screenshots', 'Screenshots', ['a screenshot of a phone screen', 'a screenshot of a chat conversation', 'a screenshot of a web page', 'a screenshot of an app', 'a screenshot of a map']),
  clutter('screens', 'Photos of screens', ['a photo of a computer screen', 'a photo of a TV screen', 'a photo of a laptop showing an error message']),
  clutter('receipts', 'Receipts and invoices', ['a receipt', 'a till receipt on a table', 'an invoice', 'a bill']),
  clutter('documents', 'Documents and forms', ['a photo of a document', 'a printed letter', 'a form', 'a contract', 'a page of printed text']),
  clutter('whiteboards', 'Whiteboards and slides', ['a whiteboard with writing', 'a presentation slide on a projector screen', 'a flip chart']),
  clutter('notes', 'Notes', ['handwritten notes', 'a sticky note', 'a to-do list']),
  clutter('parking', 'Parking spots', ['a parked car in a car park', 'a car park level sign', 'a parking space number', 'a parking ticket machine']),
  clutter('signs', 'Signs and timetables', ['an information sign', 'a bus timetable', 'opening hours on a door', 'a map on a board', 'a notice on a wall']),
  clutter('menus', 'Menus', ['a restaurant menu', 'a menu board in a cafe']),
  clutter('tickets', 'Tickets and passes', ['a ticket', 'a boarding pass', 'a train ticket']),
  clutter('products', 'Products and shopping', ['a product on a shop shelf', 'a price tag', 'a product label', 'product packaging', 'a supermarket aisle']),
  clutter('codes', 'Labels, barcodes and QR codes', ['a barcode', 'a QR code', 'a serial number sticker', 'an appliance model plate']),
  clutter('readings', 'Meters and warning lights', ['a meter reading', 'a car dashboard warning light', 'a thermostat display']),
  clutter('repairs', 'Things to fix or sell', ['a broken item', 'a damaged wall', 'a leaking pipe', 'an item photographed to sell online', 'furniture for sale']),
  clutter('memes', 'Memes and forwarded images', ['a meme with text', 'a cartoon', 'a motivational quote image', 'a greeting image with text', 'a funny picture from the internet']),
  clutter('accidental', 'Accidental shots', ['a blurry photo taken by accident', 'a dark photo with nothing visible', 'the inside of a pocket', 'a photo of the floor', 'a photo of a ceiling', 'a finger covering the camera lens']),

  keep('people', 'People', ['a portrait of a person', 'a group of people smiling', 'a selfie', 'people at a party', 'a couple together', 'a family photo', 'friends together']),
  keep('children', 'Children', ['a baby', 'a child playing', 'a toddler', 'children at a birthday party', "a child's drawing"]),
  keep('celebrations', 'Celebrations', ['a birthday cake with candles', 'a wedding', 'a Christmas celebration', 'a family dinner', 'a graduation']),
  keep('animals', 'Pets and animals', ['a dog', 'a cat', 'a pet', 'an animal in nature', 'a bird']),
  keep('travel', 'Travel and nature', ['a landscape', 'a beach', 'mountains', 'a city view', 'a famous landmark', 'a sunset', 'a forest', 'a lake']),
  keep('ordinary', 'Ordinary scenes', ['a street', 'a building', 'a meal on a plate', 'a drink', 'flowers', 'a garden', 'a room in a house', 'a car on the road', 'a sports game', 'a concert', 'art in a museum']),
  keep('memories', 'Old photos and keepsakes', ['a scanned old photograph', 'an old printed photo', 'a handwritten letter from family', 'a certificate']),
];

/** A category with its descriptions' fingerprints (one per description, in the same order). */
export interface ScoredCategory {
  category: Category;
  vectors: Float32Array[];
}

/** Where one photo went: its best category, and how far ahead of the next category it is. */
export interface PhotoMatch {
  mediaKey: string;
  /** Index into the categories matched against. */
  best: number;
  bestScore: number;
  secondScore: number;
}

/** The photo's best and second-best category; a category scores as its best-matching description. */
export function matchPhoto(mediaKey: string, vector: Float32Array, categories: ScoredCategory[]): PhotoMatch {
  if (categories.length < 2) throw new Error('Matching needs at least two categories to compare');
  let best = -1;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  categories.forEach((c, i) => {
    const score = Math.max(...c.vectors.map((v) => dot(v, vector)));
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = i;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });
  return { mediaKey, best, bestScore, secondScore };
}

export interface ClutterSettings {
  /** The best category's score must be at least this. */
  minScore: number;
  /** ... and at least this much above the next category's. */
  margin: number;
}

/** What is known about a photo besides its match: the same as Search uses. */
export interface ClutterPhoto {
  eligible: boolean;
  approved: boolean;
}

export interface CategoryPhoto {
  mediaKey: string;
  score: number;
}

export interface CategoryCount {
  category: Category;
  /** Counted photos that may be trashed and aren't in the trash queue yet, best match first. */
  trashable: CategoryPhoto[];
  /** Counted, but protected or of unknown status: never suggested. */
  protectedOrUnknown: number;
  /** Counted, but already in the trash queue. */
  approved: number;
  /** Best match here, but not clearly enough (below the minimum or the margin): not counted. */
  closeCalls: number;
}

export interface ClutterCounts {
  /** Every category, clutter and keep, largest trashable count first. */
  categories: CategoryCount[];
  /** Photos matched in all. */
  photos: number;
}

/** Each photo counted for at most one category: its best, when that one is clearly ahead. */
export function countCategories(matches: PhotoMatch[], categories: Category[], photos: Map<string, ClutterPhoto>, settings: ClutterSettings): ClutterCounts {
  const counts = categories.map((category): CategoryCount => ({ category, trashable: [], protectedOrUnknown: 0, approved: 0, closeCalls: 0 }));
  for (const m of matches) {
    const count = counts[m.best]!;
    if (m.bestScore < settings.minScore || m.bestScore - m.secondScore < settings.margin) {
      count.closeCalls++;
      continue;
    }
    const photo = photos.get(m.mediaKey);
    if (!photo || !photo.eligible) count.protectedOrUnknown++;
    else if (photo.approved) count.approved++;
    else count.trashable.push({ mediaKey: m.mediaKey, score: m.bestScore });
  }
  for (const c of counts) c.trashable.sort((a, b) => b.score - a.score);
  counts.sort((a, b) => b.trashable.length - a.trashable.length);
  return { categories: counts, photos: matches.length };
}

/** The suggestions to show: clutter categories with at least [minPhotos] trashable photos. */
export function suggestions(counts: ClutterCounts, minPhotos: number): CategoryCount[] {
  return counts.categories.filter((c) => c.category.kind === 'clutter' && c.trashable.length >= minPhotos);
}

/** The best-match scores' spread, to choose the minimum score: [fraction, score] at 10%, 50% and 90%. */
export function scoreSpread(matches: PhotoMatch[]): { fraction: number; bestScore: number; lead: number }[] {
  if (matches.length === 0) return [];
  const best = matches.map((m) => m.bestScore).sort((a, b) => a - b);
  const lead = matches.map((m) => m.bestScore - m.secondScore).sort((a, b) => a - b);
  const at = (sorted: number[], f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;
  return [0.1, 0.5, 0.9].map((fraction) => ({ fraction, bestScore: at(best, fraction), lead: at(lead, fraction) }));
}

/** One line per category for the page. */
export function countLine(c: CategoryCount): string {
  const extras = [
    c.protectedOrUnknown > 0 ? `${c.protectedOrUnknown} protected or unknown` : null,
    c.approved > 0 ? `${c.approved} already in the trash queue` : null,
    c.closeCalls > 0 ? `${c.closeCalls} close calls not counted` : null,
  ].filter((x) => x !== null);
  return `${c.category.label} · ${c.trashable.length}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;
}
