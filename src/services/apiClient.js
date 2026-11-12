/**
 * Centralized API Client for CampusBite Frontend
 * ---------------------------------------------------------------------------
 * Toggle `USE_MOCK_API` to `false` when plugging into the backend REST/WS API.
 * All UI components talk ONLY to this service layer, so no component refactoring
 * is required when migrating from localStorage mock mode to live endpoints.
 */

import {
  INITIAL_MENU,
  INITIAL_SLOTS_META,
  INITIAL_ORDERS,
  CANTEEN_TABLES,
  buildDemoFillOrdersFor1230
} from '../data/mockSeed.js';
import {
  PEAK_MAX_DURATION_MINS,
  computeTablesAvailability,
  formatTimeRange,
  isPeakSlot
} from '../utils/format.js';

const USE_MOCK_API = true;

const API_BASE_URL = 'http://localhost:5000/api';
const WS_BASE_URL = 'ws://localhost:5000/ws/updates';
const STORAGE_KEY = 'campusbite_mock_db_v1';
const STAFF_SESSION_KEY = 'campusbite_staff_session_v1';
const UPDATE_EVENT = 'campusbite:db-update';
const REALTIME_CHANNEL = 'campusbite_live_sync';
const DEMO_STAFF_PIN = '1234';

/**
 * Normalizes order references across IDs and `#`-prefixed tokens (e.g. `#7655` -> `7655`).
 */
export function normalizeOrderRef(ref) {
  return String(ref ?? '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
}

export function matchesOrderRef(order, ref) {
  if (!order || ref == null || ref === '') return false;
  const needle = normalizeOrderRef(ref);
  return (
    normalizeOrderRef(order.id) === needle ||
    normalizeOrderRef(order.token) === needle
  );
}

let activeRole = 'student'; // 'student' | 'kitchen' | 'manager'

export function setApiUserRole(role) {
  activeRole = role;
}

export function isMockApiEnabled() {
  return USE_MOCK_API;
}

/* ==========================================================================
   Staff Session Helpers (sessionStorage) & Auth Headers
   ========================================================================== */

export function getStaffSession() {
  try {
    const raw = sessionStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && (parsed.role === 'kitchen' || parsed.role === 'manager')) {
      return parsed;
    }
  } catch {
    // Ignore invalid sessionStorage data
  }
  return null;
}

export function setStaffSession(session) {
  try {
    sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage write errors
  }
}

export function clearStaffSession() {
  try {
    sessionStorage.removeItem(STAFF_SESSION_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

function getStudentAuthToken() {
  try {
    return localStorage.getItem('campusbite_auth_token') || 'demo-student-jwt-token';
  } catch {
    return 'demo-student-jwt-token';
  }
}

/**
 * Single centralized HTTP request wrapper for backend REST calls.
 * - For public/student routes: attaches Student Authorization token + x-user-role.
 * - For Staff Portal mutations (`staffAuth: true` — updateOrderStatus, toggleItemStock,
 *   addMenuItem): attaches `Authorization: Bearer <staff_token>` and `x-staff-role`.
 */
async function request(endpoint, options = {}) {
  const { method = 'GET', body, headers = {}, staffAuth = false } = options;
  const staffSession = getStaffSession();

  const authHeaders = staffAuth
    ? {
        // Backend middleware verifies staff JWT + role privileges (`kitchen` | `manager`)
        Authorization: `Bearer ${staffSession?.token || 'unauthenticated-staff-token'}`,
        'x-staff-role': staffSession?.role || activeRole
      }
    : {
        Authorization: `Bearer ${getStudentAuthToken()}`,
        'x-user-role': activeRole
      };

  const finalHeaders = {
    'Content-Type': 'application/json',
    ...authHeaders,
    ...headers
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || `API request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.code || 'API_ERROR';
    error.details = payload.details || null;
    throw error;
  }

  return payload;
}

/* ==========================================================================
   LocalStorage Mock Database Engine (Offline Fallback & Cross-Tab Live Sync)
   ========================================================================== */

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadMockDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.menu) && Array.isArray(parsed.orders)) {
        if (!Array.isArray(parsed.prepAdjustments)) {
          parsed.prepAdjustments = [];
        }
        // Automatically merge newly seeded catalog items into stale localStorage caches
        const existingIds = new Set(parsed.menu.map((item) => item.id));
        const missingSeedItems = INITIAL_MENU.filter((item) => !existingIds.has(item.id));
        let didMigrate = false;

        if (missingSeedItems.length > 0) {
          parsed.menu = [...parsed.menu, ...clone(missingSeedItems)];
          didMigrate = true;
        }

        // Sync Loaded Cheese Fries aliases & ensure every seeded item has a real food photo URL (replacing stale SVG caches)
        const seedById = new Map(INITIAL_MENU.map((item) => [item.id, item]));
        parsed.menu = parsed.menu.map((item) => {
          const seedItem = seedById.get(item.id);
          if (!seedItem) return item;

          let updated = item;
          const imgVal = typeof item.image === 'string' ? item.image.trim() : '';
          const hasStaleOrSvgImage =
            !imgVal ||
            imgVal.includes('<svg') ||
            imgVal.toLowerCase().includes('.svg') ||
            imgVal.startsWith('data:image/svg') ||
            imgVal !== seedItem.image;

          if (hasStaleOrSvgImage && seedItem.image) {
            updated = { ...updated, image: seedItem.image };
            didMigrate = true;
          }

          if (item.id === 'item-fries' && Array.isArray(item.aliases) && item.aliases.includes('fries')) {
            updated = { ...updated, aliases: clone(seedItem.aliases) };
            didMigrate = true;
          }
          return updated;
        });

        if (didMigrate) {
          saveMockDb(parsed, false);
        }
        return parsed;
      }
    }
  } catch {
    // Ignore malformed localStorage and fall back to fresh seed
  }

  const seeded = {
    menu: clone(INITIAL_MENU),
    slotsMeta: clone(INITIAL_SLOTS_META),
    orders: clone(INITIAL_ORDERS),
    prepAdjustments: []
  };
  saveMockDb(seeded, false);
  return seeded;
}

function broadcastLiveSync(message) {
  if (typeof window === 'undefined') return;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(REALTIME_CHANNEL);
      ch.postMessage({ timestamp: Date.now(), ...message });
      ch.close();
    }
  } catch {
    // BroadcastChannel optional
  }
}

function saveMockDb(db, notify = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Fallback gracefully if storage quota exceeded
  }
  if (notify && typeof window !== 'undefined') {
    const payload = { timestamp: Date.now() };
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: payload }));
    broadcastLiveSync({ type: 'CROSS_TAB_SYNC', ...payload });
  }
}

function getBookedTableSetForSlot(db, slotId) {
  const availability = computeTablesAvailability(db.orders, CANTEEN_TABLES, slotId, 10);
  const taken = new Set(availability.filter((t) => t.isBooked).map((t) => t.number));

  const slotDineInCount = db.orders.filter(
    (ord) => ord.slotId === slotId && ord.status !== 'CANCELLED' && ord.orderType === 'dine-in'
  ).length;

  // Ensure simulated / unnumbered dine-in bookings also occupy distinct table numbers
  for (let n = 1; n <= 10 && taken.size < slotDineInCount; n += 1) {
    taken.add(n);
  }
  return taken;
}

function computeSlotsFromDb(db) {
  return db.slotsMeta.map((slot) => {
    const slotOrders = db.orders.filter(
      (ord) => ord.slotId === slot.id && ord.status !== 'CANCELLED'
    );
    const foodOrdersCount = slotOrders.length;
    const bookedTableNumbers = Array.from(getBookedTableSetForSlot(db, slot.id)).sort(
      (a, b) => a - b
    );
    const dineInTablesCount = bookedTableNumbers.length;
    const slotBase = {
      ...slot,
      foodOrdersCount,
      dineInTablesCount
    };
    const peak = isPeakSlot(slotBase);

    return {
      ...slotBase,
      isPeak: peak,
      maxDurationMins: peak ? PEAK_MAX_DURATION_MINS : 60,
      freeTablesCount: Math.max(0, slot.maxDineInTables - dineInTablesCount),
      bookedTableNumbers,
      isFoodFull: foodOrdersCount >= slot.maxFoodOrders,
      isTablesFull: dineInTablesCount >= slot.maxDineInTables
    };
  });
}

function generateUniqueToken(existingOrders) {
  const used = new Set(existingOrders.map((o) => o.token));
  for (let i = 0; i < 40; i += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!used.has(candidate)) return candidate;
  }
  return String(Date.now()).slice(-4);
}

/* ==========================================================================
   Public & Staff Protected API Client Methods
   ========================================================================== */

export const apiClient = {
  /**
   * Authenticate Staff Portal access using PIN & role (`kitchen` | `manager`).
   * // TODO: Connect Backend Endpoint -> POST /api/staff/login
   */
  async authenticateStaff({ pin, role }) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> const res = await request('/staff/login', { method: 'POST', body: { pin, role } });
      const res = await request('/staff/login', {
        method: 'POST',
        body: { pin, role }
      });
      setStaffSession(res);
      return res;
    }

    const cleanPin = String(pin || '').trim();
    if (cleanPin !== DEMO_STAFF_PIN) {
      const err = new Error('Invalid Staff PIN. Use demo PIN 1234.');
      err.code = 'INVALID_PIN';
      throw err;
    }

    const validRole = role === 'manager' ? 'manager' : 'kitchen';
    const session = {
      role: validRole,
      token: `staff-${validRole}-jwt-${Date.now().toString(36)}`,
      authenticatedAt: new Date().toISOString()
    };
    setStaffSession(session);
    setApiUserRole(validRole);
    return clone(session);
  },

  /**
   * Fetch canteen menu items with optional filter (`all` | `veg` | `non-veg` | `new`).
   * // TODO: Connect Backend Endpoint -> GET /api/menu
   */
  async getMenu(filter = 'all') {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request(`/menu?filter=${encodeURIComponent(filter)}`);
      return request(`/menu?filter=${encodeURIComponent(filter)}`);
    }

    const db = loadMockDb();
    let items = db.menu;
    if (filter === 'veg') items = items.filter((i) => i.isVeg);
    else if (filter === 'non-veg') items = items.filter((i) => !i.isVeg);
    else if (filter === 'new') items = items.filter((i) => i.isNew);
    else if (filter === 'snacks') {
      items = items.filter((i) => i.category === 'Snacks' || i.category === 'Quick Bites');
    } else if (filter === 'burgers') items = items.filter((i) => i.category === 'Burgers');
    else if (filter === 'beverages') items = items.filter((i) => i.category === 'Beverages');
    else if (filter === 'desserts') items = items.filter((i) => i.category === 'Desserts');
    return clone(items);
    return clone(items);
  },

  /**
   * Fetch 10-minute pickup & dine-in slot capacities.
   * // TODO: Connect Backend Endpoint -> GET /api/slots
   */
  async getSlots() {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request('/slots');
      return request('/slots');
    }

    const db = loadMockDb();
    return computeSlotsFromDb(db);
  },

  /**
   * Evaluates table availability for a target start slot and dining duration,
   * accounting for multi-slot overlap locks from earlier and upcoming bookings.
   * // TODO: Connect Backend Endpoint -> GET /api/tables/availability?slotId=...&durationMins=...
   */
  async getAvailableTables(slotId = '12:30', durationMins = 30) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request(`/tables/availability?slotId=${encodeURIComponent(slotId)}&durationMins=${Number(durationMins) || 30}`);
      return request(
        `/tables/availability?slotId=${encodeURIComponent(slotId)}&durationMins=${Number(durationMins) || 30}`
      );
    }

    const db = loadMockDb();
    return clone(computeTablesAvailability(db.orders, CANTEEN_TABLES, slotId, durationMins));
  },

  /**
   * Fetch orders (optionally filtered by studentId, slotId, or status).
   * // TODO: Connect Backend Endpoint -> GET /api/orders
   */
  async getOrders(filters = {}) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request('/orders?...');
      const params = new URLSearchParams(filters).toString();
      return request(`/orders${params ? `?${params}` : ''}`);
    }

    const db = loadMockDb();
    let list = db.orders;
    if (filters.studentId) {
      list = list.filter((o) => o.studentId === filters.studentId);
    }
    if (filters.slotId) {
      list = list.filter((o) => o.slotId === filters.slotId);
    }
    if (filters.status) {
      list = list.filter((o) => o.status === filters.status);
    }
    return clone(list).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  /**
   * Fetch a single order by `id` or `#token` (used by 1.5s Student heartbeat fallback).
   * // TODO: Connect Backend Endpoint -> GET /api/orders/:id
   */
  async getOrderById(orderRef) {
    const cleanRef = String(orderRef ?? '').replace(/^#/, '').trim();
    if (!cleanRef) return null;

    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request(`/orders/${encodeURIComponent(cleanRef)}`);
      return request(`/orders/${encodeURIComponent(cleanRef)}`);
    }

    const db = loadMockDb();
    const found = db.orders.find((o) => matchesOrderRef(o, orderRef));
    return found ? clone(found) : null;
  },

  /**
   * Place a new pre-order into a load-balanced slot & reserve table if dine-in.
   * // TODO: Connect Backend Endpoint -> POST /api/orders
   */
  async createOrder(orderPayload) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request('/orders', { method: 'POST', body: orderPayload });
      return request('/orders', { method: 'POST', body: orderPayload });
    }

    const db = loadMockDb();
    const slots = computeSlotsFromDb(db);
    const targetSlot = slots.find((s) => s.id === orderPayload.slotId);

    if (!targetSlot) {
      throw new Error(`Invalid pickup slot: ${orderPayload.slotId}`);
    }
    if (targetSlot.isFoodFull) {
      const err = new Error(`Slot ${targetSlot.id} is full (10/10 food orders).`);
      err.code = 'SLOT_FULL';
      throw err;
    }
    if (orderPayload.orderType === 'dine-in' && targetSlot.isTablesFull) {
      const err = new Error(`All 10 dine-in tables in ${targetSlot.id} are reserved.`);
      err.code = 'TABLES_FULL';
      throw err;
    }

    const verifiedItems = [];
    let totalAmount = 0;

    for (const line of orderPayload.items || []) {
      const menuItem = db.menu.find((m) => m.id === line.itemId);
      if (!menuItem) throw new Error(`Dish not found: ${line.itemId}`);
      if (!menuItem.inStock) throw new Error(`${menuItem.name} just went out of stock.`);

      const qty = Math.max(1, Number(line.qty || line.quantity || 1));
      verifiedItems.push({
        itemId: menuItem.id,
        name: menuItem.name,
        qty,
        price: menuItem.price
      });
      totalAmount += menuItem.price * qty;
    }

    if (verifiedItems.length === 0) {
      throw new Error('Cannot place an empty order.');
    }

    let tableNumber = null;
    const isDineIn = orderPayload.orderType === 'dine-in';
    const slotIsPeak = isPeakSlot(targetSlot, slots);

    // TODO: Enforce peak-hour 15-min max duration on backend
    const rawRequestedDuration = Number(orderPayload.durationMins) || (slotIsPeak ? PEAK_MAX_DURATION_MINS : 30);
    const maxAllowedForSlot = slotIsPeak ? PEAK_MAX_DURATION_MINS : 60;
    const peakDurationCapped = isDineIn && slotIsPeak && rawRequestedDuration > PEAK_MAX_DURATION_MINS;
    const durationMins = isDineIn
      ? Math.max(10, Math.min(maxAllowedForSlot, rawRequestedDuration))
      : null;

    if (isDineIn) {
      const tableAvailability = computeTablesAvailability(
        db.orders,
        CANTEEN_TABLES,
        targetSlot.id,
        durationMins
      );
      const takenTables = getBookedTableSetForSlot(db, targetSlot.id);
      const rawTableRef = orderPayload.tableNumber ?? orderPayload.tableId;
      const requestedNum = rawTableRef
        ? Number(String(rawTableRef).replace(/^t/i, '').trim())
        : null;

      if (requestedNum && Number.isInteger(requestedNum) && requestedNum >= 1 && requestedNum <= 10) {
        const entry = tableAvailability.find((t) => t.number === requestedNum);
        if (takenTables.has(requestedNum) || entry?.isBooked) {
          const err = new Error(
            `Table T${requestedNum} is already booked at ${targetSlot.id}${
              entry?.bookedRange ? ` (${entry.bookedRange})` : ''
            }.`
          );
          err.code = 'TABLE_TAKEN';
          throw err;
        }
        if (entry?.hasConflict) {
          const err = new Error(
            `Table T${requestedNum} has a booking at ${entry.conflictAt}. Pick a shorter duration or open table.`
          );
          err.code = 'TABLE_DURATION_CONFLICT';
          throw err;
        }
        tableNumber = requestedNum;
      } else {
        const conflictFree = tableAvailability.find(
          (t) => !t.isBooked && !takenTables.has(t.number) && !t.hasConflict
        );
        const anyFree = tableAvailability.find((t) => !t.isBooked && !takenTables.has(t.number));
        if (conflictFree) {
          tableNumber = conflictFree.number;
        } else if (anyFree) {
          tableNumber = anyFree.number;
        } else {
          tableNumber = targetSlot.dineInTablesCount + 1;
        }
      }
    }

    const rangeInfo = isDineIn ? formatTimeRange(targetSlot.id, durationMins) : null;

    const newOrder = {
      id: `ord-${Date.now().toString(36)}`,
      token: generateUniqueToken(db.orders),
      studentId: orderPayload.studentId,
      studentName: orderPayload.studentName || 'Campus Student',
      slotId: targetSlot.id,
      orderType: isDineIn ? 'dine-in' : 'takeaway',
      durationMins,
      peakDurationCapped,
      endSlotTime: rangeInfo ? rangeInfo.endLabel : null,
      timeRangeLabel: rangeInfo ? rangeInfo.compactRange : null,
      tableNumber,
      tableId: tableNumber ? `T${tableNumber}` : null,
      status: 'PLACED',
      createdAt: new Date().toISOString(),
      items: verifiedItems,
      totalAmount
    };

    db.orders.unshift(newOrder);
    saveMockDb(db);
    return clone(newOrder);
  },

  /**
   * Canonical slot & table reservation wrapper enforcing peak-hour 15-min cap rules.
   * // TODO: Enforce peak-hour 15-min max duration on backend (POST /api/orders)
   */
  async bookSlotAndOrder(orderPayload) {
    // TODO: Enforce peak-hour 15-min max duration on backend
    return this.createOrder(orderPayload);
  },

  /**
   * Staff Protected Action (`kitchen` | `manager`):
   * Update order lifecycle status (`PLACED` -> `PREPARING` -> `READY` -> `COLLECTED`).
   * // TODO: Connect Backend Endpoint -> PATCH /api/orders/:orderId/status (sends Authorization + x-staff-role)
   */
  async updateOrderStatus(orderId, status) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> requires staff Authorization Bearer token & x-staff-role header
      return request(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: { status },
        staffAuth: true
      });
    }

    const db = loadMockDb();
    const order = db.orders.find((o) => matchesOrderRef(o, orderId));
    if (!order) {
      throw new Error(`Order ${orderId} not found.`);
    }
    const normalizedStatus = String(status || '').trim().toUpperCase() || 'READY';
    order.status = normalizedStatus;
    if (normalizedStatus === 'READY' && order.orderType === 'dine-in' && !order.seatedAt) {
      order.seatedAt = new Date().toISOString();
    }
    order.updatedAt = new Date().toISOString();
    saveMockDb(db);
    broadcastLiveSync({
      type: 'ORDER_STATUS_UPDATED',
      orderId: order.id,
      token: order.token,
      status: normalizedStatus === 'READY' ? 'Ready' : normalizedStatus
    });
    return clone(order);
  },

  /**
   * Staff Protected Action (`manager`):
   * Toggle item stock (`inStock`) or `"New Update"` flag (`isNew`) from Manager Dashboard.
   * // TODO: Connect Backend Endpoint -> PATCH /api/menu/:itemId (sends Authorization + x-staff-role)
   */
  async toggleItemStock(itemId, updates) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> requires staff Authorization Bearer token & x-staff-role header
      return request(`/menu/${itemId}`, {
        method: 'PATCH',
        body: updates,
        staffAuth: true
      });
    }

    const db = loadMockDb();
    const item = db.menu.find((m) => m.id === itemId);
    if (!item) {
      throw new Error(`Menu item ${itemId} not found.`);
    }
    if (typeof updates.inStock === 'boolean') item.inStock = updates.inStock;
    if (typeof updates.isNew === 'boolean') item.isNew = updates.isNew;

    saveMockDb(db);
    return clone(item);
  },

  /**
   * Staff Protected Action (`manager`):
   * Publish a brand-new food item from Canteen Manager Dashboard.
   * // TODO: Connect Backend Endpoint -> POST /api/menu (sends Authorization + x-staff-role)
   */
  async addMenuItem(itemPayload) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> requires staff Authorization Bearer token & x-staff-role header
      return request('/menu', {
        method: 'POST',
        body: itemPayload,
        staffAuth: true
      });
    }

    const db = loadMockDb();
    const cleanName = String(itemPayload.name || '').trim();
    if (!cleanName) throw new Error('Dish name is required.');

    const newItem = {
      id: `item-${Date.now().toString(36)}`,
      name: cleanName,
      price: Math.max(1, Number(itemPayload.price) || 50),
      isVeg: Boolean(itemPayload.isVeg),
      isNew: itemPayload.isNew !== undefined ? Boolean(itemPayload.isNew) : true,
      inStock: true,
      calories: Math.max(20, Number(itemPayload.calories) || 300),
      protein: Math.max(1, Number(itemPayload.protein) || 10),
      carbs: Math.round(((Number(itemPayload.calories) || 300) * 0.5) / 4),
      fat: Math.round(((Number(itemPayload.calories) || 300) * 0.25) / 9),
      prepMins: Math.max(2, Number(itemPayload.prepMins) || 6),
      rating: 4.8,
      category: itemPayload.isVeg ? 'Veg Specials' : 'Chef Specials',
      artKey: 'custom',
      image: itemPayload.image || './assets/dishes/custom.jpg',
      description:
        itemPayload.description ||
        `Freshly prepared ${cleanName} added live by the Canteen Manager.`,
      aliases: [cleanName.toLowerCase()]
    };

    db.menu.unshift(newItem);
    saveMockDb(db);
    return clone(newItem);
  },

  // Alias preserved for backwards compatibility
  createMenuItem(itemPayload) {
    return this.addMenuItem(itemPayload);
  },

  /**
   * Pitch Helper: Sets slot `12:30` to exact 9/10 capacity (Amber / Filling Fast).
   * // TODO: Connect Backend Endpoint -> POST /api/demo/fill-slot
   */
  async fillSlotForDemo(slotId = '12:30', targetCount = 9) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request('/demo/fill-slot', { method: 'POST', body: { slotId, targetCount } });
      return request('/demo/fill-slot', {
        method: 'POST',
        body: { slotId, targetCount }
      });
    }

    const db = loadMockDb();
    const otherOrders = db.orders.filter((o) => o.slotId !== slotId);
    const fillOrders = buildDemoFillOrdersFor1230().slice(0, targetCount);

    db.orders = [...fillOrders, ...otherOrders];
    saveMockDb(db);
    return computeSlotsFromDb(db);
  },

  /**
   * Restores initial seed dataset in localStorage for repeat demo runs.
   */
  async resetDemoState() {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> return request('/demo/reset', { method: 'POST' });
      return request('/demo/reset', { method: 'POST' });
    }

    const seeded = {
      menu: clone(INITIAL_MENU),
      slotsMeta: clone(INITIAL_SLOTS_META),
      orders: clone(INITIAL_ORDERS),
      prepAdjustments: []
    };
    saveMockDb(seeded);
    return seeded;
  },

  /**
   * Lists Manager-approved smart batch prep recommendations pushed to KDS.
   * // TODO: Connect Backend Endpoint -> GET /api/analytics/prep-adjustments
   */
  async getPrepAdjustments() {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> requires staff Authorization Bearer token
      return request('/analytics/prep-adjustments', {
        staffAuth: true
      });
    }

    const db = loadMockDb();
    return clone(db.prepAdjustments || []);
  },

  /**
   * Applies a smart recommendation from Manager Insights and pushes batch prep target to KDS.
   * // TODO: Connect Backend Endpoint -> POST /api/analytics/recommendations/apply
   *
   * @param {{ id: string, title: string, itemName: string, deltaQty: number, slotId: string, note?: string }} recommendation
   */
  async applyPrepRecommendation(recommendation) {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> requires staff Authorization Bearer token & x-staff-role header
      return request('/analytics/recommendations/apply', {
        method: 'POST',
        body: recommendation,
        staffAuth: true
      });
    }

    const db = loadMockDb();
    if (!Array.isArray(db.prepAdjustments)) {
      db.prepAdjustments = [];
    }

    const recId = String(recommendation?.id || `rec-${Date.now().toString(36)}`);
    const entry = {
      id: recId,
      title: recommendation?.title || 'Batch Prep Adjustment',
      itemName: recommendation?.itemName || 'Masala Dosa',
      deltaQty: Number(recommendation?.deltaQty) || 12,
      slotId: recommendation?.slotId || '12:30',
      note: recommendation?.note || 'Applied via Canteen Manager Insights',
      appliedAt: Date.now()
    };

    const existingIdx = db.prepAdjustments.findIndex((item) => item.id === recId);
    if (existingIdx >= 0) {
      db.prepAdjustments[existingIdx] = entry;
    } else {
      db.prepAdjustments.unshift(entry);
    }

    saveMockDb(db);
    broadcastLiveSync({ type: 'PREP_ADJUSTMENT_APPLIED', adjustment: entry });
    return clone(entry);
  },

  /**
   * Fetches aggregated Demand Prediction & Food Waste Insights for the Canteen Manager portal.
   * // TODO: Connect Backend Endpoint -> GET /api/analytics/insights
   */
  async getOrderInsights() {
    if (!USE_MOCK_API) {
      // TODO: Connect Backend Endpoint -> requires staff Authorization Bearer token
      return request('/analytics/insights', {
        staffAuth: true
      });
    }

    const db = loadMockDb();
    const validOrders = (db.orders || []).filter((o) => o.status !== 'CANCELLED');
    const baselineOrders = 832; // Realistic daily campus lunch baseline + live active orders
    const totalOrdersToday = baselineOrders + validOrders.length;

    const dishCounts = {};
    for (const order of validOrders) {
      for (const line of order.items || []) {
        dishCounts[line.name] = (dishCounts[line.name] || 0) + Number(line.qty || 1);
      }
    }

    return {
      totalOrdersToday,
      liveOrdersCount: validOrders.length,
      foodWasteRate: 18,
      wasteReductionPct: 35,
      predictionAccuracy: 92,
      costSaved: 1250 + validOrders.length * 18,
      dishCounts,
      prepAdjustments: clone(db.prepAdjustments || [])
    };
  },

  /**
   * Real-time order status listener for instant "Order Ready!" alerts.
   * // TODO: Connect Supabase Realtime / WebSocket / SSE listener
   *
   * @param {string|null} orderId - Specific order ID to watch, or null to watch all order updates
   * @param {(order: object, meta: object) => void} callback - Invoked when order status changes
   * @returns {() => void} Unsubscribe cleanup function
   */
  subscribeToOrderUpdates(orderId, callback) {
    if (!USE_MOCK_API) {
      // TODO: Connect Supabase Realtime / WebSocket / SSE listener
      // Example:
      // const es = new EventSource(`${API_BASE_URL}/orders/${orderId || 'stream'}/events`);
      // es.onmessage = (evt) => callback(JSON.parse(evt.data), { type: 'SSE_ORDER_UPDATE' });
      // return () => es.close();
      const ws = new WebSocket(
        `${WS_BASE_URL}?role=${encodeURIComponent(activeRole)}${
          orderId ? `&orderId=${encodeURIComponent(orderId)}` : ''
        }`
      );
      ws.addEventListener('message', (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (!orderId || payload?.id === orderId || payload?.order?.id === orderId) {
            callback(payload.order || payload, { type: 'WS_ORDER_UPDATE' });
          }
        } catch {
          // Ignore malformed frame
        }
      });
      return () => ws.close();
    }

    const statusCache = new Map();
    loadMockDb().orders.forEach((o) => statusCache.set(o.id, o.status));

    const inspectOrders = (sourceType, evtPayload = null) => {
      const db = loadMockDb();
      const candidates = orderId
        ? db.orders.filter((o) => matchesOrderRef(o, orderId))
        : db.orders;

      for (const ord of candidates) {
        const prevStatus = statusCache.get(ord.id);
        const explicitlyUpdated =
          evtPayload?.type === 'ORDER_STATUS_UPDATED' && matchesOrderRef(ord, evtPayload.orderId || evtPayload.token);

        if (prevStatus !== ord.status || explicitlyUpdated) {
          statusCache.set(ord.id, ord.status);
          callback(clone(ord), {
            type: sourceType,
            prevStatus: prevStatus || null,
            nextStatus: ord.status,
            orderId: ord.id,
            status: ord.status === 'READY' ? 'Ready' : ord.status
          });
        }
      }
    };

    const handleLocal = () => inspectOrders('LOCAL_SYNC');
    const handleStorage = (evt) => {
      if (!evt.key || evt.key === STORAGE_KEY) {
        inspectOrders('CROSS_TAB_SYNC');
      }
    };

    let channel = null;
    const handleBroadcast = (msg) => {
      const data = msg?.data || {};
      inspectOrders(data.type || 'CROSS_TAB_SYNC', data);
    };
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(REALTIME_CHANNEL);
        channel.addEventListener('message', handleBroadcast);
      }
    } catch {
      channel = null;
    }

    window.addEventListener(UPDATE_EVENT, handleLocal);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(UPDATE_EVENT, handleLocal);
      window.removeEventListener('storage', handleStorage);
      if (channel) {
        channel.removeEventListener('message', handleBroadcast);
        channel.close();
      }
    };
  },

  /**
   * Real-time cross-tab sync (Mock Mode via `storage` + `BroadcastChannel`) or WebSocket in production.
   * // TODO: Connect Backend WebSocket -> ws://.../ws/updates
   */
  subscribeToUpdates(onUpdate) {
    if (!USE_MOCK_API) {
      // TODO: Connect Supabase Realtime / WebSocket / SSE listener
      const staffSession = getStaffSession();
      const wsRole = staffSession?.role || activeRole;
      const ws = new WebSocket(`${WS_BASE_URL}?role=${encodeURIComponent(wsRole)}`);
      ws.addEventListener('message', (evt) => {
        try {
          onUpdate(JSON.parse(evt.data));
        } catch {
          onUpdate({ type: 'SYNC_REQUIRED' });
        }
      });
      return () => ws.close();
    }

    const handleLocal = () => onUpdate({ type: 'LOCAL_SYNC' });
    const handleStorage = (evt) => {
      // Instantaneously syncs Student Page (Tab 1) <-> Staff Portal (Tab 2)
      if (!evt.key || evt.key === STORAGE_KEY) {
        onUpdate({ type: 'CROSS_TAB_SYNC' });
      }
    };

    let channel = null;
    const handleBroadcast = (msg) => {
      const data = msg?.data || {};
      onUpdate({ ...data, type: data.type || 'CROSS_TAB_SYNC' });
    };
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(REALTIME_CHANNEL);
        channel.addEventListener('message', handleBroadcast);
      }
    } catch {
      channel = null;
    }

    window.addEventListener(UPDATE_EVENT, handleLocal);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(UPDATE_EVENT, handleLocal);
      window.removeEventListener('storage', handleStorage);
      if (channel) {
        channel.removeEventListener('message', handleBroadcast);
        channel.close();
      }
    };
  }
};
