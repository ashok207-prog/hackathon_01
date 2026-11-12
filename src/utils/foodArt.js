/**
 * High-resolution food photography renderer for CampusBite menu cards,
 * dish detail modals, manager stock view, and analytics thumbnails.
 */

const PHOTO_KEYS = new Set([
  'dosa',
  'coffee',
  'puff',
  'roll',
  'wrap',
  'rice',
  'chole',
  'chai',
  'bowl',
  'samosa',
  'fries',
  'crispy-fries',
  'custom'
]);

const FALLBACK_PHOTO_URL = './assets/dishes/custom.jpg';

const PHOTO_URL_BY_KEY = {
  'garlic-bread': 'https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?auto=format&fit=crop&w=600&q=80',
  'aloo-burger': 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=600&q=80',
  'chicken-burger': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80',
  'diet-coke': 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=600&q=80',
  'soft-drink': 'https://images.unsplash.com/photo-1581006852262-e4307cf6283a?auto=format&fit=crop&w=600&q=80',
  'oreo-shake': 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&q=80',
  'strawberry-shake': 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=600&q=80',
  'choc-icecream': 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=600&q=80',
  'vanilla-sundae': 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=600&q=80'
};

function escAttr(str) {
  return String(str ?? 'CampusBite dish')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function isRealImageUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (
    trimmed.includes('<svg') ||
    trimmed.toLowerCase().includes('.svg') ||
    trimmed.startsWith('data:image/svg')
  ) {
    return false;
  }
  return /^(https?:\/\/|\.\/|\/|data:image\/)/i.test(trimmed);
}

export function getDishArt(artKey, isVeg = true, altText = 'CampusBite dish', imageUrl = '') {
  const localPhoto = PHOTO_KEYS.has(artKey) ? `./assets/dishes/${artKey}.jpg` : FALLBACK_PHOTO_URL;
  const resolvedSrc = isRealImageUrl(imageUrl)
    ? imageUrl.trim()
    : PHOTO_URL_BY_KEY[artKey] || localPhoto;

  return `
    <img
      class="dish-photo"
      src="${escAttr(resolvedSrc)}"
      alt="${escAttr(altText)}"
      loading="lazy"
      onerror="this.onerror=null; this.src='${FALLBACK_PHOTO_URL}';"
    />
  `;
}
