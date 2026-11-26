// Clutter by subject and setting (an experiment on the developer page dev-clutter.html, next to the
// single list in clutter.ts). A photo's one fingerprint mixes what it is of with where it was taken: a
// selfie in a supermarket matches both People and Products. So each category here is either a SUBJECT
// (what a photo is of) or a SETTING (where it is), and each photo gets its best subject and its best
// setting, scored separately so they never compete. Each category has a verdict (clutter, keep or
// neutral), and the pair decides: an exception for the exact pair first, then keep wins, then clutter.
// It takes strong evidence to call a photo clutter, and any credible sign of a keeper stops it: on each
// side, a keep category is heard when it is near the top (within the minimum lead of the best), and
// clutter only when it is first and clearly ahead of everything that isn't clutter (2026-11-20, after a
// party photo went to clutter: Food and drink 0.686 just ahead of People 0.684 left the subject no say).
// A third side, FORM, says what kind of image it is (Screenshots, against Not a screenshot), apart from
// what it shows: it doesn't touch keep or clutter, and a form that is clutter is a suggestion of its own,
// so a screenshot of a receipt is in Screenshots and in Receipts (2026-11-20: "a phone screenshot", as a
// setting, made a friend holding a phone at a bar clutter). Forms are in CHECKS (2026-11-25): each check is a
// competition of its own (Screenshots against Not a screenshot), so a photo can be in two checks, and a
// counterweight holds back its own check only.
// Decided 2026-11-20; see docs/cleanup-roadmap.md.
// 2026-11-21: scores raw or evened out (each scoring with its own settings); pooling, where descriptions
// that rise and fall together across the library share one vote ([Overlap]); and a floor: clutter must
// score clearly above a plain "a photo" (the BASELINE), which is close to every photo.

import { n } from '../shared/format';
import {
  descriptionStarts,
  leadText,
  nudged,
  phrase,
  smallestStep,
  weightedDescriptionScores,
  weightedScores,
  type BreakdownRow,
  type CaptionPart,
  type Category,
  type CategoryCount,
  type CategoryKind,
  type CategoryPhoto,
  type ChangeSummary,
  type ClutterPhoto,
  type ScoredCategory,
  type Scoring,
  type WeightChange,
} from './clutter';

/** baseline: no verdict and no side of its own; what any photo scores, for the floor ([AxisSettings.baseline]). */
export type Axis = 'subject' | 'setting' | 'form' | 'baseline';
/** The two sides whose verdicts decide keep or clutter; forms are decided in their checks ([checkOutcome]). */
export type ContentAxis = 'subject' | 'setting';
export type Verdict = 'clutter' | 'keep' | 'neutral';

/** A category of subject or setting. Its [kind] follows its verdict: clutter is clutter, keep and neutral are not. */
export interface AxisCategory extends Category {
  axis: Axis;
  verdict: Verdict;
  /**
   * A form's check: the forms of one check compete among themselves only, apart from subjects, settings and
   * other checks (2026-11-25: a photo can be a screenshot and an accidental shot; Not a screenshot holds
   * back Screenshots only). Missing on a form kept before checks existed: [DEFAULT_CHECK]. Only on forms.
   */
  check?: string;
}

/** The check of a form saved before checks existed: they all competed in one, as they do in it. */
export const DEFAULT_CHECK = 'Form';

/** The check a form belongs to. */
export function checkOf(category: AxisCategory): string {
  if (category.axis !== 'form') throw new Error(`${category.label} is a ${category.axis}, not in a check`);
  return category.check ?? DEFAULT_CHECK;
}

/** The checks of [categories], in the order their first form comes. */
export function checksOf(categories: readonly AxisCategory[]): string[] {
  return [...new Set(categories.filter((c) => c.axis === 'form').map(checkOf))];
}

/** Where a photo's outcome is decided: by subject and setting ('content'), or in one check. */
export type Side = 'content' | { check: string };

/** The side [category]'s photos are decided on. */
export const sideOf = (category: AxisCategory): Side => (category.axis === 'form' ? { check: checkOf(category) } : 'content');

/** An exception to the rule for one exact pair: this subject in this setting is clutter, or kept. */
export interface PairException {
  /** Category ids. */
  subject: string;
  setting: string;
  verdict: 'clutter' | 'keep';
}

export interface AxisList {
  categories: AxisCategory[];
  exceptions: PairException[];
}

export const kindOf = (verdict: Verdict): CategoryKind => (verdict === 'clutter' ? 'clutter' : 'counterweight');

const subject = (id: string, label: string, verdict: Verdict, descriptions: string[]): AxisCategory => ({ id, label, kind: kindOf(verdict), axis: 'subject', verdict, descriptions });
const setting = (id: string, label: string, verdict: Verdict, descriptions: string[]): AxisCategory => ({ id, label, kind: kindOf(verdict), axis: 'setting', verdict, descriptions });
const form = (check: string, id: string, label: string, verdict: Verdict, descriptions: string[]): AxisCategory => ({ id, label, kind: kindOf(verdict), axis: 'form', verdict, descriptions, check });
const baseline = (id: string, label: string, descriptions: string[]): AxisCategory => ({ id, label, kind: 'counterweight', axis: 'baseline', verdict: 'neutral', descriptions });

/**
 * The shipped list (2026-11-21, reviewed for coverage of everyday life and photography). Clutter is
 * specific objects photographed for a practical reason; keep is what must never be suggested; neutral is
 * everything else common, so that clutter never wins only because nothing else fits (a London skyline
 * went to Things to fix on "tools"). Keep wins, so a keep setting is never a place where clutter is
 * usually photographed (an airport keeps boarding passes, a café menus, a car warning lights): those are
 * neutral. Wording that the findings showed to work is kept (Products, Photos of screens, Memes, "a water
 * adventure"); noisy categories were narrowed (Signs, Things to fix). Screenshots are a form, decided on
 * their own against Not a screenshot. Lessons in docs/cleanup-roadmap.md, among them: no incidental words ("on a table", "held in
 * a hand"); no "a photo of the floor" or "of a ceiling" (they matched church interiors and frescoes).
 * 2026-11-23: tuned on the developer page against 999 labels, 266 of them random (lab e01–e37, docs/clutter-lab.md):
 * random precision 97.9%, recall 52.3%. Before a second library has been checked (docs/clutter-rules.md).
 * 2026-11-26: the developer page's list after a week of labelling against the rule book (docs/clutter-rules.md):
 * Architecture and interiors and Outfits and looks keep, Accidental shots a form against Intended photos, landmarks
 * seen as views.
 */
export const AXIS_LIST: AxisList = {
  categories: [
    subject('screens', 'Screen photos', 'clutter', ['a photo of a computer screen', 'a photo of a TV screen', 'a photo of a smartwatch screen']),
    subject('receipts', 'Receipts and invoices', 'clutter', ['a receipt', 'a long till receipt', 'an invoice', 'a bill', 'a delivery note or packing slip']),
    subject('documents', 'Documents and forms', 'clutter', ['a printed letter', 'a form', 'a contract', 'a page of printed text', 'a document']),
    subject('cards', 'Cards and IDs', 'clutter', ['a bank card', 'an ID card or driving licence', 'a passport photo page', 'a business card', 'a loyalty or membership card']),
    subject('whiteboards', 'Whiteboards and slides', 'clutter', ['a whiteboard with writing', 'a presentation slide on a projector screen', 'a flip chart']),
    subject('notes', 'Notes', 'clutter', ['handwritten notes', 'a sticky note', 'a to-do list']),
    subject('parking', 'Parking signs and numbers', 'clutter', ['a car park level sign', 'a parking space number', 'a parking ticket machine']),
    // Narrowed (2026-11-21): the noisiest category, it took street life, a protest, a carved door, neon shop signs and museum labels.
    subject('signs', 'Signs and timetables', 'clutter', [
      'a close-up of an information sign', 'a printed bus or train timetable', 'a sign with opening hours', 'a map on an information board', 'a paper notice on a noticeboard', 'a wifi password on a sign or card',
    ]),
    subject('menus', 'Menus', 'clutter', ['a restaurant menu', 'a menu board in a cafe']),
    subject('tickets', 'Tickets and passes', 'clutter', ['a paper ticket', 'a printed boarding pass', 'a boarding pass on a phone screen', 'a paper train ticket', 'an event ticket']),
    subject('products', 'Products', 'clutter', ['a product on a shop shelf', 'a price tag', 'a product label', 'product packaging', 'groceries in a shop', 'a product displayed in a store']),
    // Things at home (labels, lab r16): photos of an object held up or set on a table, to show someone, to buy it
    // again or to give it away. Most people take these; "household items around the home" held them back as
    // neutral. 11 more found for 1 more wrong in 783 labels. 2026-11-23: Everyday objects (neutral) folded in,
    // and the tools from Things to fix; its riskiest are rooms, to check with labels.
    subject('homeitems', 'Things to buy, sell or show', 'clutter', [
      'a single object on a table, photographed to show someone', 'an almost empty bottle or packet', 'an item laid out to be sold online',
      'a charger, cable or battery pack', 'a household product photographed at home', 'a tool on a workbench', 'tools laid out for a repair',
      // No "a bookshelf full of books" (2026-11-26): it took bookshops and libraries.
      'furniture in a room', 'kitchen appliances', 'household items around the home',
    ]),
    // Flat viewings and moving (labels, lab r21): rooms photographed to compare flats or to show the state of a
    // place when moving in or out, and the boxes and vans of a move; once the move is done they're clutter.
    // No wrong among 95 offered in 561 labels, once People took people standing in rooms (r22d).
    subject('viewings', 'Flat viewings and moving', 'clutter', [
      'an empty room in a flat to rent', 'an empty kitchen at a flat viewing', 'cardboard boxes packed for moving house', 'an empty wardrobe or cupboard', 'a bare room with no furniture',
    ]),
    // Food to buy or use up (labels, lab r21): what's in the fridge, an ingredients list, a use-by date, groceries
    // just bought; meals stay in Food and drink, which most people keep. No wrong among 43 offered in 561 labels.
    subject('groceries', 'Food to buy or use up', 'clutter', [
      'the ingredients list on a food packet', 'the inside of an open fridge', 'groceries unpacked on a kitchen counter', 'a use-by date on food packaging',
    ]),
    // No "a parcel on a doorstep" (2026-11-21): it took front doors, and people standing at them.
    subject('parcels', 'Parcels and deliveries', 'clutter', ['a cardboard delivery box', 'a shipping label on a parcel']),
    subject('codes', 'Labels, barcodes and QR codes', 'clutter', ['a barcode', 'a QR code', 'a serial number sticker', 'an appliance model plate', 'a care label on clothing', 'a laundry care label with washing symbols']),
    subject('readings', 'Meters and warning lights', 'clutter', ['a meter reading', 'a car dashboard warning light', 'a thermostat display', 'a bathroom scale display']),
    // Narrowed: "a damaged wall" took old stone walls, "a leaking pipe" a museum warship's engine.
    subject('repairs', 'Things to fix', 'clutter', [
      'a crack or damp patch on a wall', 'a broken household item', 'a leaking pipe under a sink', 'mould in the corner of a room', 'a tape measure showing a measurement',
    ]),
    subject('memes', 'Memes and forwarded images', 'clutter', [
      'a meme with text', 'a cartoon', 'a motivational quote image', 'a greeting image with text', 'a funny picture from the internet',
      'a cartoon image with a caption', 'text written over a picture', 'a greeting card image with flowers and text', 'a joke picture with a punchline',
    ]),
    // A person on stairs (lab r16): Things at home took a person on a staircase at home.
    // A person in a room, holding up a picture (lab r22d): Flat viewings took a person in a kitchen and one holding
    // a framed picture in a show flat. 3 fewer wrong for 8 less clutter found in 561 labels.
    // An audience (lab r9, raw scores): people in a wide shot lost to what was in front of them, audiences at talks
    // went to Whiteboards. "A person working at a desk" kept desk setups with nobody in them; "a person working"
    // and "friends working together" keep the people without the desks (2026-11-26).
    subject('people', 'People', 'keep', [
      'a portrait of a person', 'a group of people smiling', 'a selfie', 'people at a party', 'a couple together', 'a family photo', 'friends together', 'photo of a person holding a phone',
      'a mirror selfie', 'grandparents with their grandchildren', 'people sharing a meal', 'people dancing', 'a pregnant belly', 'an audience at a talk or show',
      'a person on stairs or in a hallway', 'a person standing in a room at home', 'a person holding up a picture or poster',
      // 2026-11-23 (lab e03): people at a meal or a café went to Food and drink and Things to buy; a person on a
      // train or posing by a car went to Transport and Vehicles.
      'a person eating or drinking', 'a selfie with a drink or food', 'friends at a table in a cafe or restaurant', 'a person sitting alone at a cafe table',
      'a person sitting on a train or bus', 'a person posing next to a car',
      'friends working together', 'a person working',
    ]),
    // "A child using a tablet or computer": children at computers went to Photos of screens. "In a shopping trolley" (lab e03): to Products.
    subject('children', 'Children', 'keep', [
      'a baby', 'a child playing', 'a toddler', 'children at a birthday party', "a child's drawing", 'a child using a tablet or computer', 'a child in school uniform', 'a school play or performance',
      'a child in a shopping trolley',
    ]),
    subject('celebrations', 'Festive things', 'keep', [
      'a birthday cake with candles', 'a decorated Christmas tree', 'wrapped presents', 'balloons and party decorations', 'a wedding cake', 'fireworks in the night sky',
      'a Halloween costume or carved pumpkin', 'people raising glasses in a toast', 'festival lights and lanterns', 'painted Easter eggs',
    ]),
    subject('animals', 'Pets and animals', 'keep', ['a dog', 'a cat', 'a pet', 'a bird', 'an animal', 'a horse', 'farm animals', 'fish in an aquarium', 'a butterfly or insect']),
    subject('journeys', 'Journeys', 'keep', ['a view from a train window', 'a view from an airplane window', 'a meal on a tray table on a plane or train', 'a view from a ship or ferry', 'a road trip through open country']),
    // Views are what a photo is of: as a setting, "a landscape" crowded out the landmark in a skyline. A famous
    // landmark is seen as a view (2026-11-26), not as art.
    subject('views', 'Views, scenery and landmarks', 'keep', [
      'a city skyline', 'a view over a river or harbour', 'a view from a high viewpoint', 'a landscape', 'a sunset', 'an aerial view from above', 'city lights at night', 'a starry night sky', 'a rainbow or dramatic clouds',
      'a famous landmark',
    ]),
    // The fresco: the Sistine Chapel went to Signs, a painted ceiling to Accidental shots. The object on display: a museum warship's engine went to Things to fix.
    subject('landmarks', 'Monuments and art', 'keep', [
      'a historic monument or statue', 'art in a museum', 'a sculpture', 'a painted ceiling or fresco', 'stained glass windows', 'street art or a mural', 'a historic object on display',
    ]),
    subject('hobbies', 'Hobbies and things made', 'keep', ['a handmade craft project', 'knitting or sewing', 'a painting or drawing in progress', 'a Lego or model build', 'a musical instrument', 'a board game being played']),
    subject('memories', 'Old photos and keepsakes', 'keep', [
      'a scanned old photograph', 'an old printed photo', 'a handwritten letter from family', 'an old paper document', 'an ultrasound scan picture', 'a page of an old photo album', 'a framed family photo',
    ]),
    // Neutral (lab e01): as clutter it took meals with friends, a pizza night, cocktails with a view.
    subject('food', 'Food and drink', 'neutral', [
      'a meal on a plate', 'a drink', 'an ice cream cone', 'a dessert', 'street food', 'a snack', 'a cup of coffee', 'a glass of wine or a cocktail', 'food cooking in a pan', 'a home-baked cake or bread',
      'pizza',
    ]),
    // Neutral, not keep: greeting images with flowers are memes.
    subject('plants', 'Plants and flowers', 'neutral', ['a flower in bloom', 'a bouquet of flowers', 'a houseplant', 'a tree in blossom']),
    subject('vehicles', 'Vehicles', 'neutral', ['a classic car', 'a motorbike', 'a boat', 'a bicycle', 'a train', 'an aeroplane']),
    // Keep (2026-11-26): outfits and looks are a person's, people differ on them (docs/clutter-rules.md), and as
    // neutral they let a clutter subject win. Clothes on a hanger, shoes and jewellery not worn are things in a shop.
    // ("warn" as on the page, where it was measured; to correct with the next tuning.)
    subject('clothes', 'Outfits and looks', 'keep', ['a pair of shoes warn', 'an outfit laid out', 'painted fingernails', 'jewellery or a watch warn']),
    subject('health', 'Health and body', 'neutral', ['a close-up of skin', 'an injury or bruise', 'a plaster cast or bandage']),
    // A subject for buildings (lab r8–r9): without one, shop fronts, station halls and buildings went to Signs and
    // Parking. Its own descriptions: "a shop front with its sign" stays a setting (Streets), whose places it
    // describes; taken from there, keep settings were heard on street photos instead.
    subject('buildings', 'Buildings and shop fronts', 'neutral', ['the front of a building', 'a station or airport hall', 'a shop front']),
    // Striking interiors (2026-11-26, docs/clutter-rules.md): a museum's hall, a converted warehouse, a stylish bar.
    // Not offices, coworking spaces or shopping centres. (Its id is the page's, which labels and weights name.)
    subject('custom-architecture-and-interiors', 'Architecture and interiors', 'keep', ['a converted factory or warehouse venue', 'a striking venue', 'a cosy café interior', 'a stylish bar']),
    setting('carparks', 'Car parks', 'clutter', ['a car park', 'a multi-storey car park', 'an underground car park']),
    setting('shops', 'Shops', 'neutral', ['a supermarket aisle', 'inside a shop', 'a shopping centre', 'a street market']),
    setting('eating', 'Restaurants, cafés and bars', 'neutral', ['a cafe', 'inside a restaurant', 'a bar or pub']),
    // Neutral: tickets, boarding passes, timetables and warning lights are photographed here. Selfies and window views are kept by their subject.
    setting('transport', 'Transport and stations', 'neutral', ['inside a car', 'inside a train', 'inside an airplane cabin', 'an airport terminal', 'a train station platform', 'a bus stop']),
    setting('travel', 'Holidays and hotels', 'keep', ['a hotel room', 'a holiday resort', 'a cruise ship']),
    // The stone wall: old walls went to "a damaged wall". The cloister: a cloister corridor nearly went to Accidental shots.
    setting('heritage', 'Museums and historic places', 'keep', [
      'a museum room', 'an ancient building, ruin or stone wall', 'an art gallery', 'inside a cathedral or church', 'a temple, mosque or synagogue', 'a castle or palace', 'a historic old town', 'a cloister or monastery courtyard',
    ]),
    setting('nature', 'Nature', 'keep', ['a beach', 'mountains', 'a forest', 'a lake', 'a garden', 'a river or waterfall', 'the open sea', 'countryside and farmland', 'deep snow in winter', 'a desert', 'a park with trees']),
    setting('occasions', 'Occasions', 'keep', ['a wedding', 'a Christmas celebration', 'a family dinner', 'a graduation', 'a funeral', 'a baby shower', 'a christening or baptism', 'a religious festival']),
    // "A water adventure" found every diving, snorkelling and fishing photo in Search; "underwater": a diver went to Accidental shots; the protest went to Signs.
    setting('adventures', 'Adventures and events', 'keep', [
      'an outdoor adventure', 'a water adventure', 'a sky adventure', 'a sports game', 'a concert', 'a party', 'a zoo', 'a playground', 'an art exhibition',
      'underwater in the sea', 'a ski slope', 'a hiking trail in the mountains', 'a campsite with tents', 'a swimming pool', 'a gym', 'a music festival', 'a theatre stage',
      'a funfair or theme park', 'a nightclub dance floor', 'a protest or march with placards',
    ]),
    setting('home', 'Home', 'neutral', ['a room in a house', 'a kitchen', 'a bedroom', 'a bathroom', 'a balcony or terrace']),
    setting('streets', 'Streets and buildings', 'neutral', ['a street', 'a building', 'a city view', 'a residential street with houses', 'a shop front with its sign']),
    setting('work', 'Work and study', 'neutral', ['an office with desks', 'a meeting room', 'a classroom or lecture hall', 'a building site', 'a workshop or garage']),
    setting('hospitals', 'Hospitals and clinics', 'neutral', ['a hospital room', "a doctor's waiting room"]),
    // A close-up has no place, and without this one it got the least wrong: a smartwatch on a wrist "a sports
    // game", a TV "the open sea", and the keep setting kept it (2026-11-23, lab e35: random recall 44% → 52%).
    setting('closeup', 'Close-up, no clear place', 'neutral', ['a close-up of an object', 'an object filling the frame', 'a close-up of a screen']),
    // A form again (2026-11-21): as a setting, Screenshots won wherever no place fitted (selfies, hands, close-ups).
    form('Screenshots', 'screenshots', 'Screenshots', 'clutter', [
      'a phone screenshot', 'screenshot of a text message', 'a screenshot of a chat conversation', 'a screenshot of a web page', 'a screenshot of an app', 'a screenshot of a social media post', 'a screenshot of a computer desktop',
    ]),
    // Accidental shots, a form since 2026-11-26: whether a photo was taken on purpose is about the shot, not what
    // it shows, so it is decided against Intended photos, not against the subjects (a blurred selfie is still a selfie).
    form('Quality', 'accidental', 'Accidental shots', 'clutter', [
      'a blurry photo taken by accident', 'a dark photo with nothing visible', 'an out of focus blurry photo', 'a motion-blurred photo, shaky camera', 'an almost completely black photo',
      'a photo taken inside a pocket, dark and blurred', 'a finger covering the camera lens', 'a photo of the floor taken by accident', 'a photo of the ceiling taken by accident',
      'a dark grainy photo where nothing can be made out',
    ]),
    // What the AI takes for a screenshot without being one. A phone in someone's hand; and (2026-11-21,
    // lab r1–r4, raw scores) camera photos of things, rooms and desks, which took the edge of Screenshots:
    // products and tags, home offices with monitors, laptops on tables, and children at a computer (on the
    // form side keepers don't stop it). With them its Riskiest held no photo anyone would keep; the cost, a
    // few real screenshots of posts at the very edge. "A screenshot of a news article" was tried for those
    // and dropped: it took photographed printed pages.
    form('Screenshots', 'photos', 'Not a screenshot', 'neutral', [
      'a person holding a phone', "a photo of a phone in someone's hand", 'people at a table with their phones', 'a photo taken with a camera',
      'a photo of a product in a shop', 'a close-up photo of an object', 'a photo of a room', 'people sitting at a computer', 'a laptop on a table',
    ]),
    form('Quality', 'custom-intended-photos', 'Intended photos', 'neutral', [
      'a city lit up at night', 'a sharp, well-lit photo', 'a clear photo of people', 'a clear photo of a place', 'a clear photo of an object', 'an ordinary everyday photo',
      'a person posing for the camera', 'people inside a room', 'the inside of a shop or office', 'a room with furniture', 'clear text',
    ]),
    baseline('baseline', 'Any photo', ['a photo', 'a picture']),
  ],
  // Paper and readings are clutter wherever they are photographed: a receipt on holiday, a ticket at a museum
  // (lab e04: Documents 19 → 51, no new wrong). Not Screen photos: a screen at a concert or a match is a memory.
  exceptions: ['documents', 'cards', 'receipts', 'readings', 'codes', 'notes', 'tickets', 'whiteboards'].flatMap((subject) =>
    ['travel', 'heritage', 'nature', 'occasions', 'adventures'].map((setting) => ({ subject, setting, verdict: 'clutter' as const })),
  ),
};

/** What a subject, or a setting, needs to count: its score at least [minScore], its lead over the next of its axis at least [margin]; less is too close. */
export interface AxisLead {
  minScore: number;
  margin: number;
}

/** The axes with a side of their own: each photo's best of each is picked ([AxisMatch]). */
export type SideAxis = 'subject' | 'setting' | 'form';

/** The settings of the subject-and-setting matching, for one scoring: what each axis needs to count, pooling, the floor and the weights. */
export interface AxisSettings {
  subject: AxisLead;
  setting: AxisLead;
  form: AxisLead;
  /** A category's own minimum lead, by its id, in place of its axis's. */
  margins: Record<string, number>;
  categoryWeights: Record<string, number>;
  descriptionWeights: Record<string, number>;
  /** How far behind the best a description still adds to its pool ([pooled]); 0: only the best counts. */
  pooling: number;
  /** The floor: how far above the best baseline description ("a photo") clutter must score to count; null: no floor. */
  baseline: number | null;
}

/**
 * Each scoring's settings with nothing tuned: no category's own lead, no weights, no pooling, no floor;
 * what a setting missing from saved settings falls back to. Evened-out scores count in spreads, so they
 * run larger; for them a minimum score of 0 means at least the description's average.
 */
export const PLAIN_AXIS_SETTINGS: Record<Scoring, AxisSettings> = {
  raw: { subject: { minScore: 0, margin: 0.02 }, setting: { minScore: 0, margin: 0.02 }, form: { minScore: 0, margin: 0.02 }, margins: {}, categoryWeights: {}, descriptionWeights: {}, pooling: 0, baseline: null },
  evened: { subject: { minScore: 0, margin: 0.3 }, setting: { minScore: 0, margin: 0.3 }, form: { minScore: 0, margin: 0.3 }, margins: {}, categoryWeights: {}, descriptionWeights: {}, pooling: 0, baseline: null },
};

/** What the page starts with: the plain settings, raw ones tuned with the shipped list ([AXIS_LIST]), whose ids and descriptions they name. */
export const STARTING_AXIS_SETTINGS: Record<Scoring, AxisSettings> = {
  // Tuned with the list (2026-11-23, lab e21–e37): smaller leads where no wrong photo came with them, larger for
  // Signs, Things to fix and Parcels, whose edges failed; weights for the categories that missed most.
  raw: {
    subject: { minScore: 0, margin: 0.02 },
    setting: { minScore: 0, margin: 0.02 },
    form: { minScore: 0, margin: 0.02 },
    margins: {
      products: 0.005, documents: 0.01, viewings: 0.01, groceries: 0.01, codes: 0.01, menus: 0.01, receipts: 0.01, notes: 0.01, readings: 0.01, screens: 0.01,
      signs: 0.035, repairs: 0.035, parcels: 0.035,
      // Accidental shots, a form since 2026-11-26, needs a clear lead over Intended photos.
      accidental: 0.03,
    },
    categoryWeights: { products: 0.02, homeitems: 0.015, viewings: 0.015, screens: 0.01, memes: 0.005 },
    descriptionWeights: { 'a page of printed text': 0.0034, 'a child playing': 0.0335 },
    pooling: 0.02,
    baseline: null,
  },
  // Not in use (raw is): as left on the developer page (2026-11-26), for whoever tries evened-out scores next.
  evened: { ...PLAIN_AXIS_SETTINGS.evened, margins: { products: 0.1 }, pooling: 0.3, baseline: 0.3 },
};

/** Where pooling starts when it is turned on, per scoring. */
export const STARTING_POOLING: Record<Scoring, number> = { raw: 0.02, evened: 0.3 };
/** Where the floor starts when it is turned on, per scoring. */
export const STARTING_FLOOR: Record<Scoring, number> = { raw: 0.02, evened: 0.3 };

export interface ScoredAxis {
  category: AxisCategory;
  vectors: Float32Array[];
}

/**
 * How much each pair of descriptions rises and falls together across the library, from 0 (apart) to 1
 * (the same), by their places in a row of scores ([descriptionScores]). In a pool, a description's vote
 * shrinks by how much it shares with one scoring above it, so "a city view", "a landscape" and "a sky
 * adventure" count as about one, and "a famous landmark" as one of its own.
 */
export interface Overlap {
  width: number;
  /** [width] × [width], row by row. */
  values: Float32Array;
}

/** No overlap: every description stands apart (and with itself, 1). */
export function apart(width: number): Overlap {
  const values = new Float32Array(width * width);
  for (let i = 0; i < width; i++) values[i * width + i] = 1;
  return { width, values };
}

/**
 * The overlap of every pair of descriptions over [rows], each photo's scores evened out ([evenedRow]).
 * Each photo's own average over all descriptions is taken off first: some photos score high on
 * everything, which would make every pair look alike. Then each pair's correlation over the photos, 0
 * when they go opposite ways.
 */
export function descriptionOverlap(rows: Float32Array[]): Overlap {
  if (rows.length < 2) throw new Error('Measuring how descriptions overlap needs at least two photos');
  const width = rows[0]!.length;
  const sum = new Float64Array(width);
  const products = new Float64Array(width * width);
  const centred = new Float64Array(width);
  for (const row of rows) {
    if (row.length !== width) throw new Error(`Photos were scored against different descriptions (${row.length} and ${width})`);
    let average = 0;
    for (let i = 0; i < width; i++) average += row[i]!;
    average /= width;
    for (let i = 0; i < width; i++) {
      centred[i] = row[i]! - average;
      sum[i]! += centred[i]!;
    }
    for (let a = 0; a < width; a++) {
      const ca = centred[a]!;
      const base = a * width;
      for (let b = a; b < width; b++) products[base + b]! += ca * centred[b]!;
    }
  }
  const count = rows.length;
  const values = new Float32Array(width * width);
  const spread = (i: number) => Math.sqrt(Math.max(0, products[i * width + i]! / count - (sum[i]! / count) ** 2));
  for (let a = 0; a < width; a++) {
    values[a * width + a] = 1;
    for (let b = a + 1; b < width; b++) {
      const covariance = products[a * width + b]! / count - (sum[a]! / count) * (sum[b]! / count);
      const s = spread(a) * spread(b);
      const r = s > 0 ? Math.max(0, Math.min(1, covariance / s)) : 0;
      values[a * width + b] = r;
      values[b * width + a] = r;
    }
  }
  return { width, values };
}

/** How many of a pool's votes count, the best's included: at most `pooling × ln 3` above the best. */
export const POOLED = 3;
/** A vote smaller than this is left out of a pool: more than 4.6 poolings behind the best. */
const SMALLEST_VOTE = 0.01;

/** A pool's score, and each counted description's vote by its place in the row. */
interface Pool {
  score: number;
  votes: Map<number, number>;
}

/**
 * Several descriptions' scores as one: the best, plus `pooling × ln(sum of votes)`. Taken best first,
 * each votes exp(−gap ÷ pooling) (1 level with the best, 0.37 one pooling behind) times what it doesn't
 * share with the most alike of those above it ([Overlap]); only the [POOLED] largest votes count, so a
 * photo nothing describes well gains little for their number. Pooling 0: the best alone.
 */
function pooled(at: number[], scores: Float64Array, overlap: Overlap, pooling: number): Pool {
  if (at.length === 0) return { score: -Infinity, votes: new Map() };
  let best = at[0]!;
  for (const i of at) if (scores[i]! > scores[best]!) best = i;
  if (pooling === 0) return { score: scores[best]!, votes: new Map() };
  const top = scores[best]!;
  const near = at.filter((i) => Math.exp((scores[i]! - top) / pooling) >= SMALLEST_VOTE).sort((a, b) => scores[b]! - scores[a]! || a - b);
  const above: number[] = [];
  const all: [number, number][] = [];
  for (const i of near) {
    let shared = 0;
    for (const j of above) shared = Math.max(shared, overlap.values[i * overlap.width + j]!);
    all.push([i, Math.exp((scores[i]! - top) / pooling) * (1 - shared)]);
    above.push(i);
  }
  const counted = all.sort((a, b) => b[1] - a[1]).slice(0, POOLED);
  return { score: top + pooling * Math.log(counted.reduce((s, [, vote]) => s + vote, 0)), votes: new Map(counted) };
}

/** A keep category heard on one axis: near the top, if not first. */
export interface Keeper {
  /** Index into the categories. */
  index: number;
  /** Index into its descriptions: the one the photo scores as. */
  description: number;
  score: number;
}

/** A photo's best category on one axis, and what it is measured against. */
export interface AxisPick {
  /** Index into the categories. */
  best: number;
  /** Index into its descriptions: the one the photo scores as. */
  description: number;
  score: number;
  /**
   * The best category of the same axis with another verdict (index into the categories), which [lead] is
   * measured against: two of the same verdict close together don't make each other too close, as the
   * photo comes to the same either way. Null when every category of the axis has the same verdict.
   */
  rival: number | null;
  /** How far ahead of [rival] (Infinity with no rival): its verdict's pool over the other verdicts' pool ([pooled]), with no pooling [score] over [rival]'s. */
  lead: number;
  /** Its verdict's pool, and the other verdicts' (null with none), which [lead] is the difference of. */
  ownScore: number;
  rivalScore: number | null;
  /** How far [score] is above the best baseline description, or null when the list has none. */
  baselineGap: number | null;
  /** The votes of the descriptions counted in its pools, by their places in the row; empty with no pooling. */
  votes: ReadonlyMap<number, number>;
  /** Far enough ahead to count ([AxisLead]); otherwise it is too close, and has no say. */
  counts: boolean;
  /**
   * The best keep category of this axis when it is heard: first, or within the minimum lead of the
   * first (its own, or the axis's), and at least the minimum score. Keep wins, so a keeper close behind
   * is enough to keep the photo. Null when no keep category is near the top.
   */
  keeper: Keeper | null;
}

export interface AxisMatch {
  mediaKey: string;
  subject: AxisPick;
  setting: AxisPick;
  /** One per check ([checksOf]), in its order: its best form against its forms of another verdict. */
  checks: CheckPick[];
}

export interface CheckPick extends AxisPick {
  check: string;
}

/**
 * The photo's best subject, best setting and best form, each against the others of its own axis only,
 * from its scores ([row], raw or evened out, as [settings] are for), weighted and pooled with
 * [settings]; [overlap] is how the descriptions overlap, for pooling.
 */
export function matchAxes(mediaKey: string, row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings): AxisMatch {
  const all = weightedDescriptionScores(row, scored as ScoredCategory[], settings);
  if (overlap.width !== all.length) throw new Error(`The overlaps (${overlap.width}) don't fit the descriptions (${all.length})`);
  if (!(settings.pooling >= 0)) throw new Error(`Pooling must be 0 or more (${settings.pooling})`);
  const scores = weightedScores(row, scored as ScoredCategory[], settings);
  const starts = descriptionStarts(scored as ScoredCategory[]);
  const places = (categories: number[]) => categories.flatMap((k) => scored[k]!.vectors.map((_, i) => starts[k]! + i));
  // Strictly higher: on a tie the earlier category wins.
  const highest = (among: number[]) => among.reduce<number | null>((b, i) => (b === null || scores[i]!.score > scores[b]!.score ? i : b), null);
  const baselines = scored.map((_, i) => i).filter((i) => scored[i]!.category.axis === 'baseline');
  const floorAt = highest(baselines);
  if (settings.baseline !== null && floorAt === null) throw new Error('The floor needs a baseline description (“a photo”) in the list');
  const floor = floorAt === null ? null : scores[floorAt]!.score;
  const pick = (axis: SideAxis, check: string | null = null): AxisPick | null => {
    const on = scored.map((_, i) => i).filter((i) => scored[i]!.category.axis === axis && (check === null || checkOf(scored[i]!.category) === check));
    if (on.length === 0) return null;
    const best = highest(on)!;
    const { score, description } = scores[best]!;
    const verdict = scored[best]!.category.verdict;
    const others = on.filter((i) => scored[i]!.category.verdict !== verdict);
    const rival = highest(others);
    const own = pooled(places(on.filter((i) => scored[i]!.category.verdict === verdict)), all, overlap, settings.pooling);
    const against = rival === null ? null : pooled(places(others), all, overlap, settings.pooling);
    const lead = against === null ? Infinity : own.score - against.score;
    const needs = settings[axis];
    const marginOf = (i: number) => settings.margins[scored[i]!.category.id] ?? needs.margin;
    const baselineGap = floor === null ? null : score - floor;
    const aboveFloor = verdict !== 'clutter' || settings.baseline === null || baselineGap! >= settings.baseline;
    const counts = score >= needs.minScore && lead >= marginOf(best) && aboveFloor;
    const keepers = on.filter((i) => scored[i]!.category.verdict === 'keep');
    const keep = highest(keepers);
    const keepPool = keep === null || verdict === 'keep' ? own : pooled(places(keepers), all, overlap, settings.pooling);
    const heard = keep !== null && scores[keep]!.score >= needs.minScore && (keep === best || keepPool.score >= own.score - marginOf(keep));
    const votes = new Map([...(against?.votes ?? []), ...keepPool.votes, ...own.votes]);
    return {
      best,
      description,
      score,
      rival,
      lead,
      ownScore: own.score,
      rivalScore: against?.score ?? null,
      baselineGap,
      votes,
      counts,
      keeper: heard ? { index: keep, description: scores[keep]!.description, score: scores[keep]!.score } : null,
    };
  };
  const subjectPick = pick('subject');
  const settingPick = pick('setting');
  if (!subjectPick || !settingPick) throw new Error(`Matching needs at least one ${subjectPick ? 'setting' : 'subject'} category`);
  const checks = checksOf(scored.map((s) => s.category)).map((check): CheckPick => ({ ...pick('form', check)!, check }));
  return { mediaKey, subject: subjectPick, setting: settingPick, checks };
}

/** What a photo comes to: clutter (in [category], the one that made it so), kept (by [category]), or neither. */
export interface Outcome {
  verdict: 'clutter' | 'keep' | 'none';
  /** Index into the categories: the one that decided it; null for neither. */
  category: number | null;
  /** "People keeps", "Products is clutter", "Exception: Things to fix or sell in Shops", "nothing that counts says clutter". */
  reason: string;
}

/**
 * The verdict of a photo's subject and setting. An exception for the exact pair first (both count); then
 * keep, when a keep category is heard on either side (near the top: [AxisPick.keeper]); then clutter, when
 * a side's best is clutter and counts (clearly ahead of everything that isn't clutter), the subject's
 * first. Otherwise neither.
 */
export function axisOutcome(match: AxisMatch, categories: readonly AxisCategory[], exceptions: readonly PairException[]): Outcome {
  const { subject: s, setting: t } = match;
  const [subjectCategory, settingCategory] = [categories[s.best]!, categories[t.best]!];
  if (s.counts && t.counts) {
    const exception = exceptions.find((e) => e.subject === subjectCategory.id && e.setting === settingCategory.id);
    if (exception) {
      const reason = `Exception: ${subjectCategory.label} in ${settingCategory.label}`;
      return exception.verdict === 'keep' ? { verdict: 'keep', category: s.best, reason } : { verdict: 'clutter', category: subjectCategory.verdict === 'clutter' || settingCategory.verdict !== 'clutter' ? s.best : t.best, reason };
    }
  }
  for (const pick of [s, t]) {
    const k = pick.keeper;
    if (k) return { verdict: 'keep', category: k.index, reason: k.index === pick.best ? `${categories[k.index]!.label} keeps` : `${categories[k.index]!.label} keeps (close to the top)` };
  }
  for (const pick of [s, t]) if (pick.counts && categories[pick.best]!.verdict === 'clutter') return { verdict: 'clutter', category: pick.best, reason: `${categories[pick.best]!.label} is clutter` };
  return { verdict: 'none', category: null, reason: 'nothing that counts says clutter' };
}

/** The pick of [match] on [category]'s axis. */
function pickOf(match: AxisMatch, categories: readonly AxisCategory[], category: number): AxisPick {
  const axis = categories[category]!.axis;
  if (axis === 'baseline') throw new Error(`${categories[category]!.label} is a baseline: it decides nothing on its own`);
  const pick = axis === 'form' ? match.checks.find((c) => c.check === checkOf(categories[category]!)) : match[axis];
  if (!pick) throw new Error(`The photo has no ${categories[category]!.axis} to measure ${categories[category]!.label} by`);
  return pick;
}

/**
 * What a photo comes to in [check], on its own: clutter (a suggestion of its own) when the check's best form
 * counts (clearly ahead of every form of the check of another verdict) and is clutter; otherwise none, with
 * [Outcome.category] the best form, to name it, or null when the list has no such check. Keepers don't stop it.
 */
export function checkOutcome(match: AxisMatch, categories: readonly AxisCategory[], check: string): Outcome {
  const f = match.checks.find((c) => c.check === check);
  if (!f) return { verdict: 'none', category: null, reason: `no ${check} check in the list` };
  const label = categories[f.best]!.label;
  if (f.counts && categories[f.best]!.verdict === 'clutter') return { verdict: 'clutter', category: f.best, reason: `${label} is clutter` };
  return { verdict: 'none', category: f.best, reason: f.counts ? label : `${label}, too close` };
}

/** What the photo comes to in each check, in their order. */
export function checkOutcomes(match: AxisMatch, categories: readonly AxisCategory[]): Outcome[] {
  return match.checks.map((c) => checkOutcome(match, categories, c.check));
}

/** The outcome of [match] on [side]. */
export function sideOutcome(match: AxisMatch, categories: readonly AxisCategory[], exceptions: readonly PairException[], side: Side): Outcome {
  return side === 'content' ? axisOutcome(match, categories, exceptions) : checkOutcome(match, categories, side.check);
}

/** The outcome that decides whether [category] has a photo: its check for a form, otherwise the subject-and-setting rule. */
function outcomeFor(match: AxisMatch, categories: readonly AxisCategory[], exceptions: readonly PairException[], category: number): Outcome {
  return sideOutcome(match, categories, exceptions, sideOf(categories[category]!));
}

export interface AxisCounts {
  /** Clutter subjects and settings, each with the photos it makes clutter, largest first. */
  clutter: CategoryCount[];
  /** Clutter forms (Screenshots), each with its photos, largest first: each check's suggestions of their own, a photo also in one above or in another check. */
  forms: CategoryCount[];
  /** Keep categories, each with the photos it keeps, largest first. */
  keepers: CategoryCount[];
  /** "Clutter 3,600 (21%) · kept 9,915 (57%) · neither 3,771 (22%)". */
  totals: string;
  photos: number;
}

/**
 * Each photo counted once: for the clutter category that makes it clutter, or the keep category that
 * keeps it. [CategoryCount.justMissed] of a clutter category: photos it is the best of its axis for but
 * too close to count, which would be clutter there if it counted, largest lead first.
 */
export function countAxes(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[], photos: Map<string, ClutterPhoto>, settings: AxisSettings): AxisCounts {
  const counts = categories.map((category): CategoryCount => ({ category, trashable: [], protectedOrUnknown: 0, approved: 0, closeCalls: 0, justMissed: [] }));
  let [clutter, kept, neither, screenshots] = [0, 0, 0, 0];
  for (const m of matches) {
    const outcome = axisOutcome(m, categories, exceptions);
    const photo = photos.get(m.mediaKey);
    const trashable = photo !== undefined && photo.eligible && !photo.approved;
    for (const pick of [m.subject, m.setting, ...m.checks]) {
      if (pick.counts || categories[pick.best]!.verdict !== 'clutter') continue;
      counts[pick.best]!.closeCalls++;
      const needs = settings[categories[pick.best]!.axis as SideAxis];
      if (!trashable || pick.score < needs.minScore) continue;
      // Would it be clutter here if this pick counted?
      const counting: AxisMatch =
        pick === m.subject ? { ...m, subject: { ...pick, counts: true } } : pick === m.setting ? { ...m, setting: { ...pick, counts: true } } : { ...m, checks: m.checks.map((c) => (c === pick ? { ...c, counts: true } : c)) };
      const would = outcomeFor(counting, categories, exceptions, pick.best);
      if (would.verdict === 'clutter' && would.category === pick.best) counts[pick.best]!.justMissed.push({ mediaKey: m.mediaKey, description: phrase(categories[pick.best], pick.description), score: pick.score, lead: pick.lead });
    }
    // Each check: a suggestion of its own, whatever the subject, the setting and the other checks come to.
    let checked = false;
    for (const f of m.checks) {
      const formed = checkOutcome(m, categories, f.check);
      if (formed.verdict !== 'clutter') continue;
      checked = true;
      const count = counts[formed.category!]!;
      if (!photo || !photo.eligible) count.protectedOrUnknown++;
      else if (photo.approved) count.approved++;
      else count.trashable.push({ mediaKey: m.mediaKey, description: phrase(categories[f.best], f.description), score: f.score, lead: f.lead });
    }
    if (checked) screenshots++;
    if (outcome.verdict === 'none' || outcome.category === null) {
      neither++;
      continue;
    }
    if (outcome.verdict === 'clutter') clutter++;
    else kept++;
    const count = counts[outcome.category]!;
    const pick = pickOf(m, categories, outcome.category);
    // A keeper heard close behind the top: its own score and description; the lead it is short of the top by (0 or less).
    const heard = pick.keeper && pick.keeper.index === outcome.category && pick.best !== outcome.category ? pick.keeper : null;
    const entry = heard
      ? { mediaKey: m.mediaKey, description: phrase(categories[outcome.category], heard.description), score: heard.score, lead: heard.score - pick.score }
      : { mediaKey: m.mediaKey, description: phrase(categories[outcome.category], pick.description), score: pick.score, lead: pick.lead };
    if (!photo || !photo.eligible) count.protectedOrUnknown++;
    else if (photo.approved) count.approved++;
    else count.trashable.push(entry);
  }
  for (const c of counts) {
    c.trashable.sort((a, b) => b.score - a.score);
    c.justMissed.sort((a, b) => b.lead - a.lead);
  }
  const bySize = (a: CategoryCount, b: CategoryCount) => b.trashable.length - a.trashable.length;
  const share = (x: number) => (matches.length === 0 ? '' : ` (${Math.round((x / matches.length) * 100)}%)`);
  return {
    clutter: counts.filter((c) => (c.category as AxisCategory).verdict === 'clutter' && (c.category as AxisCategory).axis !== 'form').sort(bySize),
    forms: counts.filter((c) => (c.category as AxisCategory).verdict === 'clutter' && (c.category as AxisCategory).axis === 'form').sort(bySize),
    keepers: counts.filter((c) => (c.category as AxisCategory).verdict === 'keep' && (c.category as AxisCategory).axis !== 'form').sort(bySize),
    totals: `Clutter ${n(clutter)}${share(clutter)} · kept ${n(kept)}${share(kept)} · neither ${n(neither)}${share(neither)}${categories.some((c) => c.axis === 'form') ? ` · and clutter in a check ${n(screenshots)}${share(screenshots)}` : ''}`,
    photos: matches.length,
  };
}

/** One subject-and-setting pair, as the grid of pairs counts it. */
export interface PairRow {
  /** "Products", or "subject too close". */
  subject: string;
  setting: string;
  /** What the pair comes to for the photos in it (the first photo's, all alike unless leads differ). */
  verdict: Outcome['verdict'];
  count: number;
  mediaKeys: string[];
}

/** Every subject-and-setting pair that occurs, by the subject and setting that count, most photos first. */
export function pairRows(matches: AxisMatch[], categories: readonly AxisCategory[], exceptions: readonly PairException[]): PairRow[] {
  const rows = new Map<string, PairRow>();
  for (const m of matches) {
    const name = (pick: AxisPick, axis: ContentAxis) => (pick.counts ? categories[pick.best]!.label : `${axis} too close`);
    const [subjectName, settingName] = [name(m.subject, 'subject'), name(m.setting, 'setting')];
    const key = `${subjectName}\u0000${settingName}`;
    const row = rows.get(key) ?? { subject: subjectName, setting: settingName, verdict: axisOutcome(m, categories, exceptions).verdict, count: 0, mediaKeys: [] };
    row.count++;
    row.mediaKeys.push(m.mediaKey);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject) || a.setting.localeCompare(b.setting));
}

/** How a photo scored, for the hover card: its outcome, then its best subjects and settings. */
export interface AxisBreakdown {
  /** "Clutter: Products is clutter", "Kept: People keeps", "Neither: nothing that counts says clutter". */
  outcome: string;
  /** The outcome as plain lines, for a comparison: the subject and setting's ("Products is clutter"), then each check's ("Screenshots check: Not a screenshot · Quality check: Intended photos"). */
  lines: string[];
  /** Each side's rows, and how many descriptions were left out below them (for a photo opened large). */
  sides: BreakdownSide[];
}

/** One side of a photo's breakdown: its title and rows, and what it came to, to compare it with another list's ([axisComparison]). */
export interface BreakdownSide {
  title: string;
  /** [title] without the side's name: "Screenshots, 0.0286 ahead of Not a screenshot (…) · counts". */
  detail: string;
  rows: BreakdownRow[];
  more: number;
  /** 'Subject', 'Setting' or a check's ('Screenshots check'). */
  name: string;
  /** Its best category's name, and whether it counts ('counts', 'too close', 'below the floor'). */
  best: string;
  status: string;
  /** The keep category heard on this side, or null. */
  keeper: string | null;
  /** The check this side is, or null for subject and setting. */
  check: string | null;
}

/** A photo opened large lists each side's best descriptions: this share of them, but never fewer than [LARGE_MIN_ROWS]. */
export const LARGE_SHARE = 0.1;
export const LARGE_MIN_ROWS = 10;

const verdictKind = (v: Verdict): BreakdownRow['kind'] => (v === 'clutter' ? 'clutter' : v === 'keep' ? 'counterweight' : 'neutral');

/**
 * The outcome and the [shown] best subjects and settings, each with its score, the description it scores
 * as and its weight; or, with [shown] 'large' (for a photo opened large), the descriptions of every
 * subject and setting, best first: the best tenth of each side ([LARGE_SHARE], at least [LARGE_MIN_ROWS]),
 * and how many more there are.
 */
export function axisBreakdown(row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings, exceptions: readonly PairException[], shown: number | 'large'): AxisBreakdown {
  const categories = scored.map((s) => s.category);
  const match = matchAxes('', row, scored, overlap, settings);
  const outcome = axisOutcome(match, categories, exceptions);
  const scores = weightedScores(row, scored as ScoredCategory[], settings);
  const starts = descriptionStarts(scored as ScoredCategory[]);
  const all = weightedDescriptionScores(row, scored as ScoredCategory[], settings);
  // What a side lists: each category as its best description, or every description.
  const entries = (on: (c: AxisCategory) => boolean) =>
    categories.flatMap((c, i) => (!on(c) ? [] : shown === 'large' ? c.descriptions.map((_, d) => ({ i, description: d, score: all[starts[i]! + d]! })) : [{ i, description: scores[i]!.description, score: scores[i]!.score }]));
  const floor = categories.map((c, i) => ({ c, i })).filter(({ c }) => c.axis === 'baseline').sort((a, b) => scores[b.i]!.score - scores[a.i]!.score)[0];
  const weight = (c: AxisCategory, d: string) => {
    const w = (settings.categoryWeights[c.id] ?? 0) + (settings.descriptionWeights[d] ?? 0);
    return w === 0 ? null : `${w > 0 ? '+' : '−'}${w.toFixed(3).replace('-', '')}`;
  };
  const side = (pick: AxisPick, on: (c: AxisCategory) => boolean, name: string, check: string | null = null): BreakdownSide => {
    const listed = entries(on);
    const keep = shown === 'large' ? Math.max(LARGE_MIN_ROWS, Math.ceil(listed.length * LARGE_SHARE)) : shown;
    const rows = listed
      .sort((a, b) => b.score - a.score)
      .slice(0, keep)
      .map((s): BreakdownRow => {
        const c = categories[s.i]!;
        const description = c.descriptions[s.description]!;
        const vote = pick.votes.get(starts[s.i]! + s.description);
        return { label: c.label, kind: verdictKind(c.verdict), score: s.score.toFixed(3), description, weight: weight(c, description), vote: vote === undefined ? null : vote.toFixed(2) };
      });
    // The lead, how it is measured (pooled scores, when pooling is on) and the minimum it needs, together (2026-11-25).
    const best = categories[pick.best]!;
    const needs = settings.margins[best.id] ?? settings[best.axis as SideAxis].margin;
    const against = pick.rival === null ? 'nothing of another verdict' : `${leadText(pick.lead)} ahead of ${categories[pick.rival]!.label} (${settings.pooling > 0 ? 'pooled; ' : ''}needs ${needs})`;
    const clutter = categories[pick.best]!.verdict === 'clutter';
    const aboveFloor = clutter && settings.baseline !== null && pick.baselineGap !== null && floor ? ` · ${leadText(pick.baselineGap)} above “${floor.c.descriptions[scores[floor.i]!.description]}”, needs ${settings.baseline}` : '';
    const keeper = pick.keeper && pick.keeper.index !== pick.best ? ` · ${categories[pick.keeper.index]!.label} close behind, keeps` : '';
    const belowFloor = clutter && settings.baseline !== null && pick.baselineGap !== null && pick.baselineGap < settings.baseline;
    const status = pick.counts ? 'counts' : belowFloor ? 'below the floor' : 'too close';
    const say = pick.counts ? '' : ', no say';
    const detail = `${categories[pick.best]!.label}, ${against}${aboveFloor} · ${status}${say}${keeper}`;
    return {
      title: `${name}: ${detail}`,
      detail,
      rows,
      more: shown === 'large' ? Math.max(0, listed.length - keep) : 0,
      name,
      best: categories[pick.best]!.label,
      status,
      keeper: pick.keeper ? categories[pick.keeper.index]!.label : null,
      check,
    };
  };
  const sides = [
    side(match.subject, (c) => c.axis === 'subject', 'Subject'),
    side(match.setting, (c) => c.axis === 'setting', 'Setting'),
    ...match.checks.map((p) => side(p, (c) => c.axis === 'form' && checkOf(c) === p.check, `${p.check} check`, p.check)),
  ];
  const checks = match.checks.map((c) => [c.check, checkOutcome(match, categories, c.check)] as const);
  const lines = [outcome.reason, ...(checks.length > 0 ? [checks.map(([check, o]) => `${check} check: ${o.reason}`).join(' · ')] : [])];
  return { outcome: outcomeLine(outcome, checks, categories), lines, sides };
}

/**
 * The photo's outcome in words, saying what happens to it: a check offers it whatever the subject and
 * setting come to, so then that comes first, not "Kept" (2026-11-25: "Kept" read as left out of the
 * suggestions), and the subject and setting's own result after it as a separate one, not as overruled
 * ("Offered by its check: Screenshots · subject and setting: People keeps").
 */
function outcomeLine(outcome: Outcome, checks: readonly (readonly [string, Outcome])[], categories: readonly AxisCategory[]): string {
  const content = `${outcome.verdict === 'clutter' ? 'Clutter' : outcome.verdict === 'keep' ? 'Kept' : 'Neither'}: ${outcome.reason}`;
  const offered = checks.filter(([, o]) => o.verdict === 'clutter').map(([, o]) => categories[o.category!]!.label);
  if (offered.length === 0) return [content, ...checks.map(([check, o]) => `${check} check: ${o.reason}`)].join(' · ');
  const by = `by its ${offered.length === 1 ? 'check' : 'checks'}: ${offered.join(', ')}`;
  return `Offered ${by} · subject and setting: ${outcome.reason}`;
}

/** A piece of a line of text: a category's name (in its verdict's colour), a description (set apart), or the words around them. */
export interface TextPart {
  text: string;
  /** A category's name: its verdict's kind, as in the rows; null for anything else. */
  kind: BreakdownRow['kind'] | null;
  /** A description: the words the AI model scores photos against. */
  term: boolean;
}

/**
 * [text] in pieces, each name and description of [categories] apart ("Things to buy, sell or show is clutter"),
 * so a page sets them apart the same way everywhere (2026-11-25). Whole words only, longest first; a check's
 * name ("Screenshots check") isn't a category's.
 */
export function categoryParts(text: string, categories: readonly AxisCategory[]): TextPart[] {
  const found = new Map<string, Omit<TextPart, 'text'>>();
  for (const c of categories) {
    for (const d of c.descriptions) found.set(d, { kind: null, term: true });
    if (c.axis !== 'baseline') found.set(c.label, { kind: verdictKind(c.verdict), term: false });
  }
  const names = [...found.keys()].filter((l) => l.length > 0).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text, kind: null, term: false }];
  const escaped = names.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])(?! check)`, 'gu');
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), kind: null, term: false });
    parts.push({ text: m[0], ...found.get(m[0])! });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), kind: null, term: false });
  return parts;
}

/** What a breakdown is worked out from: a photo's scores, with a list and its settings. */
export interface BreakdownInput {
  row: Float32Array;
  scored: ScoredAxis[];
  overlap: Overlap;
  settings: AxisSettings;
  exceptions: readonly PairException[];
}

/** A side that a change moved: what it came to before and after, and only its rows that moved. */
export interface ChangedSide {
  /** What changed, under the side's name: "Screenshots check: Screenshots too close → counts", "Quality check: Accidental shots counts; was Screenshots counts". */
  title: string;
  /** What the side came to before and after, without its name, which the heading gives ("Accidental shots, 0.0086 ahead of … · too close, no say"), or "none". */
  before: string;
  after: string;
  /** Its whole scoring before and after, as the breakdown lists it: a side that changed is shown in full both times (2026-11-25). */
  beforeRows: BreakdownRow[];
  rows: BreakdownRow[];
}

/**
 * A photo's breakdown under two lists or settings ([names]: "Now", "With the edits"), said once where they
 * agree: a summary line of both outcomes, the sides that changed in full before and after, and the
 * rest once ([unchanged]). A side changed when its best category, whether it counts, its keeper or its rows
 * moved; pooled scores alone shifting (pooling regroups when a description goes) don't count. With nothing
 * changed, [changed] is empty and [unchanged] is the whole breakdown (2026-11-25).
 */
export interface AxisComparison {
  /** The outcome before, and after when it differs (null when the same), each as [AxisBreakdown.lines]: shown with ↓ between, not named (2026-11-25). */
  summary: { before: string[]; after: string[] | null };
  changed: ChangedSide[];
  /** "Unchanged: subject Landmarks, sights and art (too close, keeps) · setting Museums and historic places (counts)", or null when every side changed or nothing did. */
  unchangedLine: string | null;
  /** The sides that didn't change, as they are with the edits. */
  unchanged: BreakdownSide[];
}

const sideOutcomeText = (s: BreakdownSide) => `${s.best} ${s.status}${s.keeper && s.keeper !== s.best ? `, ${s.keeper} keeps` : ''}`;

export function axisComparison(before: BreakdownInput, after: BreakdownInput, names: readonly [string, string], shown: number | 'large'): AxisComparison {
  const [a, b] = [before, after].map((x) => axisBreakdown(x.row, x.scored, x.overlap, x.settings, x.exceptions, shown)) as [AxisBreakdown, AxisBreakdown];
  const rowKey = (r: BreakdownRow) => `${r.label}\u0000${r.description}`;
  const same = (x: BreakdownSide, y: BreakdownSide) =>
    x.best === y.best && x.status === y.status && x.keeper === y.keeper && JSON.stringify(x.rows.map((r) => [rowKey(r), r.score, r.weight])) === JSON.stringify(y.rows.map((r) => [rowKey(r), r.score, r.weight]));
  const changed: ChangedSide[] = [];
  const unchanged: BreakdownSide[] = [];
  // A check is the same check before and after when it has the same name, or else when it holds the same
  // categories (a form moved to a check of another name): its clutter ones first, then any.
  const formsIn = (x: BreakdownInput, check: string, clutterOnly: boolean) =>
    new Set(x.scored.filter((c) => c.category.axis === 'form' && checkOf(c.category) === check && (!clutterOnly || c.category.verdict === 'clutter')).map((c) => c.category.id));
  const shares = (x: BreakdownSide, y: BreakdownSide, clutterOnly: boolean) => {
    const ours = formsIn(after, y.check!, clutterOnly);
    return [...formsIn(before, x.check!, clutterOnly)].some((id) => ours.has(id));
  };
  const used = new Set<BreakdownSide>();
  const partner = (y: BreakdownSide): BreakdownSide | undefined => {
    if (y.check === null) return a.sides.find((x) => x.name === y.name);
    // A check split in two pairs with both.
    const checks = a.sides.filter((x) => x.check !== null);
    return checks.find((x) => x.check === y.check) ?? checks.find((x) => shares(x, y, true)) ?? checks.find((x) => shares(x, y, false));
  };
  const later = names[1].toLowerCase();
  for (const y of b.sides) {
    const x = partner(y);
    if (x) used.add(x);
    if (x && x.name === y.name && same(x, y)) {
      unchanged.push(y);
      continue;
    }
    // The heading says what changed, under the side's name with the change; the lines below say before and after (2026-11-25).
    const moved = !x
      ? sideOutcomeText(y)
      : sideOutcomeText(x) === sideOutcomeText(y)
        ? `${sideOutcomeText(y)}, unchanged`
        : x.best === y.best && x.keeper === y.keeper
          ? `${y.best} ${x.status} → ${y.status}`
          : `${sideOutcomeText(y)}; was ${sideOutcomeText(x)}`;
    // From a check of another name (one split in two, a form moved): which check the line before is, since it isn't this one.
    const beforeLine = !x ? 'none' : x.check !== null && x.check !== y.check ? `in the ${x.name}: ${x.detail}` : x.detail;
    changed.push({ title: `${y.name}: ${moved}`, before: beforeLine, after: y.detail, beforeRows: x?.rows ?? [], rows: y.rows });
  }
  // A check that is gone with the change, none of its categories in a check after it.
  for (const x of a.sides.filter((s) => !used.has(s))) {
    changed.push({ title: `${x.name}: ${sideOutcomeText(x)}; gone ${later}`, before: x.detail, after: 'none', beforeRows: x.rows, rows: [] });
  }
  const summary = { before: a.lines, after: a.outcome === b.outcome ? null : b.lines };
  const unchangedLine = changed.length === 0 || unchanged.length === 0 ? null : `Unchanged: ${unchanged.map((s) => `${s.name.toLowerCase()} ${s.best} (${s.status}${s.keeper ? `, ${s.keeper === s.best ? 'keeps' : `${s.keeper} keeps`}` : ''})`).join(' · ')}`;
  return { summary, changed, unchangedLine, unchanged };
}

/** One photo in a review sheet: its number on the contact sheet, the sample it is from, its caption and how it scored. */
export interface ReviewPhoto {
  number: number;
  sample: string;
  caption: string;
  breakdown: AxisBreakdown;
}

/**
 * A category's photos as text, to review away from the page (beside the contact sheets "Save for review"
 * saves): each photo's number, sample and caption, its outcome, and each side's title and best rows.
 */
export function reviewText(title: string, settingsLine: string, photos: readonly ReviewPhoto[]): string {
  const lines = [title, settingsLine, ''];
  for (const p of photos) {
    lines.push(`#${p.number} (${p.sample}) ${p.caption}`, `  ${p.breakdown.outcome}`);
    for (const side of p.breakdown.sides) {
      lines.push(`  ${side.title}`);
      for (const r of side.rows) lines.push(`    ${r.score} ${r.label} · ${r.description}${r.kind === 'counterweight' ? ' [keep]' : r.kind === 'neutral' ? ' [neutral]' : ' [clutter]'}${r.weight ? ` (weight ${r.weight})` : ''}${r.vote ? ` · vote ${r.vote}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** [settings] with [by] added to [description]'s weight. */
export function withAxisBuff(settings: AxisSettings, description: string, by: number): AxisSettings {
  return { ...settings, descriptionWeights: nudged(settings.descriptionWeights, description, by) };
}

/** A keep category that could take a photo out of clutter, and by how much. */
export interface AxisBuff {
  /** Index into the categories: the keep category. */
  category: number;
  label: string;
  axis: Axis;
  /** Its description the photo scores best as: the one a buff adds weight to. */
  description: string;
  /** Index into the categories: the clutter category the photo is in now. */
  from: number;
  /** The smallest weight to add that leaves the photo out of clutter; null when more than [max] is needed. */
  by: number | null;
  /** The largest buff offered, for the scoring the photo is counted with ([MAX_BUFFS]). */
  max: number;
}

/** The outcome of [row] with [settings] on [side]: by subject and setting, or in a check. */
function outcomeOf(row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings, exceptions: readonly PairException[], side: Side): Outcome {
  const match = matchAxes('', row, scored, overlap, settings);
  return sideOutcome(match, scored.map((s) => s.category), exceptions, side);
}

/** Whether a photo is clutter in category [category] with [settings], subject, setting or form (in its check). */
export function clutterIn(row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings, exceptions: readonly PairException[], category: number): boolean {
  const o = outcomeOf(row, scored, overlap, settings, exceptions, sideOf(scored[category]!.category));
  return o.verdict === 'clutter' && o.category === category;
}

/**
 * For a photo that is clutter on [side], what could leave it out, each with the smallest weight on its
 * best description for this photo that does: for subject and setting ('content'), each keep category (so
 * the clutter is too close to count, or the keeper is heard and keep wins); in a check, each of its forms
 * that isn't clutter (Not a screenshot). Smallest first; none larger than [max] ([MAX_BUFFS] of the scoring).
 */
export function axisBuffsFor(row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings, exceptions: readonly PairException[], side: Side, max: number): AxisBuff[] {
  const now = outcomeOf(row, scored, overlap, settings, exceptions, side);
  if (now.verdict !== 'clutter' || now.category === null) throw new Error('Only a photo that is clutter can be buffed out of it');
  const scores = weightedScores(row, scored as ScoredCategory[], settings);
  const buffs = scored.flatMap(({ category }, i): AxisBuff[] => {
    const helps = side === 'content' ? (category.axis === 'subject' || category.axis === 'setting') && category.verdict === 'keep' : category.axis === 'form' && checkOf(category) === side.check && category.verdict !== 'clutter';
    if (!helps) return [];
    const description = category.descriptions[scores[i]!.description]!;
    const by = smallestStep((step) => outcomeOf(row, scored, overlap, withAxisBuff(settings, description, step), exceptions, side).verdict !== 'clutter', max);
    return [{ category: i, label: category.label, axis: category.axis, description, from: now.category!, by, max }];
  });
  return buffs.sort((a, b) => (a.by ?? Infinity) - (b.by ?? Infinity));
}

/**
 * For a photo a change takes out of clutter category [category], the smallest weight to add to
 * [description] (one of that category's) that makes it clutter there again; null when it would take
 * more than [max], e.g. when a keep category that counts keeps it whatever that weight.
 */
export function axisStayRaise(row: Float32Array, scored: ScoredAxis[], overlap: Overlap, settings: AxisSettings, exceptions: readonly PairException[], category: number, description: string, max: number): number | null {
  if (!scored[category]?.category.descriptions.includes(description)) throw new Error(`“${description}” isn't a description of the category the photo leaves`);
  return smallestStep((by) => clutterIn(row, scored, overlap, withAxisBuff(settings, description, by), exceptions, category), max);
}

/**
 * A buff's button: "Buff People (subject) “a selfie” +0.0063", or why there is none. The side is named
 * after the label unless the label already says it (an edited one such as "Pets (subject)").
 */
export function axisBuffButton(buff: AxisBuff): string {
  const name = buff.label.endsWith(`(${buff.axis})`) ? buff.label : `${buff.label} (${buff.axis})`;
  return buff.by === null ? `${name} “${buff.description}”: more than +${buff.max} needed` : `Buff ${name} “${buff.description}” +${buff.by.toFixed(4)}`;
}

/** A photo whose outcome a change alters, before and after, by subject and setting ('content') or in a check. */
export interface AxisChange {
  side: Side;
  mediaKey: string;
  before: Outcome;
  after: Outcome;
  /** The description it scored as in the clutter category it was in, if it was clutter: the one Stay raises. */
  fromDescription: string | null;
  score: number;
  /**
   * Every category that offers the photo before and after, by subject and setting and in each check: a photo
   * that joins one check while another still offers it was never "not suggested" (2026-11-25).
   */
  offered: { before: string[]; after: string[] };
}

export interface AxisEffects {
  /** Clutter before, not after: they leave the suggestions. */
  leaves: AxisChange[];
  /** Not clutter before, clutter after: they join. */
  joins: AxisChange[];
  /** Clutter in one category before and another after: still suggested. */
  moves: AxisChange[];
}

/** The categories before and after a change (the same list for a change of weights). */
export interface AxisLists {
  before: readonly AxisCategory[];
  after: readonly AxisCategory[];
  exceptions: { before: readonly PairException[]; after: readonly PairException[] };
}

/** The clutter forms that offer [match]'s photo, by id, each with its check and outcome there. */
function offeredBy(match: AxisMatch, list: readonly AxisCategory[]): Map<string, { check: string; outcome: Outcome }> {
  const offered = new Map<string, { check: string; outcome: Outcome }>();
  for (const check of checksOf(list)) {
    const outcome = checkOutcome(match, list, check);
    if (outcome.verdict === 'clutter') offered.set(list[outcome.category!]!.id, { check, outcome });
  }
  return offered;
}

/**
 * Where [match]'s photo stands, not offered, for form [id] in [list]: its check's outcome there (the check
 * it is in, or else [check]), or nothing when neither is in [list]. Never clutter: offered by another form,
 * it is still not offered by this one.
 */
function otherwise(match: AxisMatch, list: readonly AxisCategory[], id: string, check: string): Outcome {
  const form = list.find((c) => c.id === id && c.axis === 'form');
  const its = form ? checkOf(form) : checksOf(list).includes(check) ? check : null;
  const outcome = its === null ? null : checkOutcome(match, list, its);
  return outcome && outcome.verdict !== 'clutter' ? outcome : { verdict: 'none', category: null, reason: 'not in a check' };
}

/** What a change does to the photos that may be trashed: [before] and [after] are the same photos in the same order. */
export function axisEffects(before: AxisMatch[], after: AxisMatch[], lists: AxisLists, photos: Map<string, ClutterPhoto>): AxisEffects {
  if (before.length !== after.length) throw new Error(`Both must match the same photos (${before.length} and ${after.length})`);
  const effects: AxisEffects = { leaves: [], joins: [], moves: [] };
  before.forEach((b, i) => {
    const a = after[i]!;
    if (a.mediaKey !== b.mediaKey) throw new Error('Both must match the same photos in the same order');
    const photo = photos.get(b.mediaKey);
    if (!photo || !photo.eligible || photo.approved) return;
    const offers = (m: AxisMatch, list: readonly AxisCategory[], exceptions: readonly PairException[]) => {
      const content = axisOutcome(m, list, exceptions);
      return [...(content.verdict === 'clutter' ? [content] : []), ...checkOutcomes(m, list).filter((o) => o.verdict === 'clutter')].map((o) => list[o.category!]!.label);
    };
    const offered = { before: offers(b, lists.before, lists.exceptions.before), after: offers(a, lists.after, lists.exceptions.after) };
    const compare = (side: Side, was: Outcome, now: Outcome) => {
      const wasClutter = was.verdict === 'clutter';
      const isClutter = now.verdict === 'clutter';
      if (!wasClutter && !isClutter) return;
      const fromDescription = wasClutter ? phrase(lists.before[was.category!], pickOf(b, lists.before, was.category!).description) : null;
      const change = (score: number): AxisChange => ({ side, mediaKey: b.mediaKey, before: was, after: now, fromDescription, score, offered });
      if (wasClutter && !isClutter) effects.leaves.push(change(pickOf(b, lists.before, was.category!).score));
      else if (!wasClutter && isClutter) effects.joins.push(change(pickOf(a, lists.after, now.category!).score));
      else if (lists.before[was.category!]!.id !== lists.after[now.category!]!.id) effects.moves.push(change(pickOf(a, lists.after, now.category!).score));
    };
    compare('content', axisOutcome(b, lists.before, lists.exceptions.before), axisOutcome(a, lists.after, lists.exceptions.after));
    // The checks, followed by category, not by check name: a form moved to another check, still offering the
    // photo, changes nothing (2026-11-25: all of Screenshots showed as leaving when it got a check of its own).
    const [was, now] = [offeredBy(b, lists.before), offeredBy(a, lists.after)];
    const gone = [...was].filter(([id]) => !now.has(id)).map(([, o]) => o);
    const come = [...now].filter(([id]) => !was.has(id)).map(([, o]) => o);
    const paired = Math.min(gone.length, come.length);
    for (let k = 0; k < paired; k++) compare({ check: come[k]!.check }, gone[k]!.outcome, come[k]!.outcome);
    for (const g of gone.slice(paired)) compare({ check: g.check }, g.outcome, otherwise(a, lists.after, lists.before[g.outcome.category!]!.id, g.check));
    for (const c of come.slice(paired)) compare({ check: c.check }, otherwise(b, lists.before, lists.after[c.outcome.category!]!.id, c.check), c.outcome);
  });
  const order = (list: readonly AxisCategory[], pick: (c: AxisChange) => number) => (x: AxisChange, y: AxisChange) => pick(x) - pick(y) || y.score - x.score;
  effects.leaves.sort(order(lists.before, (c) => c.before.category!));
  effects.joins.sort(order(lists.after, (c) => c.after.category!));
  effects.moves.sort(order(lists.after, (c) => c.after.category!));
  return effects;
}

/** Changes grouped by a category: "Products · 12". */
export interface AxisGroup {
  /** The category's id, which stays the same while its count changes. */
  key: string;
  title: string;
  changes: AxisChange[];
}

/** [changes] by the category [of] each, in the order of [list]. */
export function axisGroups(changes: AxisChange[], list: readonly AxisCategory[], of: (c: AxisChange) => number): AxisGroup[] {
  const by = new Map<number, AxisChange[]>();
  for (const c of changes) by.set(of(c), [...(by.get(of(c)) ?? []), c]);
  return [...by].sort(([a], [b]) => a - b).map(([i, group]) => ({ key: list[i]!.id, title: `${list[i]!.label} · ${n(group.length)}`, changes: group }));
}

/** What an outcome says, in a caption: "Products", "kept (People)", "not suggested", or in a check its best ("Not a screenshot"). */
function outcomeParts(o: Outcome, list: readonly AxisCategory[], side: Side): CaptionPart[] {
  if (o.verdict === 'clutter') return [{ text: list[o.category!]!.label, kind: 'clutter', strong: true }];
  if (o.verdict === 'keep') return [{ text: 'kept', kind: null, strong: true }, { text: ' (', kind: null }, { text: list[o.category!]!.label, kind: 'counterweight' }, { text: ')', kind: null }];
  if (side !== 'content' && o.category !== null) return [{ text: o.reason, kind: null, strong: true }];
  return [{ text: 'not suggested', kind: null, strong: true }];
}

/** Where a photo goes, in bold, then why: 'Products → kept (People)', 'not suggested → Screen photos', 'Screenshots → Not a screenshot'. */
export function axisCaption(change: AxisChange, lists: AxisLists): CaptionPart[] {
  // Offered by another category too, before or after: every category that offers it, not "not suggested".
  // A check's own outcome stays, in brackets, where it names something ("Products (Screenshots, too close)").
  const part = (o: Outcome, list: readonly AxisCategory[], offered: string[]): CaptionPart[] => {
    const all: CaptionPart = { text: offered.join(', '), kind: 'clutter', strong: true };
    if (o.verdict === 'clutter') return offered.length > 1 ? [all] : outcomeParts(o, list, change.side);
    if (offered.length === 0) return outcomeParts(o, list, change.side);
    return change.side !== 'content' && o.category !== null ? [all, { text: ` (${o.reason})`, kind: null }] : [all];
  };
  return [...part(change.before, lists.before, change.offered.before), { text: ' → ', kind: null, strong: true }, ...part(change.after, lists.after, change.offered.after)];
}

/** What [what] does, in parts the popup shows on lines of their own. */
export function axisSummary(what: string, effects: AxisEffects, lists: AxisLists): ChangeSummary {
  const tally = (changes: AxisChange[], list: readonly AxisCategory[], of: (c: AxisChange) => number) => axisGroups(changes, list, of).map((g) => g.title.replace(' · ', ' ')).join(' · ');
  const { leaves, joins, moves } = effects;
  return {
    what,
    leave: `${n(leaves.length)} ${leaves.length === 1 ? 'photo leaves' : 'photos leave'} the suggestions`,
    leaveFrom: leaves.length > 0 ? tally(leaves, lists.before, (c) => c.before.category!) : null,
    join: joins.length > 0 ? `${n(joins.length)} ${joins.length === 1 ? 'photo joins' : 'photos join'} the suggestions` : null,
    joinTo: joins.length > 0 ? tally(joins, lists.after, (c) => c.after.category!) : null,
    move: moves.length > 0 ? `${n(moves.length)} ${moves.length === 1 ? 'moves' : 'move'} between them` : null,
  };
}

/** The categories by axis, for the page: subjects, settings, then each check's forms. */
export function axisSections(categories: readonly AxisCategory[]): { axis: Axis; check: string | null; title: string; categories: AxisCategory[] }[] {
  return [
    { axis: 'subject', check: null, title: 'Subjects: what a photo is of', categories: categories.filter((c) => c.axis === 'subject') },
    { axis: 'setting', check: null, title: 'Settings: where it is', categories: categories.filter((c) => c.axis === 'setting') },
    ...checksOf(categories).map((check) => ({ axis: 'form' as const, check, title: checkTitle(check), categories: categories.filter((c) => c.axis === 'form' && checkOf(c) === check) })),
    { axis: 'baseline', check: null, title: 'Baseline: what any photo scores, for the floor', categories: categories.filter((c) => c.axis === 'baseline') },
  ];
}

/** A check's heading: "Check: Screenshots, a system of its own: its clutter forms offer a photo whatever anything else decides; its neutral ones hold them back". */
export function checkTitle(check: string): string {
  return `Check: ${check}, a system of its own: its clutter forms offer a photo whatever anything else decides; its neutral ones hold them back`;
}

/** How many different descriptions (phrases) the list's categories have, each counted once. */
export function axisDescriptionCount(list: AxisList): number {
  return new Set(list.categories.flatMap((c) => c.descriptions)).size;
}

/** "21 subjects, 7 settings, 2 forms in 1 check and 1 baseline, 1 exception"; an axis with none is left out, but for subjects and settings. */
export function axisListSummary(list: AxisList): string {
  const count = (axis: Axis, one: string, many: string) => {
    const k = list.categories.filter((c) => c.axis === axis).length;
    return `${k} ${k === 1 ? one : many}`;
  };
  const has = (axis: Axis) => list.categories.some((c) => c.axis === axis);
  const parts = [count('subject', 'subject', 'subjects'), count('setting', 'setting', 'settings'), ...(has('form') ? [`${count('form', 'form', 'forms')} in ${checksOf(list.categories).length === 1 ? '1 check' : `${checksOf(list.categories).length} checks`}`] : []), ...(has('baseline') ? [count('baseline', 'baseline', 'baselines')] : [])];
  const exceptions = list.exceptions.length;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}${exceptions > 0 ? `, ${exceptions} ${exceptions === 1 ? 'exception' : 'exceptions'}` : ''}`;
}


/** [settings] with every change in [changes] added (a buff and the raises balancing it, from a tab of finds). */
export function withAxisChanges(settings: AxisSettings, changes: WeightChange[]): AxisSettings {
  return changes.reduce((s, c) => withAxisBuff(s, c.description, c.by), settings);
}

/** "+0.0071 to “a selfie” (People), +0.0050 to “a receipt” (Receipts and invoices)", or "No change". */
export function changesLine(changes: WeightChange[], categories: readonly AxisCategory[]): string {
  if (changes.length === 0) return 'No change';
  const labelOf = (description: string) => {
    const category = categories.find((c) => c.descriptions.includes(description));
    if (!category) throw new Error(`A weight change names a description that isn't in the list (${description})`);
    return category.label;
  };
  return changes.map((c) => `${c.by > 0 ? '+' : '−'}${Math.abs(c.by).toFixed(4)} to “${c.description}” (${labelOf(c.description)})`).join(', ');
}

/** What the page keeps between visits: the scoring shown, and each scoring's settings. */
export interface AxisTuning {
  scoring: Scoring;
  settings: Record<Scoring, AxisSettings>;
}

export const STARTING_AXIS_TUNING: AxisTuning = { scoring: 'raw', settings: STARTING_AXIS_SETTINGS };

/**
 * Saved tuning ([text], as JSON.stringify wrote an [AxisTuning]) fitted to [list]: weights and minimum
 * leads of what is no longer in it dropped, and a floor with no baseline left to measure it by turned
 * off, which [notes] says. Nothing saved (null): the starting tuning. Settings saved before 2026-11-21
 * were one [AxisSettings] for raw scores, without pooling or a floor: read as the raw settings, with
 * those off, and evened-out settings starting afresh.
 */
export function readAxisTuning(text: string | null, categories: readonly AxisCategory[]): { tuning: AxisTuning; notes: string[] } {
  if (text === null) return { tuning: STARTING_AXIS_TUNING, notes: [] };
  const saved = JSON.parse(text) as Partial<AxisTuning> & Partial<AxisSettings>;
  const notes: string[] = [];
  const number = (x: unknown, what: string): number => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`The saved settings have no number for ${what}`);
    return x;
  };
  const ids = new Set(categories.map((c) => c.id));
  const descriptions = new Set(categories.flatMap((c) => c.descriptions));
  const hasBaseline = categories.some((c) => c.axis === 'baseline');
  const fit = (s: Partial<AxisSettings> | undefined, scoring: Scoring): AxisSettings => {
    // A scoring with nothing saved starts as shipped; a setting missing from what was saved (saved before it existed) is off.
    if (!s) return STARTING_AXIS_SETTINGS[scoring];
    const start = PLAIN_AXIS_SETTINGS[scoring];
    const lead = (l: Partial<AxisLead> | undefined, axis: SideAxis): AxisLead => (l ? { minScore: number(l.minScore, `the ${axis} minimum score`), margin: number(l.margin, `the ${axis} minimum lead`) } : start[axis]);
    const known = (record: unknown, keep: Set<string>, what: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries((record ?? {}) as Record<string, unknown>)) {
        if (keep.has(key)) out[key] = number(value, `${what} ${key}`);
        else notes.push(`Dropped the ${scoring} ${what} for “${key}”, no longer in the list.`);
      }
      return out;
    };
    let floor = s.baseline === undefined || s.baseline === null ? null : number(s.baseline, 'the floor');
    if (floor !== null && !hasBaseline) {
      notes.push(`Turned the ${scoring} floor off: the list has no baseline description to measure it by.`);
      floor = null;
    }
    return {
      subject: lead(s.subject, 'subject'),
      setting: lead(s.setting, 'setting'),
      form: lead(s.form, 'form'),
      margins: known(s.margins, ids, 'minimum lead'),
      categoryWeights: known(s.categoryWeights, ids, 'weight'),
      descriptionWeights: known(s.descriptionWeights, descriptions, 'weight'),
      pooling: s.pooling === undefined ? start.pooling : number(s.pooling, 'pooling'),
      baseline: floor,
    };
  };
  if (saved.settings === undefined) {
    notes.push('The settings were saved before evening out came to subject and setting: they are the raw settings now, and the evened-out ones start afresh.');
    return { tuning: { scoring: 'raw', settings: { raw: fit(saved, 'raw'), evened: fit(undefined, 'evened') } }, notes };
  }
  return { tuning: { scoring: saved.scoring === 'evened' ? 'evened' : 'raw', settings: { raw: fit(saved.settings.raw, 'raw'), evened: fit(saved.settings.evened, 'evened') } }, notes };
}

/**
 * Whether [settings] can be used with [categories]: a floor needs a baseline description. The reason
 * as the page says it, or null when they can.
 */
export function floorProblem(settings: Record<Scoring, AxisSettings>, categories: readonly AxisCategory[]): string | null {
  if (categories.some((c) => c.axis === 'baseline')) return null;
  const on = (['raw', 'evened'] as const).filter((s) => settings[s].baseline !== null);
  return on.length === 0 ? null : `The floor is on (${on.join(' and ')}), and needs a baseline description such as “a photo”: keep one, or turn the floor off first.`;
}

/** Pairs of one subject (or one setting), with how many photos they hold in all. */
export interface PairGroup {
  /** The subject or setting the pairs share: "Products", or "subject too close". */
  name: string;
  count: number;
  /** Its pairs, most photos first. */
  rows: PairRow[];
}

/** [rows] grouped by their subject or their setting, the groups with most photos first. */
export function groupPairs(rows: PairRow[], by: ContentAxis): PairGroup[] {
  const groups = new Map<string, PairGroup>();
  for (const row of rows) {
    const name = by === 'subject' ? row.subject : row.setting;
    const group = groups.get(name) ?? { name, count: 0, rows: [] };
    group.count += row.count;
    group.rows.push(row);
    groups.set(name, group);
  }
  for (const g of groups.values()) g.rows.sort((a, b) => b.count - a.count);
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
