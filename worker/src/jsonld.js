/* Turning schema.org markup into the facts a reader actually wants.

   This is where the app earns its keep. An Apple Music album page is a shell
   of JavaScript with nothing readable in it — but it ships a MusicAlbum block
   carrying all twenty-one track names, their durations and their links. Same
   for a recipe's ingredients, a podcast's episodes, a product's price. Pull
   that out and the page becomes text.

   Pure functions only: the input is already-parsed JSON. */

/* Which entity is "the page" when several are marked up. A breadcrumb trail
   and a WebSite block are almost always present and almost never the point. */
const PRIORITY = [
  'MusicAlbum', 'MusicPlaylist', 'MusicRecording', 'PodcastSeries', 'PodcastEpisode',
  'Recipe', 'Movie', 'TVSeries', 'TVEpisode', 'VideoObject', 'Book', 'Course',
  'Product', 'Event', 'JobPosting', 'SoftwareApplication', 'Question',
  'NewsArticle', 'BlogPosting', 'Article', 'Report', 'ScholarlyArticle',
  'Person', 'Organization', 'Restaurant', 'LocalBusiness', 'Place',
  'ItemList', 'WebPage', 'WebSite',
];

export function parseBlocks(texts) {
  const out = [];
  for (const text of texts) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      continue; // A malformed block is common and never worth failing over.
    }
    for (const node of flatten(value)) out.push(node);
  }
  return out;
}

/* @graph, bare arrays and nested @type-bearing values all appear in the wild;
   flattening once here means nothing downstream has to care which it got. */
function flatten(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return [];
  if (Array.isArray(value)) return value.flatMap((v) => flatten(v, depth + 1));
  if (Array.isArray(value['@graph'])) return value['@graph'].flatMap((v) => flatten(v, depth + 1));
  return value['@type'] ? [value] : [];
}

export function typeOf(node) {
  const t = node && node['@type'];
  return Array.isArray(t) ? String(t[0] || '') : String(t || '');
}

export function pickPrimary(nodes) {
  let best = null;
  let bestRank = Infinity;
  for (const node of nodes) {
    const rank = PRIORITY.indexOf(typeOf(node));
    const score = rank === -1 ? PRIORITY.length : rank;
    if (score < bestRank) { best = node; bestRank = score; }
  }
  return best;
}

/* schema.org lets almost any value be a string, an object, or an array of
   either, so every read goes through here. */
export function text(value, depth = 0) {
  if (value == null || depth > 4) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => text(v, depth + 1)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return text(value.name ?? value['@value'] ?? value.title ?? value.headline ?? '', depth + 1);
  }
  return '';
}

function link(value) {
  const candidates = Array.isArray(value) ? value : [value];
  for (const v of candidates) {
    const u = typeof v === 'string' ? v : (v && (v.url || v['@id'] || v.contentUrl));
    if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
  }
  return '';
}

/* PT1H4M30S is unreadable; 1:04:30 is not. */
export function duration(iso) {
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(String(iso || '').trim());
  if (!m || !m.slice(1).some(Boolean)) return '';
  const [d, h, mi, s] = m.slice(1).map((v) => (v ? parseFloat(v) : 0));
  const total = Math.round(d * 86400 + h * 3600 + mi * 60 + s);
  if (!total) return '';
  const hh = Math.floor(total / 3600);
  const mm = Math.floor(total / 60) % 60;
  const ss = total % 60;
  return hh
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`;
}

/* A track is 3:32; twenty minutes of simmering is not 20:00. Anything that
   answers "how long does this take" reads better in words. */
export function span(iso) {
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(String(iso || '').trim());
  if (!m || !m.slice(1).some(Boolean)) return '';
  const [d, h, mi, s] = m.slice(1).map((v) => (v ? parseFloat(v) : 0));
  const total = Math.round(d * 86400 + h * 3600 + mi * 60 + s);
  if (!total) return '';

  const days = Math.floor(total / 86400);
  const hours = Math.floor(total / 3600) % 24;
  const mins = Math.floor(total / 60) % 60;
  const secs = total % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hr`);
  if (mins) parts.push(`${mins} min`);
  // Seconds only matter when they are the whole of it.
  if (secs && !days && !hours && !mins) parts.push(`${secs} sec`);
  return parts.join(' ');
}

function date(value) {
  const raw = text(value);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  // Bare dates have no time, so rendering them in a zone would shift the day.
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) && raw.length <= 10
    ? raw
    : d.toISOString().replace('T', ' ').replace(/:\d{2}\.\d+Z$/, ' UTC');
}

/* ── the shaped result ─────────────────────────────────────────────────────
   facts:    label/value pairs, rendered as a definition list
   sections: ordered lists — tracks, ingredients, steps, episodes           */

export function shape(nodes) {
  const primary = pickPrimary(nodes);
  if (!primary) return { kind: '', facts: [], sections: [] };

  const kind = typeOf(primary);
  const facts = [];
  const sections = [];
  const add = (label, value, href) => {
    const v = typeof value === 'string' ? value.trim() : text(value);
    if (v) facts.push({ label, value: v, href: href || '' });
  };

  add('Type', humanType(kind));
  add('By', primary.byArtist ?? primary.author ?? primary.creator ?? primary.performer, link(primary.byArtist ?? primary.author));
  add('Published', date(primary.datePublished ?? primary.dateCreated ?? primary.uploadDate));
  add('Updated', date(primary.dateModified));
  add('Length', primary.duration ? duration(primary.duration) : span(primary.timeRequired));
  add('Genre', primary.genre);
  add('In', primary.inAlbum ?? primary.partOfSeries ?? primary.partOfSeason ?? primary.isPartOf);
  add('Publisher', primary.publisher ?? primary.provider);

  if (primary.aggregateRating) {
    const r = primary.aggregateRating;
    const count = text(r.ratingCount ?? r.reviewCount);
    add('Rating', `${text(r.ratingValue)}${r.bestRating ? ` / ${text(r.bestRating)}` : ''}${count ? ` (${count} ratings)` : ''}`);
  }

  const offer = first(primary.offers);
  if (offer) {
    const price = text(offer.price ?? offer.lowPrice);
    const cur = text(offer.priceCurrency);
    if (price) add('Price', `${price}${cur ? ` ${cur}` : ''}`);
    add('Availability', text(offer.availability).replace(/^https?:\/\/schema\.org\//, ''));
  }

  // ── type-specific extras and lists ──

  const tracks = listOf(primary.tracks ?? primary.track ?? primary.hasPart);
  if (tracks.length && /Music|Podcast|TVSeries|TVSeason/.test(kind)) {
    sections.push({
      title: kind.startsWith('Music') ? 'Tracks' : 'Episodes',
      unit: kind.startsWith('Music') ? 'track' : 'episode',
      numbered: true,
      items: tracks.map((t) => ({
        title: text(t.name ?? t),
        meta: [duration(t.duration), text(t.byArtist)].filter(Boolean).join(' · '),
        href: link(t),
      })).filter((i) => i.title),
    });
    add('Count', `${tracks.length}`);
  }

  if (kind === 'Recipe') {
    add('Yield', primary.recipeYield);
    add('Prep', span(primary.prepTime));
    add('Cook', span(primary.cookTime));
    add('Cuisine', primary.recipeCuisine);
    const ing = listOf(primary.recipeIngredient ?? primary.ingredients);
    if (ing.length) {
      sections.push({ title: 'Ingredients', unit: 'ingredient', numbered: false, items: ing.map((i) => ({ title: text(i) })) });
    }
    const steps = flattenSteps(primary.recipeInstructions);
    if (steps.length) {
      sections.push({ title: 'Method', unit: 'step', numbered: true, items: steps.map((s) => ({ title: s })) });
    }
  }

  if (kind === 'Question' || primary.acceptedAnswer || primary.suggestedAnswer) {
    const answers = listOf(primary.acceptedAnswer).concat(listOf(primary.suggestedAnswer));
    if (answers.length) {
      sections.push({
        title: 'Answers',
        unit: 'answer',
        numbered: false,
        items: answers.map((a) => ({ title: stripTags(text(a.text ?? a)) })).filter((i) => i.title),
      });
    }
  }

  if (kind === 'Event') {
    add('Starts', date(primary.startDate));
    add('Ends', date(primary.endDate));
    add('Where', primary.location);
  }

  if (kind === 'JobPosting') {
    add('Employer', primary.hiringOrganization);
    add('Where', primary.jobLocation);
    add('Employment', primary.employmentType);
  }

  // A plain ItemList is the shape a "best of" or a search result page uses.
  const items = listOf(primary.itemListElement);
  if (items.length && !sections.length) {
    sections.push({
      title: text(primary.name) || 'Items',
      unit: 'item',
      numbered: true,
      items: items.map((entry) => {
        const it = entry && entry.item ? entry.item : entry;
        return { title: text(it.name ?? it), meta: text(it.description).slice(0, 160), href: link(it) };
      }).filter((i) => i.title),
    });
  }

  return {
    kind,
    label: humanType(kind),
    name: text(primary.name ?? primary.headline),
    description: stripTags(text(primary.description ?? primary.abstract)),
    image: link(primary.image ?? primary.thumbnailUrl),
    body: stripTags(text(primary.articleBody ?? primary.text)),
    facts,
    sections: sections.filter((s) => s.items.length),
  };
}

function first(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return v && typeof v === 'object' ? v : null;
}

function listOf(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter((v) => v != null && v !== '');
}

/* Instructions come as strings, as HowToStep objects, or as HowToSections
   wrapping more steps — all three inside one recipe, sometimes. */
function flattenSteps(value, depth = 0) {
  if (depth > 3) return [];
  return listOf(value).flatMap((s) => {
    if (typeof s === 'string') return [stripTags(s)];
    if (s.itemListElement) return flattenSteps(s.itemListElement, depth + 1);
    const t = stripTags(text(s.text ?? s.name ?? s));
    return t ? [t] : [];
  }).filter(Boolean);
}

/* Description fields routinely contain escaped markup. */
export function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanType(kind) {
  return String(kind)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^TV /, 'TV ')
    .trim();
}
