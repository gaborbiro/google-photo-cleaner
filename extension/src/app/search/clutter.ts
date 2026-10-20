// Suggested searches for clutter (an experiment, shown only on the developer page dev-clutter.html).
// A shipped list of kinds of clutter (receipts, screenshots, parking…) competes with counterweights:
// photos people keep (people, children, pets, holidays) and ordinary ones (a street, a meal). Each photo goes
// to the one kind it looks most like, and counts only when that kind is clearly ahead of the next.
// So a family photo in a car park goes to "people", not "parking", and the counts never overlap.
// Which photos may be counted at all comes from the shared protection rules (LibraryPhoto.eligible).

import { dot } from '../ai/similar';
import { n } from '../shared/format';

export type CategoryKind = 'clutter' | 'counterweight';

export interface Category {
  id: string;
  label: string;
  /** clutter: may be suggested for the trash. counterweight: never suggested; only takes photos away from clutter. */
  kind: CategoryKind;
  /** Ways of describing it to the AI model; the category scores as its best-matching description. */
  descriptions: string[];
}

const clutter = (id: string, label: string, descriptions: string[]): Category => ({ id, label, kind: 'clutter', descriptions });
const counterweight = (id: string, label: string, descriptions: string[]): Category => ({ id, label, kind: 'counterweight', descriptions });

export const CATEGORIES: readonly Category[] = [
  clutter('screenshots', 'Screenshots', ['a screenshot of a phone screen', 'a screenshot of a chat conversation', 'a screenshot of a web page', 'a screenshot of an app', 'a screenshot of a map']),
  clutter('screens', 'Photos of screens', ['a photo of a computer screen', 'a photo of a TV screen', 'a photo of a laptop showing an error message']),
  // No incidental words ("on a table", "held in a hand"): they match every photo with a table or a hand in it.
  clutter('receipts', 'Receipts and invoices', ['a receipt', 'a long till receipt', 'an invoice', 'a bill']),
  clutter('documents', 'Documents and forms', ['a photo of a document', 'a printed letter', 'a form', 'a contract', 'a page of printed text']),
  clutter('whiteboards', 'Whiteboards and slides', ['a whiteboard with writing', 'a presentation slide on a projector screen', 'a flip chart']),
  clutter('notes', 'Notes', ['handwritten notes', 'a sticky note', 'a to-do list']),
  clutter('parking', 'Parking spots', ['a parked car in a car park', 'a car park level sign', 'a parking space number', 'a parking ticket machine']),
  clutter('signs', 'Signs and timetables', ['an information sign', 'a bus timetable', 'opening hours on a door', 'a map on a board', 'a notice on a wall']),
  clutter('menus', 'Menus', ['a restaurant menu', 'a menu board in a cafe']),
  // The ticket itself, not travelling: "a boarding pass" alone stood in for anything on a plane or train.
  clutter('tickets', 'Tickets and passes', ['a paper ticket', 'a printed boarding pass', 'a boarding pass on a phone screen', 'a paper train ticket', 'an event ticket']),
  clutter('products', 'Products and shopping', ['a product on a shop shelf', 'a price tag', 'a product label', 'product packaging', 'a supermarket aisle']),
  clutter('codes', 'Labels, barcodes and QR codes', ['a barcode', 'a QR code', 'a serial number sticker', 'an appliance model plate']),
  clutter('readings', 'Meters and warning lights', ['a meter reading', 'a car dashboard warning light', 'a thermostat display']),
  clutter('repairs', 'Things to fix or sell', ['a broken item', 'a damaged wall', 'a leaking pipe', 'an item photographed to sell online', 'furniture for sale']),
  // What memes look like as well as what they are: a fingerprint is mostly what a picture shows, so a
  // meme of a couple otherwise goes to People.
  clutter('memes', 'Memes and forwarded images', [
    'a meme with text', 'a cartoon', 'a motivational quote image', 'a greeting image with text', 'a funny picture from the internet',
    'a cartoon image with a caption', 'a screenshot of a social media post', 'text written over a picture', 'a greeting card image with flowers and text',
    'a joke picture with a punchline',
  ]),
  clutter('accidental', 'Accidental shots', ['a blurry photo taken by accident', 'a dark photo with nothing visible', 'the inside of a pocket', 'a photo of the floor', 'a photo of a ceiling', 'a finger covering the camera lens']),

  counterweight('people', 'People', ['a portrait of a person', 'a group of people smiling', 'a selfie', 'people at a party', 'a couple together', 'a family photo', 'friends together']),
  counterweight('children', 'Children', ['a baby', 'a child playing', 'a toddler', 'children at a birthday party', "a child's drawing"]),
  counterweight('celebrations', 'Celebrations', ['a birthday cake with candles', 'a wedding', 'a Christmas celebration', 'a family dinner', 'a graduation']),
  counterweight('animals', 'Pets and animals', ['a dog', 'a cat', 'a pet', 'an animal in nature', 'a bird']),
  counterweight('nature', 'Nature', ['a landscape', 'a beach', 'mountains', 'a sunset', 'a forest', 'a lake']),
  // Being on the move: without it, photos taken on trains and planes went to tickets.
  counterweight('travel', 'Travel', [
    'a famous landmark', 'a view from a train window', 'a view from an airplane window', 'inside a train', 'inside an airplane cabin', 'an airport terminal',
    'a meal on a tray table on a plane or train', 'a hotel room',
  ]),
  // A city view is ordinary: a window onto the city doesn't make a room a travel photo.
  counterweight('ordinary', 'Ordinary scenes', ['a street', 'a building', 'a city view', 'a meal on a plate', 'a drink', 'an ice cream cone', 'a dessert', 'street food', 'a snack', 'flowers', 'a garden', 'a room in a house', 'a car on the road', 'a sports game', 'a concert', 'art in a museum']),
  counterweight('memories', 'Old photos and keepsakes', ['a scanned old photograph', 'an old printed photo', 'a handwritten letter from family', 'a certificate']),
];

/** A category with its descriptions' fingerprints (one per description, in the same order). */
export interface ScoredCategory {
  category: Category;
  vectors: Float32Array[];
}

/** Where one photo went: its best category, and the scores its lead is measured against. */
export interface PhotoMatch {
  mediaKey: string;
  /** Index into the categories matched against. */
  best: number;
  /** Index into [best]'s descriptions: the one the photo scored as. */
  description: number;
  bestScore: number;
  /** The next category's score, of either kind. */
  secondScore: number;
  /** The best score among categories of the other kind than [best]'s: counterweights for clutter, and the other way round. */
  otherKindScore: number;
}

/**
 * What a photo's lead is measured against. next: the next category, of either kind. otherKind: the best
 * category of the other kind, so two kinds of clutter close together (a receipt or a document?) don't
 * stop a photo counting, as it is clutter either way; only how close a counterweight comes matters.
 * The other kind never scores above the next category, so with the same minimum lead, otherKind only
 * adds photos.
 */
export type LeadOver = 'next' | 'otherKind';

export function leadOf(match: PhotoMatch, over: LeadOver): number {
  return match.bestScore - (over === 'next' ? match.secondScore : match.otherKindScore);
}

/** A photo's score for every description, category by category in the order matched against. */
export function descriptionScores(vector: Float32Array, categories: ScoredCategory[]): Float32Array {
  return Float32Array.from(categories.flatMap((c) => c.vectors.map((v) => dot(v, vector))));
}

/**
 * Each description's usual score over the whole library. Some descriptions score higher than others on
 * every photo, so raw scores favour them; evened out, a photo scores as how far above a description's
 * average it is, counted in that description's spread (standard deviation).
 */
export interface DescriptionNorms {
  /** Per description, in the order of [descriptionScores]. */
  mean: Float64Array;
  spread: Float64Array;
}

/** The average and spread of every description's scores over [rows], one row per photo. */
export function descriptionNorms(rows: Float32Array[]): DescriptionNorms {
  if (rows.length < 2) throw new Error('Evening out the descriptions needs at least two photos');
  const width = rows[0]!.length;
  const mean = new Float64Array(width);
  for (const row of rows) {
    if (row.length !== width) throw new Error(`Photos were scored against different descriptions (${row.length} and ${width})`);
    for (let i = 0; i < width; i++) mean[i]! += row[i]!;
  }
  for (let i = 0; i < width; i++) mean[i]! /= rows.length;
  const spread = new Float64Array(width);
  for (const row of rows) {
    for (let i = 0; i < width; i++) spread[i]! += (row[i]! - mean[i]!) ** 2;
  }
  for (let i = 0; i < width; i++) {
    spread[i] = Math.sqrt(spread[i]! / rows.length);
    if (!(spread[i]! > 0)) throw new Error(`Description ${i} scores every photo the same, so it can't be evened out`);
  }
  return { mean, spread };
}

/** Each category's score for a photo: its best description's, raw or evened out with [norms]. */
function categoryScores(row: Float32Array, categories: ScoredCategory[], norms: DescriptionNorms | null): { score: number; description: number }[] {
  const width = categories.reduce((n, c) => n + c.vectors.length, 0);
  if (row.length !== width) throw new Error(`A photo's scores (${row.length}) don't fit the categories' descriptions (${width})`);
  if (norms && norms.mean.length !== width) throw new Error(`The evened-out averages (${norms.mean.length}) don't fit the categories' descriptions (${width})`);
  let at = 0;
  return categories.map((c) => {
    let score = -Infinity;
    let description = -1;
    for (let i = 0; i < c.vectors.length; i++, at++) {
      const s = norms ? (row[at]! - norms.mean[at]!) / norms.spread[at]! : row[at]!;
      if (s > score) {
        score = s;
        description = i;
      }
    }
    return { score, description };
  });
}

const otherKind = (kind: CategoryKind): CategoryKind => (kind === 'clutter' ? 'counterweight' : 'clutter');

/** The photo's best and second-best category, from its [descriptionScores], raw or evened out with [norms]. */
export function matchPhoto(mediaKey: string, row: Float32Array, categories: ScoredCategory[], norms: DescriptionNorms | null): PhotoMatch {
  if (categories.length < 2) throw new Error('Matching needs at least two categories to compare');
  let best = -1;
  let bestDescription = -1;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  const bestOfKind: Record<CategoryKind, number> = { clutter: -Infinity, counterweight: -Infinity };
  categoryScores(row, categories, norms).forEach(({ score, description }, i) => {
    const kind = categories[i]!.category.kind;
    bestOfKind[kind] = Math.max(bestOfKind[kind], score);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = i;
      bestDescription = description;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });
  const otherKindScore = bestOfKind[otherKind(categories[best]!.category.kind)];
  if (otherKindScore === -Infinity) throw new Error('Matching needs both clutter categories and counterweights');
  return { mediaKey, best, description: bestDescription, bestScore, secondScore, otherKindScore };
}

/** One category's line in a photo's breakdown. */
export interface BreakdownRow {
  label: string;
  kind: CategoryKind;
  score: string;
  /** The description that scored best for this photo, which the category scores as. */
  description: string;
}

/** How one photo scored, for the developer page's hover card. */
export interface Breakdown {
  /** Where the photo went, and how far ahead of the runner-up. */
  heading: string;
  /** The best-scoring categories, best first. */
  rows: BreakdownRow[];
  /** How many categories scored lower than those shown, or null when all are shown. */
  more: string | null;
}

/** How a photo scored in each category, best first, showing the [shown] best; agrees with [matchPhoto] and [leadOf]. */
export function photoBreakdown(row: Float32Array, categories: ScoredCategory[], norms: DescriptionNorms | null, over: LeadOver, shown: number): Breakdown {
  if (categories.length < 2) throw new Error('A breakdown needs at least two categories to compare');
  // A stable sort keeps the earlier category first on a tie, as matchPhoto does.
  const ranked = categoryScores(row, categories, norms)
    .map((s, i) => ({ scored: categories[i]!, ...s }))
    .sort((a, b) => b.score - a.score);
  const first = ranked[0]!;
  const rival = over === 'next' ? ranked[1] : ranked.find((r) => r.scored.category.kind === otherKind(first.scored.category.kind));
  if (!rival) throw new Error('A breakdown needs both clutter categories and counterweights');
  return {
    heading: `${first.scored.category.label}, ${(first.score - rival.score).toFixed(3)} ahead of ${rival.scored.category.label}`,
    rows: ranked.slice(0, shown).map((r) => ({
      label: r.scored.category.label,
      kind: r.scored.category.kind,
      score: r.score.toFixed(3),
      description: r.scored.category.descriptions[r.description]!,
    })),
    more: ranked.length > shown ? `${ranked.length - shown} more ${ranked.length - shown === 1 ? 'category' : 'categories'} scored lower` : null,
  };
}

/** The categories of one kind, for the page's list of every category. */
export interface CategoryGroup {
  kind: CategoryKind;
  title: string;
  /** What the kind does to a photo that goes to it. */
  note: string;
  count: number;
  categories: Category[];
}

export interface CategoryList {
  /** "16 clutter categories and 7 counterweights". */
  summary: string;
  /** Clutter first, then counterweights, each in the order listed. */
  groups: CategoryGroup[];
}

export function categoryList(categories: readonly Category[]): CategoryList {
  const group = (kind: CategoryKind, title: string, note: string): CategoryGroup => {
    const ofKind = categories.filter((c) => c.kind === kind);
    return { kind, title, note, count: ofKind.length, categories: ofKind };
  };
  const groups = [
    group('clutter', 'Clutter', 'May be suggested for the trash.'),
    group('counterweight', 'Counterweights', 'Never suggested: they only take photos away from clutter, so a family photo in a car park goes to People, not Parking.'),
  ];
  const [clutterCount, counterweightCount] = [groups[0]!.count, groups[1]!.count];
  return {
    summary: `${clutterCount} clutter ${clutterCount === 1 ? 'category' : 'categories'} and ${counterweightCount} ${counterweightCount === 1 ? 'counterweight' : 'counterweights'}`,
    groups,
  };
}

export interface ClutterSettings {
  /** The best category's score must be at least this. */
  minScore: number;
  /** ... and at least this much above the next category's. */
  margin: number;
}

/** raw: a description's score as the AI model gives it. evened: evened out with [DescriptionNorms]. */
export type Scoring = 'raw' | 'evened';

/** Where the developer page's settings start for each scoring; evened scores count in spreads, so they run larger. */
export const STARTING_SETTINGS: Record<Scoring, ClutterSettings> = {
  raw: { minScore: 0, margin: 0.02 },
  evened: { minScore: 0, margin: 0.2 },
};

/** What is known about a photo besides its match: the same as Search uses. */
export interface ClutterPhoto {
  eligible: boolean;
  approved: boolean;
}

export interface CategoryPhoto {
  mediaKey: string;
  /** The category's description the photo scored as. */
  description: string;
  score: number;
  /** How far ahead of the runner-up category. */
  lead: number;
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
  /**
   * The close calls that cleared the minimum score but led by less than the minimum lead, and would
   * be trashable if counted, largest lead first: the photos a smaller minimum lead would add first.
   */
  justMissed: CategoryPhoto[];
}

export interface ClutterCounts {
  /** Every category, clutter and counterweights, largest trashable count first. */
  categories: CategoryCount[];
  /** Photos matched in all. */
  photos: number;
}

/** Description [index] of [category]: the phrase a match scored as, which must be one of its descriptions. */
function phrase(category: Category | undefined, index: number): string {
  const text = category?.descriptions[index];
  if (text === undefined) throw new Error(`A match names a description that isn't in its category (${category?.id ?? 'no category'}, ${index})`);
  return text;
}

/** Each photo counted for at most one category: its best, when that one is clearly ahead ([leadOf] [over]). */
export function countCategories(matches: PhotoMatch[], categories: Category[], photos: Map<string, ClutterPhoto>, settings: ClutterSettings, over: LeadOver): ClutterCounts {
  const counts = categories.map((category): CategoryCount => ({ category, trashable: [], protectedOrUnknown: 0, approved: 0, closeCalls: 0, justMissed: [] }));
  for (const m of matches) {
    const count = counts[m.best]!;
    const photo = photos.get(m.mediaKey);
    const trashable = photo !== undefined && photo.eligible && !photo.approved;
    const entry = { mediaKey: m.mediaKey, description: phrase(categories[m.best], m.description), score: m.bestScore, lead: leadOf(m, over) };
    if (m.bestScore < settings.minScore) {
      count.closeCalls++;
    } else if (entry.lead < settings.margin) {
      count.closeCalls++;
      if (trashable) count.justMissed.push(entry);
    } else if (!photo || !photo.eligible) {
      count.protectedOrUnknown++;
    } else if (photo.approved) {
      count.approved++;
    } else {
      count.trashable.push(entry);
    }
  }
  for (const c of counts) {
    c.trashable.sort((a, b) => b.score - a.score);
    c.justMissed.sort((a, b) => b.lead - a.lead);
  }
  counts.sort((a, b) => b.trashable.length - a.trashable.length);
  return { categories: counts, photos: matches.length };
}

/** The suggestions to show: clutter categories with at least [minPhotos] trashable photos. */
export function suggestions(counts: ClutterCounts, minPhotos: number): CategoryCount[] {
  return counts.categories.filter((c) => c.category.kind === 'clutter' && c.trashable.length >= minPhotos);
}

/** The page's lists: the suggestions, clutter with too few photos to suggest, and the counterweights. */
export interface CountSections {
  suggested: CategoryCount[];
  /** "Too few to suggest: …", or null when every clutter category is suggested. */
  tooFew: string | null;
  counterweights: CategoryCount[];
}

export function countSections(counts: ClutterCounts, minPhotos: number): CountSections {
  const suggested = suggestions(counts, minPhotos);
  const tooFew = counts.categories.filter((c) => c.category.kind === 'clutter' && !suggested.includes(c));
  return {
    suggested,
    tooFew: tooFew.length > 0 ? `Too few to suggest: ${tooFew.map(countLine).join(' · ')}` : null,
    counterweights: counts.categories.filter((c) => c.category.kind === 'counterweight'),
  };
}

/** The photos the developer page shows from one category, [size] of each, to judge where it goes wrong. */
export interface CategorySamples {
  /** The highest scores. */
  strongest: CategoryPhoto[];
  /** The lowest scores still counted, not repeating [strongest]. */
  weakest: CategoryPhoto[];
  /** Counted with the smallest leads, smallest first: what a larger minimum lead would drop first. */
  justCounted: CategoryPhoto[];
  /** Not counted, with the largest leads: what a smaller minimum lead would add first. */
  justMissed: CategoryPhoto[];
}

export function categorySamples(count: CategoryCount, size: number): CategorySamples {
  const all = count.trashable;
  return {
    strongest: all.slice(0, size),
    weakest: all.length > size * 2 ? all.slice(-size) : all.slice(size),
    justCounted: [...all].sort((a, b) => a.lead - b.lead).slice(0, size),
    justMissed: count.justMissed.slice(0, size),
  };
}

/**
 * Under a photo: its score and its lead over the runner-up. The lead is rounded down, so a lead just
 * under the minimum lead never shows as the minimum (0.01996 is "0.0199", not "0.0200"); the tiny
 * allowance keeps 0.0123 from showing as 0.0122 when multiplying lands a hair below.
 */
export function photoCaption(photo: CategoryPhoto): string {
  const lead = Math.floor(photo.lead * 10_000 + 1e-9) / 10_000;
  return `${photo.score.toFixed(3)} · lead ${lead.toFixed(4)} · “${photo.description}”`;
}

/**
 * Where every photo went, by kind: counted as clutter, counted as a counterweight, or a close call
 * (counted nowhere). Comparing it between scorings shows whether photos move from counterweights into
 * clutter, or only between counterweights. Counted includes protected, unknown and queued photos.
 */
export function kindTotals(counts: ClutterCounts): string {
  const counted = (kind: CategoryKind) =>
    counts.categories.filter((c) => c.category.kind === kind).reduce((sum, c) => sum + c.trashable.length + c.protectedOrUnknown + c.approved, 0);
  const closeCalls = counts.categories.reduce((sum, c) => sum + c.closeCalls, 0);
  const [clutter, counterweights] = [counted('clutter'), counted('counterweight')];
  if (clutter + counterweights + closeCalls !== counts.photos) throw new Error(`Counted photos (${clutter + counterweights + closeCalls}) don't add up to the photos matched (${counts.photos})`);
  const share = (x: number) => (counts.photos === 0 ? '' : ` (${Math.round((x / counts.photos) * 100)}%)`);
  return `Clutter ${n(clutter)}${share(clutter)} · counterweights ${n(counterweights)}${share(counterweights)} · close calls ${n(closeCalls)}${share(closeCalls)}`;
}

/** Whether a photo counts for its best category with these settings, as [countCategories] decides it. */
export function isCounted(match: PhotoMatch, settings: ClutterSettings, over: LeadOver): boolean {
  return match.bestScore >= settings.minScore && leadOf(match, over) >= settings.margin;
}

/** A photo counted for a category of one kind with raw scores and of the other kind evened out. */
export interface MovedPhoto {
  mediaKey: string;
  /** Indexes into the categories: where it was counted with raw scores, and evened out. */
  raw: number;
  evened: number;
  /** The description it scored as in each. */
  rawDescription: string;
  evenedDescription: string;
  /** Its evened-out score, which the list is ordered by. */
  evenedScore: number;
}

export interface ScoringMoves {
  /** Counterweights with raw scores, clutter evened out: what evening out would add to the suggestions. Highest evened-out score first. */
  toClutter: MovedPhoto[];
  /** Clutter with raw scores, counterweights evened out. Highest evened-out score first. */
  toCounterweights: MovedPhoto[];
}

/**
 * The photos that change kind between raw and evened-out scores, each scoring with its own settings.
 * Only photos that may be trashed and aren't queued: the ones a suggestion would offer. [raw] and
 * [evened] are the same photos in the same order, matched once each way.
 */
export function scoringMoves(raw: PhotoMatch[], evened: PhotoMatch[], categories: Category[], photos: Map<string, ClutterPhoto>, settings: Record<Scoring, ClutterSettings>, over: LeadOver): ScoringMoves {
  if (raw.length !== evened.length) throw new Error(`Both scorings must match the same photos (${raw.length} and ${evened.length})`);
  const moves: ScoringMoves = { toClutter: [], toCounterweights: [] };
  raw.forEach((r, i) => {
    const e = evened[i]!;
    if (r.mediaKey !== e.mediaKey) throw new Error('Both scorings must match the same photos in the same order');
    if (!isCounted(r, settings.raw, over) || !isCounted(e, settings.evened, over)) return;
    const [from, to] = [categories[r.best]!.kind, categories[e.best]!.kind];
    if (from === to) return;
    const photo = photos.get(r.mediaKey);
    if (!photo || !photo.eligible || photo.approved) return;
    (to === 'clutter' ? moves.toClutter : moves.toCounterweights).push({
      mediaKey: r.mediaKey,
      raw: r.best,
      evened: e.best,
      rawDescription: phrase(categories[r.best], r.description),
      evenedDescription: phrase(categories[e.best], e.description),
      evenedScore: e.bestScore,
    });
  });
  moves.toClutter.sort((a, b) => b.evenedScore - a.evenedScore);
  moves.toCounterweights.sort((a, b) => b.evenedScore - a.evenedScore);
  return moves;
}

/** "Evening out moves 1,336 photos from counterweights to clutter, and 15 the other way." */
export function movesLine(moves: ScoringMoves): string {
  return `Evening out moves ${n(moves.toClutter.length)} ${moves.toClutter.length === 1 ? 'photo' : 'photos'} from counterweights to clutter, and ${n(moves.toCounterweights.length)} the other way (only photos that may be trashed).`;
}

/** A piece of a caption, with the kind of category it names (null when it names none), so the page can colour counterweights. */
export interface CaptionPart {
  text: string;
  kind: CategoryKind | null;
}

/** Where a moved photo was counted in each scoring, and as which description: 'People “a selfie” → Products and shopping “a supermarket aisle”'. */
export function moveCaption(move: MovedPhoto, categories: Category[]): CaptionPart[] {
  const [raw, evened] = [categories[move.raw]!, categories[move.evened]!];
  return [
    { text: raw.label, kind: raw.kind },
    { text: ` “${move.rawDescription}” → `, kind: null },
    { text: evened.label, kind: evened.kind },
    { text: ` “${move.evenedDescription}”`, kind: null },
  ];
}

/**
 * The [count] photos whose best category scores lowest, lowest first: nothing in the list describes
 * them well, so they show what it may be missing (an ice cream matched "a city view" best, at 0.651).
 * Meant for raw scores; evened out, a low score means unremarkable, not undescribed.
 */
export function weakestMatches(matches: PhotoMatch[], count: number): PhotoMatch[] {
  return [...matches].sort((a, b) => a.bestScore - b.bestScore).slice(0, count);
}

/** A photo's best score and where it went: '0.590 · Ordinary scenes “a drink”'. */
export function matchCaption(match: PhotoMatch, categories: Category[]): CaptionPart[] {
  const category = categories[match.best];
  if (!category) throw new Error(`A match names a category that wasn't matched against (${match.best})`);
  return [
    { text: `${match.bestScore.toFixed(3)} · `, kind: null },
    { text: category.label, kind: category.kind },
    { text: ` “${phrase(category, match.description)}”`, kind: null },
  ];
}

/** [size] items spread evenly from the first to the last, so a sample covers the whole list, the same each time. */
export function evenSample<T>(items: T[], size: number): T[] {
  if (items.length <= size) return [...items];
  return Array.from({ length: size }, (_, i) => items[Math.floor((i * items.length) / size)]!);
}

/** The best-match scores' and leads' spread, to choose the settings: at 10%, 50% and 90% of photos. */
export function scoreSpread(matches: PhotoMatch[], over: LeadOver): { fraction: number; bestScore: number; lead: number }[] {
  if (matches.length === 0) return [];
  const best = matches.map((m) => m.bestScore).sort((a, b) => a - b);
  const lead = matches.map((m) => leadOf(m, over)).sort((a, b) => a - b);
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
