import { PEAK_MAX_DURATION_MINS, isPeakSlot } from './format.js';

/**
 * Plain-Language Order Parser (NLP Heuristic Engine)
 * ---------------------------------------------------------------------------
 * Converts casual student text such as:
 *   "2 masala dosa and 1 cold coffee for 12:30 dine-in"
 * into structured cart items, pickup/dine-in intent, and target 10-min slot.
 *
 * Accepts the live `menuItems` array so newly published items from the Manager
 * Dashboard become immediately orderable via plain language without code edits.
 */

const NUMBER_WORDS = {
  a: 1,
  an: 1,
  single: 1,
  one: 1,
  two: 2,
  couple: 2,
  pair: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

const STOP_WORDS = new Set([
  'i', 'want', 'need', 'get', 'me', 'give', 'order', 'please', 'pls',
  'for', 'at', 'by', 'in', 'on', 'to', 'the', 'slot', 'counter', 'my',
  'have', 'would', 'like', 'some', 'make', 'it'
]);

/**
 * Normalizes text by lowercasing, removing punctuation (preserving colons/dots
 * briefly during time extraction), and collapsing extra whitespace.
 */
function cleanText(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple singularizer so plural forms ("dosas", "puffs", "samosas", "coffees")
 * match singular menu names cleanly.
 */
function singularize(word) {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('sses')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

function normalizePhrase(str) {
  return cleanText(str)
    .split(' ')
    .filter((t) => t && !STOP_WORDS.has(t))
    .map(singularize)
    .join(' ');
}

/**
 * Classic Levenshtein distance used for lightweight typo tolerance
 * (e.g., "masla dosa" -> "masala dosa").
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Step 1: Extract Dine-In vs Takeaway intent from raw text and strip matched phrase.
 */
function extractOrderMode(text) {
  let working = text;
  let orderType = null;

  const dineInRegex = /\b(dine[\s-]?in|dine\s*here|eat[\s-]?in|eat\s*here|reserve\s*table|table|sit\s*down|seat)\b/gi;
  const takeawayRegex = /\b(take[\s-]?away|take[\s-]?out|parcel|pack(?:ed)?|pick[\s-]?up|to[\s-]?go)\b/gi;

  if (dineInRegex.test(working)) {
    orderType = 'dine-in';
    working = working.replace(dineInRegex, ' ');
  } else if (takeawayRegex.test(working)) {
    orderType = 'takeaway';
    working = working.replace(takeawayRegex, ' ');
  }

  return { orderType, remainingText: working };
}

/**
 * Step 2: Extract target 10-minute pickup slot (`12:20`, `12:30`, `12:40`, `12:50`)
 * and remove the timestamp so digits like `12` or `30` never pollute item quantities.
 */
function extractTimeSlot(text, availableSlotIds = ['12:20', '12:30', '12:40', '12:50']) {
  let working = text;
  let slotId = null;
  let requestedUnsupportedTime = null;

  // Matches formats like 12:30, 12.30, 12 30, 1230, optional pm
  const timeRegex = /(?:at|for|by|slot)?\s*\b(12)\s*[:.\s]?\s*([0-5]\d)(?:\s*(?:pm|hrs|h))?\b/gi;
  const match = timeRegex.exec(working);

  if (match) {
    const normalizedTime = `${match[1]}:${match[2]}`;
    if (availableSlotIds.includes(normalizedTime)) {
      slotId = normalizedTime;
    } else {
      requestedUnsupportedTime = normalizedTime;
    }
    working = working.replace(match[0], ' ');
  }

  return { slotId, requestedUnsupportedTime, remainingText: working };
}

/**
 * Step 2b: Extract dining duration ("for 45 mins", "30 min", "15m", "1 hour", "half hour")
 * and strip it so duration digits never pollute food quantities.
 */
function extractDiningDuration(text) {
  let working = text;
  let durationMins = null;

  const hourRegex = /(?:for\s+)?\b(1\s*(?:hr|hour)|half\s*(?:an\s*)?(?:hr|hour))\b/gi;
  const minRegex = /(?:for\s+)?\b(15|30|45|60)\s*(?:mins?|minutes?|m)\b/gi;

  const hourMatch = hourRegex.exec(working);
  if (hourMatch) {
    durationMins = /half/i.test(hourMatch[1]) ? 30 : 60;
    working = working.replace(hourMatch[0], ' ');
  } else {
    const minMatch = minRegex.exec(working);
    if (minMatch) {
      durationMins = Number(minMatch[1]);
      working = working.replace(minMatch[0], ' ');
    }
  }

  return { durationMins, remainingText: working };
}

/**
 * Step 3: Build searchable candidate terms for every live menu item
 * (dish name + configured aliases), sorted longest-first to avoid partial shadows.
 */
function buildMenuCandidates(menuItems) {
  const candidates = [];

  for (const item of menuItems) {
    const terms = [item.name, ...(item.aliases || [])];
    for (const term of terms) {
      const normalized = normalizePhrase(term);
      if (normalized) {
        candidates.push({
          item,
          term: normalized,
          tokenCount: normalized.split(' ').length
        });
      }
    }
  }

  // Prefer multi-word / longer terms first (e.g. "chicken tikka wrap" before "wrap")
  candidates.sort((a, b) => b.term.length - a.term.length);
  return candidates;
}

/**
 * Step 4: Match a single clause (e.g. "2 masala dosas") to the best menu item.
 */
function matchSegmentToDish(segment, candidates) {
  let phrase = segment.trim();
  if (!phrase) return null;

  // Replace number words at token boundaries ("two masala dosa" -> "2 masala dosa")
  phrase = phrase
    .split(/\s+/)
    .map((tok) => (NUMBER_WORDS[tok] !== undefined ? String(NUMBER_WORDS[tok]) : tok))
    .join(' ');

  // Extract quantity prefix ("2 masala dosa", "2x masala dosa") or suffix ("masala dosa x2")
  let quantity = 1;
  const prefixMatch = phrase.match(/^(?:.*?)\b(\d{1,2})\s*(?:x|nos?|plates?|pcs?)?\s+(.+)$/i);
  const suffixMatch = phrase.match(/^(.+?)\s*(?:x|\*)\s*(\d{1,2})$/i);

  if (prefixMatch) {
    quantity = Math.max(1, Math.min(20, parseInt(prefixMatch[1], 10)));
    phrase = prefixMatch[2];
  } else if (suffixMatch) {
    quantity = Math.max(1, Math.min(20, parseInt(suffixMatch[2], 10)));
    phrase = suffixMatch[1];
  }

  const normalizedQuery = normalizePhrase(phrase);
  if (!normalizedQuery) return null;

  // A. Exact or direct containment match
  for (const cand of candidates) {
    if (normalizedQuery === cand.term || normalizedQuery.includes(cand.term)) {
      return { item: cand.item, quantity };
    }
  }

  // B. Fuzzy similarity & token overlap match (handles typos like "masla dosa")
  let best = null;
  let bestScore = 0;

  for (const cand of candidates) {
    const sim = similarity(normalizedQuery, cand.term);
    const queryTokens = normalizedQuery.split(' ');
    const candTokens = cand.term.split(' ');
    const overlapCount = queryTokens.filter((qt) =>
      candTokens.some((ct) => ct === qt || similarity(qt, ct) >= 0.8)
    ).length;
    const tokenScore = overlapCount / Math.max(queryTokens.length, candTokens.length);
    const combined = Math.max(sim, tokenScore * 0.95);

    if (combined > bestScore) {
      bestScore = combined;
      best = cand.item;
    }
  }

  if (best && bestScore >= 0.68) {
    return { item: best, quantity };
  }

  return null;
}

/**
 * Main Parser Entry Point
 * @param {string} rawInput - Plain-language order string
 * @param {Array} menuItems - Current menu items from apiClient
 * @param {Array<string>} availableSlotIds - Valid 10-min slot IDs
 */
export function parsePlainLanguageOrder(
  rawInput,
  menuItems = [],
  availableSlotIds = ['12:20', '12:30', '12:40', '12:50'],
  slots = []
) {
  if (!rawInput || !rawInput.trim()) {
    return {
      items: [],
      outOfStockItems: [],
      slotId: null,
      requestedUnsupportedTime: null,
      orderType: null,
      durationMins: null,
      requestedDurationMins: null,
      wasDurationCapped: false,
      unmatchedSegments: []
    };
  }

  const lowered = rawInput.toLowerCase().trim();

  // 1. Extract dine-in / takeaway mode
  const modeResult = extractOrderMode(lowered);

  // 2. Extract target pickup slot
  const timeResult = extractTimeSlot(modeResult.remainingText, availableSlotIds);

  // 2b. Extract dining duration ("for 45 mins", "1 hour") & apply Peak-Hour 15-min Cap
  const durationResult = extractDiningDuration(timeResult.remainingText);
  const rawDuration = durationResult.durationMins;
  const targetSlotIsPeak = timeResult.slotId ? isPeakSlot(timeResult.slotId, slots) : false;
  const shouldCapDuration = Boolean(rawDuration && targetSlotIsPeak && rawDuration > PEAK_MAX_DURATION_MINS);
  const effectiveDuration = shouldCapDuration ? PEAK_MAX_DURATION_MINS : rawDuration;

  // 3. Split leftover dish expression into clauses on commas, +, &, "and", "with"
  const rawSegments = durationResult.remainingText
    .replace(/\b(and|with|plus)\b/gi, ',')
    .replace(/[+&]/g, ',')
    .split(',')
    .map((s) => cleanText(s))
    .filter(Boolean);

  const candidates = buildMenuCandidates(menuItems);
  const mergedMap = new Map();
  const outOfStockMap = new Map();
  const unmatchedSegments = [];

  for (const seg of rawSegments) {
    // Skip pure filler segments (e.g., "for")
    if (!normalizePhrase(seg)) continue;

    const matched = matchSegmentToDish(seg, candidates);
    if (!matched) {
      unmatchedSegments.push(seg);
      continue;
    }

    const targetMap = matched.item.inStock ? mergedMap : outOfStockMap;
    const existing = targetMap.get(matched.item.id);
    if (existing) {
      existing.quantity += matched.quantity;
    } else {
      targetMap.set(matched.item.id, {
        item: matched.item,
        quantity: matched.quantity
      });
    }
  }

  return {
    items: Array.from(mergedMap.values()),
    outOfStockItems: Array.from(outOfStockMap.values()),
    slotId: timeResult.slotId,
    requestedUnsupportedTime: timeResult.requestedUnsupportedTime,
    orderType: modeResult.orderType,
    durationMins: effectiveDuration,
    requestedDurationMins: rawDuration,
    wasDurationCapped: shouldCapDuration,
    unmatchedSegments
  };
}

