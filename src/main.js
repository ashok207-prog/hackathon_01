import {
  apiClient,
  setApiUserRole,
  getStaffSession,
  setStaffSession,
  clearStaffSession,
  normalizeOrderRef
} from './services/apiClient.js';
import { CURRENT_STUDENT_ID, CURRENT_STUDENT_NAME, CANTEEN_TABLES } from './data/mockSeed.js';
import { parsePlainLanguageOrder } from './utils/nlpOrderParser.js';
import {
  PEAK_MAX_DURATION_MINS,
  computeTablesAvailability,
  escapeHtml,
  formatLiveTableCountdown,
  formatTimeRange,
  isPeakSlot
} from './utils/format.js';
import { icon } from './utils/icons.js';

import { renderHeader } from './components/Header.js';
import { renderOrderReadyBanner } from './components/OrderReadyBanner.js';
import { renderCartDrawer } from './components/CartDrawer.js';
import { renderDishDetailModal } from './components/DishDetailModal.js';
import { renderTableAvailabilityModal } from './components/TableAvailabilityModal.js';
import { renderStudentView, renderNlpLivePreview } from './views/StudentView.js';
import { renderKitchenView } from './views/KitchenView.js';
import { renderManagerView } from './views/ManagerView.js';
import { renderStaffLoginView } from './views/StaffLoginView.js';

const appRoot = document.getElementById('app-root');
const toastRoot = document.getElementById('toast-root');

function resolveRouteFromHash() {
  const hash = (window.location.hash || '').toLowerCase();
  return hash === '#staff' || hash === '#/staff' ? 'staff' : 'student';
}

const initialStaffSession = getStaffSession();

const state = {
  route: resolveRouteFromHash(), // 'student' | 'staff'
  staffSession: initialStaffSession, // null | { role: 'kitchen' | 'manager', token }
  staffLoginRole: 'kitchen',
  staffLoginPin: '',
  staffLoginError: null,
  menu: [],
  slots: [],
  orders: [],
  menuFilter: 'all', // 'all' | 'veg' | 'non-veg' | 'new'
  orderType: 'takeaway', // 'takeaway' | 'dine-in'
  selectedSlotId: '12:30',
  selectedTableNumber: null,
  selectedDurationMins: 15,
  userExplicitDuration: false,
  kdsBatchSlot: 'all',
  managerTab: 'all', // 'all' | 'operations' | 'analytics'
  prepAdjustments: [],
  cart: [], // [{ itemId, qty }]
  studentName: CURRENT_STUDENT_NAME,
  isCartOpen: false,
  isTableMapOpen: false,
  isSubmittingOrder: false,
  activeDishModalId: null,
  nlpQuery: '',
  nlpFeedback: null,
  slotSuggestion: null,
  flashSlotId: null,
  shakeSlotId: null,
  dismissedReadyIds: []
};

// Deduplicates audio/toast Ready celebrations across BroadcastChannel, storage events, and 1.5s polling
const notifiedOrderIds = new Set();
let heartbeatTimerId = null;
let isHeartbeatPolling = false;

/* ==========================================================================
   Toast Notifications & Gentle Ready Chime (Web Audio API)
   ========================================================================== */

function playOrderReadyChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5 soft chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = ctx.currentTime + idx * 0.1;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.075, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Safely ignore if browser autoplay policy blocks Web Audio API
  }
}

function showToast(title, message = '', variant = 'info', duration = 3800) {
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${variant}`;
  toastEl.innerHTML = `
    <div style="margin-top:2px;color:${
      variant === 'success'
        ? 'var(--emerald)'
        : variant === 'warning'
        ? 'var(--amber)'
        : variant === 'error'
        ? 'var(--crimson)'
        : 'var(--sage-accent)'
    }">
      ${icon(variant === 'success' ? 'checkCircle' : variant === 'error' || variant === 'warning' ? 'alert' : 'sparkles', 18)}
    </div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-msg">${escapeHtml(message)}</div>` : ''}
    </div>
    <button type="button" class="toast-close" aria-label="Dismiss notification">${icon('close', 14)}</button>
  `;

  toastEl.querySelector('.toast-close').addEventListener('click', () => toastEl.remove());
  toastRoot.appendChild(toastEl);

  window.setTimeout(() => {
    if (toastEl.isConnected) toastEl.remove();
  }, duration);
}

/* ==========================================================================
   Navigation & Auth Helpers
   ========================================================================== */

function navigateTo(route) {
  const targetHash = route === 'staff' ? '#staff' : '';
  if (window.location.hash !== targetHash) {
    if (targetHash) {
      window.location.hash = targetHash;
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
  state.route = route;
  state.isCartOpen = false;
  state.activeDishModalId = null;

  if (route === 'staff' && state.staffSession) {
    setApiUserRole(state.staffSession.role);
    renderApp();
  } else {
    setApiUserRole('student');
    syncAllData({ type: 'ROUTE_RETURN' });
  }
}

/* ==========================================================================
   Slot Availability & Auto-Suggestion Helpers
   ========================================================================== */

function isSlotFullForMode(slot, mode) {
  if (!slot) return true;
  if (slot.isFoodFull) return true;
  if (mode === 'dine-in' && slot.isTablesFull) return true;
  return false;
}

function findNextOpenSlot(slots, preferredId, mode) {
  const idx = slots.findIndex((s) => s.id === preferredId);
  const ordered =
    idx >= 0 ? [...slots.slice(idx + 1), ...slots.slice(0, idx)] : [...slots];
  return ordered.find((s) => !isSlotFullForMode(s, mode)) || null;
}

function ensureValidSelectedSlot() {
  const current = state.slots.find((s) => s.id === state.selectedSlotId);
  if (current && !isSlotFullForMode(current, state.orderType)) {
    ensureValidSelectedTable();
    return;
  }
  const fallback = state.slots.find((s) => !isSlotFullForMode(s, state.orderType));
  if (fallback) state.selectedSlotId = fallback.id;
  ensureValidSelectedTable();
}

function ensureValidSelectedTable() {
  if (!state.selectedTableNumber) return;
  const activeSlot = state.slots.find((s) => s.id === state.selectedSlotId);
  const booked = activeSlot?.bookedTableNumbers || [];
  if (booked.includes(Number(state.selectedTableNumber))) {
    state.selectedTableNumber = null;
  }
}

function ensureValidDurationForSelectedTable() {
  if (!state.selectedTableNumber) return;
  const avail = computeTablesAvailability(
    state.orders,
    CANTEEN_TABLES,
    state.selectedSlotId,
    state.selectedDurationMins
  );
  const entry = avail.find((t) => t.number === Number(state.selectedTableNumber));
  if (entry && entry.hasConflict && entry.maxAllowedDurationMins >= 15) {
    const capped = [60, 45, 30, 15].find((d) => d <= entry.maxAllowedDurationMins) || 15;
    state.selectedDurationMins = capped;
  }
}

function enforceDurationForSlot(targetSlotId = state.selectedSlotId) {
  if (isPeakSlot(targetSlotId, state.slots)) {
    state.selectedDurationMins = PEAK_MAX_DURATION_MINS;
  } else if (state.selectedDurationMins === PEAK_MAX_DURATION_MINS && !state.userExplicitDuration) {
    state.selectedDurationMins = 30;
  }
  ensureValidDurationForSelectedTable();
}

function trySelectSlot(requestedSlotId, mode = state.orderType) {
  const target = state.slots.find((s) => s.id === requestedSlotId);
  if (!target) return { selected: state.selectedSlotId, redirected: false };

  if (!isSlotFullForMode(target, mode)) {
    state.selectedSlotId = target.id;
    state.slotSuggestion = null;
    ensureValidSelectedTable();
    enforceDurationForSlot(target.id);
    triggerSlotFlash(target.id);
    return { selected: target.id, redirected: false };
  }

  state.shakeSlotId = target.id;
  window.setTimeout(() => {
    state.shakeSlotId = null;
    renderApp();
  }, 480);

  const nextOpen = findNextOpenSlot(state.slots, target.id, mode);
  if (nextOpen) {
    state.selectedSlotId = nextOpen.id;
    ensureValidSelectedTable();
    enforceDurationForSlot(nextOpen.id);
    state.slotSuggestion = {
      fullSlotId: target.id,
      suggestedSlotId: nextOpen.id,
      message: `${target.id} is full (10/10). Automatically selected next available slot: ${nextOpen.id}.`
    };
    triggerSlotFlash(nextOpen.id);
    showToast(
      `Slot ${target.id} is Full (10/10)`,
      `Suggested & highlighted next open slot: ${nextOpen.id}.`,
      'warning'
    );
    return { selected: nextOpen.id, redirected: true, suggestedSlotId: nextOpen.id };
  }

  state.slotSuggestion = {
    fullSlotId: target.id,
    suggestedSlotId: null,
    message: `All slots are currently full for ${mode}. Try switching to Takeaway or Reset Demo.`
  };
  showToast('All Slots Full', 'Try switching mode or resetting demo.', 'error');
  return { selected: state.selectedSlotId, redirected: true, suggestedSlotId: null };
}

function triggerSlotFlash(slotId) {
  state.flashSlotId = slotId;
  window.setTimeout(() => {
    if (state.flashSlotId === slotId) {
      state.flashSlotId = null;
      renderApp();
    }
  }, 950);
}

/* ==========================================================================
   Cart & Ordering Operations
   ========================================================================== */

function addToCart(itemId, qty = 1) {
  const dish = state.menu.find((m) => m.id === itemId);
  if (!dish || !dish.inStock) {
    showToast('Unavailable', 'This dish is currently out of stock.', 'warning');
    return;
  }
  const existing = state.cart.find((c) => c.itemId === itemId);
  if (existing) {
    existing.qty += qty;
  } else {
    state.cart.push({ itemId, qty });
  }
}

function updateCartQty(itemId, delta) {
  const idx = state.cart.findIndex((c) => c.itemId === itemId);
  if (idx === -1) return;
  state.cart[idx].qty += delta;
  if (state.cart[idx].qty <= 0) {
    state.cart.splice(idx, 1);
  }
}

function handleNlpSubmit() {
  const query = state.nlpQuery.trim();
  if (!query) {
    showToast('Type an order first', 'Example: 2 masala dosa and 1 cold coffee for 12:30 dine-in', 'warning');
    return;
  }

  const parsed = parsePlainLanguageOrder(
    query,
    state.menu,
    state.slots.map((s) => s.id),
    state.slots
  );

  if (parsed.items.length === 0 && parsed.outOfStockItems.length === 0) {
    state.nlpFeedback = {
      hasWarning: true,
      message: 'Could not recognize a dish name. Try "2 masala dosa and 1 cold coffee for 12:30 dine-in".'
    };
    renderApp();
    return;
  }

  if (parsed.orderType) {
    state.orderType = parsed.orderType;
  }

  for (const entry of parsed.items) {
    addToCart(entry.item.id, entry.quantity);
  }

  let slotNote = `Slot ${state.selectedSlotId}`;
  if (parsed.slotId) {
    const slotOutcome = trySelectSlot(parsed.slotId, state.orderType);
    if (slotOutcome.redirected && slotOutcome.suggestedSlotId) {
      slotNote = `${parsed.slotId} full → auto-selected ${slotOutcome.suggestedSlotId}`;
    } else {
      slotNote = `Slot ${slotOutcome.selected}`;
    }
  } else {
    ensureValidSelectedSlot();
    triggerSlotFlash(state.selectedSlotId);
  }

  let wasCappedByPeak = Boolean(parsed.wasDurationCapped);
  if (parsed.durationMins) {
    const targetIsPeak = isPeakSlot(state.selectedSlotId, state.slots);
    if (targetIsPeak && parsed.durationMins > PEAK_MAX_DURATION_MINS) {
      wasCappedByPeak = true;
      state.selectedDurationMins = PEAK_MAX_DURATION_MINS;
    } else {
      state.selectedDurationMins = targetIsPeak ? PEAK_MAX_DURATION_MINS : parsed.durationMins;
      if (!targetIsPeak) state.userExplicitDuration = true;
    }
    ensureValidDurationForSelectedTable();
  } else {
    enforceDurationForSlot(state.selectedSlotId);
  }

  if (wasCappedByPeak) {
    showToast(
      'Peak Hour Duration Limit',
      'Adjusted table duration to 15 mins (Peak Hour Limit).',
      'warning',
      4500
    );
  }

  const addedSummary = parsed.items.map((e) => `${e.quantity}× ${e.item.name}`).join(', ');
  const oosSummary = parsed.outOfStockItems.map((e) => e.item.name).join(', ');
  const modeLabel =
    state.orderType === 'dine-in'
      ? `Dine-In • ${state.selectedDurationMins} mins`
      : 'Takeaway';

  if (parsed.items.length > 0 && !oosSummary) {
    state.nlpFeedback = {
      hasWarning: false,
      message: `Added ${addedSummary} • ${slotNote} (${modeLabel}).`
    };
    showToast('Smart Order Added', `${addedSummary} added for ${slotNote} (${modeLabel}).`, 'success');
  } else if (parsed.items.length > 0 && oosSummary) {
    state.nlpFeedback = {
      hasWarning: true,
      message: `Added ${addedSummary} (${slotNote}). Skipped out-of-stock: ${oosSummary}.`
    };
    showToast('Partial Smart Order Added', `Out of stock: ${oosSummary}`, 'warning');
  } else {
    state.nlpFeedback = {
      hasWarning: true,
      message: `${oosSummary} is currently out of stock. Try another dish!`
    };
    showToast('Item Out of Stock', `${oosSummary} is currently paused.`, 'error');
  }

  renderApp();
}

/* ==========================================================================
   Data Sync & Master Render
   ========================================================================== */

function notifyStudentOrderReady(order) {
  if (!order) return;
  const orderKey = normalizeOrderRef(order.id);
  if (notifiedOrderIds.has(orderKey)) return;

  notifiedOrderIds.add(orderKey);
  state.dismissedReadyIds = state.dismissedReadyIds.filter(
    (id) => normalizeOrderRef(id) !== orderKey
  );

  const location =
    order.orderType === 'dine-in'
      ? `Table T${order.tableNumber || 1}`
      : 'Takeaway Counter';

  playOrderReadyChime();
  showToast(
    `🎉 Order #${order.token} is Ready!`,
    `Please collect it at ${location} (${order.slotId}).`,
    'success',
    6500
  );
}

async function syncAllData(syncMeta = {}) {
  const [menu, slots, orders, prepAdjustments] = await Promise.all([
    apiClient.getMenu('all'),
    apiClient.getSlots(),
    apiClient.getOrders(),
    apiClient.getPrepAdjustments()
  ]);

  const hadPriorOrders = state.orders.length > 0;
  const prevReadyKeys = new Set(
    state.orders
      .filter((o) => o.studentId === CURRENT_STUDENT_ID && o.status === 'READY')
      .map((o) => normalizeOrderRef(o.id))
  );

  state.menu = menu;
  state.slots = slots;
  state.orders = orders;
  state.prepAdjustments = Array.isArray(prepAdjustments) ? prepAdjustments : [];

  const readyStudentOrders = orders.filter(
    (o) => o.studentId === CURRENT_STUDENT_ID && o.status === 'READY'
  );

  if (state.route === 'student') {
    const isRealtimeSync =
      syncMeta.type === 'CROSS_TAB_SYNC' ||
      syncMeta.type === 'ORDER_STATUS_UPDATED' ||
      syncMeta.type === 'HEARTBEAT_SYNC' ||
      syncMeta.type === 'ROUTE_RETURN';

    const newlyReady = readyStudentOrders.find((o) => {
      const key = normalizeOrderRef(o.id);
      if (notifiedOrderIds.has(key)) return false;
      return (!prevReadyKeys.has(key) && (hadPriorOrders || isRealtimeSync)) || isRealtimeSync;
    });

    if (newlyReady) {
      notifyStudentOrderReady(newlyReady);
    }
  } else {
    // Allow celebration again when returning if order transitions back from non-READY
    const activeReadyKeys = new Set(readyStudentOrders.map((o) => normalizeOrderRef(o.id)));
    for (const key of Array.from(notifiedOrderIds)) {
      if (!activeReadyKeys.has(key)) notifiedOrderIds.delete(key);
    }
  }

  ensureValidSelectedSlot();
  renderApp();
  syncStudentOrderHeartbeat();
}

function syncStudentOrderHeartbeat() {
  const activeOrders = state.orders.filter(
    (o) =>
      o.studentId === CURRENT_STUDENT_ID &&
      o.status !== 'COLLECTED' &&
      o.status !== 'CANCELLED'
  );
  const needsPoll = state.route === 'student' && activeOrders.length > 0;

  if (!needsPoll) {
    if (heartbeatTimerId !== null) {
      window.clearInterval(heartbeatTimerId);
      heartbeatTimerId = null;
    }
    return;
  }

  if (heartbeatTimerId !== null) return;

  // Bulletproof 1.5s fallback poller so Student View updates even if a tab backgrounded or storage event dropped
  heartbeatTimerId = window.setInterval(async () => {
    if (isHeartbeatPolling || state.route !== 'student') return;
    const watchedOrders = state.orders.filter(
      (o) =>
        o.studentId === CURRENT_STUDENT_ID &&
        o.status !== 'COLLECTED' &&
        o.status !== 'CANCELLED'
    );
    if (watchedOrders.length === 0) return;

    isHeartbeatPolling = true;
    try {
      const targetOrder = watchedOrders.find((o) => o.status !== 'READY') || watchedOrders[0];
      const latest = await apiClient.getOrderById(targetOrder.id);
      if (!latest || latest.status !== targetOrder.status) {
        await syncAllData({ type: 'HEARTBEAT_SYNC' });
      }
    } catch {
      // Non-fatal fallback poll
    } finally {
      isHeartbeatPolling = false;
    }
  }, 1500);
}

function renderApp() {
  let viewHtml = '';

  if (state.route === 'staff') {
    if (!state.staffSession) {
      viewHtml = renderStaffLoginView(state);
    } else if (state.staffSession.role === 'manager') {
      viewHtml = renderManagerView(state);
    } else {
      viewHtml = renderKitchenView(state);
    }
  } else {
    viewHtml = renderStudentView(state);
  }

  appRoot.innerHTML = `
    ${renderHeader(state)}
    ${renderOrderReadyBanner(state)}
    <main class="main-container">
      ${viewHtml}
    </main>
    ${state.route === 'student' ? renderCartDrawer(state) : ''}
    ${state.route === 'student' ? renderDishDetailModal(state) : ''}
    ${state.route === 'student' ? renderTableAvailabilityModal(state) : ''}
  `;
}

/* ==========================================================================
   Global Event Delegation
   ========================================================================== */

document.addEventListener('click', async (event) => {
  const stopNode = event.target.closest('[data-stop-propagation="true"]');
  const actionEl = event.target.closest('[data-action]');

  if (stopNode && !actionEl) return;
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  switch (action) {
    case 'open-staff-portal': {
      event.preventDefault();
      navigateTo('staff');
      break;
    }

    case 'go-student-view': {
      navigateTo('student');
      break;
    }

    case 'pick-login-role': {
      state.staffLoginRole = actionEl.dataset.role === 'manager' ? 'manager' : 'kitchen';
      state.staffLoginError = null;
      renderApp();
      break;
    }

    case 'fill-demo-pin': {
      state.staffLoginPin = '1234';
      state.staffLoginError = null;
      renderApp();
      document.getElementById('staff-pin-input')?.focus();
      break;
    }

    case 'switch-staff-role': {
      if (!state.staffSession) break;
      const nextStaffRole = actionEl.dataset.role === 'manager' ? 'manager' : 'kitchen';
      if (nextStaffRole !== state.staffSession.role) {
        const updatedSession = { ...state.staffSession, role: nextStaffRole };
        setStaffSession(updatedSession);
        state.staffSession = updatedSession;
        setApiUserRole(nextStaffRole);
        renderApp();
      }
      break;
    }

    case 'staff-logout': {
      clearStaffSession();
      state.staffSession = null;
      state.staffLoginPin = '';
      state.staffLoginError = null;
      navigateTo('student');
      showToast('Signed Out', 'Returned to Student Ordering Page.', 'info');
      break;
    }

    case 'demo-fill-1230': {
      await apiClient.fillSlotForDemo('12:30', 9);
      state.kdsBatchSlot = '12:30';
      state.selectedSlotId = '12:30';
      state.slotSuggestion = null;
      enforceDurationForSlot('12:30');
      await syncAllData();
      triggerSlotFlash('12:30');
      showToast(
        'Demo Mode: 12:30 Filled to 9/10',
        'Slot 12:30 is now Amber (Filling Fast • 15m Peak Cap active). Place 1 order to lock at 10/10!',
        'warning',
        5000
      );
      break;
    }

    case 'reset-demo': {
      await apiClient.resetDemoState();
      state.cart = [];
      state.nlpQuery = '';
      state.nlpFeedback = null;
      state.slotSuggestion = null;
      state.dismissedReadyIds = [];
      notifiedOrderIds.clear();
      state.kdsBatchSlot = 'all';
      state.selectedSlotId = '12:30';
      state.selectedTableNumber = null;
      state.userExplicitDuration = false;
      state.selectedDurationMins = 15;
      await syncAllData();
      showToast('Demo Dataset Reset', 'Restored clean initial campus canteen data.', 'info');
      break;
    }

    case 'open-cart': {
      state.isCartOpen = true;
      renderApp();
      break;
    }

    case 'close-cart': {
      state.isCartOpen = false;
      renderApp();
      break;
    }

    case 'use-nlp-example': {
      state.nlpQuery = actionEl.dataset.example || '';
      handleNlpSubmit();
      break;
    }

    case 'clear-nlp': {
      state.nlpQuery = '';
      state.nlpFeedback = null;
      renderApp();
      document.getElementById('nlp-order-input')?.focus();
      break;
    }

    case 'set-menu-filter': {
      state.menuFilter = actionEl.dataset.filter || 'all';
      renderApp();
      break;
    }

    case 'add-to-cart': {
      addToCart(actionEl.dataset.itemId, 1);
      renderApp();
      break;
    }

    case 'inc-cart': {
      updateCartQty(actionEl.dataset.itemId, 1);
      renderApp();
      break;
    }

    case 'dec-cart': {
      updateCartQty(actionEl.dataset.itemId, -1);
      renderApp();
      break;
    }

    case 'open-dish-modal': {
      state.activeDishModalId = actionEl.dataset.itemId || null;
      renderApp();
      break;
    }

    case 'close-dish-modal': {
      state.activeDishModalId = null;
      renderApp();
      break;
    }

    case 'set-order-type': {
      const nextMode = actionEl.dataset.orderType;
      if (nextMode && nextMode !== state.orderType) {
        state.orderType = nextMode;
        state.slotSuggestion = null;
        ensureValidSelectedSlot();
        enforceDurationForSlot(state.selectedSlotId);
        renderApp();
      }
      break;
    }

    case 'select-slot': {
      const slotId = actionEl.dataset.slotId;
      trySelectSlot(slotId, state.orderType);
      ensureValidSelectedTable();
      enforceDurationForSlot(state.selectedSlotId);
      renderApp();
      break;
    }

    case 'select-duration': {
      const mins = Number(actionEl.dataset.durationMins);
      if (!mins || actionEl.disabled) break;
      if (isPeakSlot(state.selectedSlotId, state.slots) && mins > PEAK_MAX_DURATION_MINS) {
        state.selectedDurationMins = PEAK_MAX_DURATION_MINS;
        showToast(
          'Peak Hour Duration Limit',
          'Adjusted table duration to 15 mins (Peak Hour Limit).',
          'warning',
          3800
        );
        renderApp();
        break;
      }
      state.selectedDurationMins = mins;
      state.userExplicitDuration = true;
      state.orderType = 'dine-in';

      if (state.selectedTableNumber) {
        const avail = computeTablesAvailability(
          state.orders,
          CANTEEN_TABLES,
          state.selectedSlotId,
          mins
        );
        const tblEntry = avail.find((t) => t.number === Number(state.selectedTableNumber));
        if (tblEntry?.hasConflict) {
          state.selectedTableNumber = null;
          showToast(
            'Table Cleared for Extended Stay',
            `Previous table is booked at ${tblEntry.conflictAt}. Pick an open table or auto-assign.`,
            'warning'
          );
        }
      }
      renderApp();
      break;
    }

    case 'open-table-map': {
      state.isTableMapOpen = true;
      ensureValidSelectedTable();
      ensureValidDurationForSelectedTable();
      renderApp();
      break;
    }

    case 'close-table-map': {
      state.isTableMapOpen = false;
      renderApp();
      break;
    }

    case 'confirm-table-map': {
      state.isTableMapOpen = false;
      if (state.cart.length > 0 && state.selectedTableNumber) {
        state.isCartOpen = true;
      }
      renderApp();
      break;
    }

    case 'select-slot-in-map': {
      const slotId = actionEl.dataset.slotId;
      state.selectedSlotId = slotId;
      state.slotSuggestion = null;
      ensureValidSelectedTable();
      enforceDurationForSlot(slotId);
      renderApp();
      break;
    }

    case 'select-table': {
      const tableNum = Number(actionEl.dataset.tableNumber);
      const avail = computeTablesAvailability(
        state.orders,
        CANTEEN_TABLES,
        state.selectedSlotId,
        state.selectedDurationMins
      );
      const tblInfo = avail.find((t) => t.number === tableNum);
      if (!tableNum || !tblInfo || tblInfo.isBooked) break;

      state.selectedTableNumber = tableNum;
      state.orderType = 'dine-in';

      if (tblInfo.hasConflict && tblInfo.maxAllowedDurationMins >= 15) {
        const adjusted = [60, 45, 30, 15].find((d) => d <= tblInfo.maxAllowedDurationMins) || 15;
        state.selectedDurationMins = adjusted;
        const adjustedRange = formatTimeRange(state.selectedSlotId, adjusted);
        renderApp();
        showToast(
          `Reserved ${tblInfo.id} • Capped to ${adjusted} mins`,
          `Next slot booked at ${tblInfo.conflictAt} — window set to ${adjustedRange.compactRange}.`,
          'warning',
          3600
        );
        break;
      }

      const rangeInfo = formatTimeRange(state.selectedSlotId, state.selectedDurationMins);
      renderApp();
      showToast(
        `Reserved ${tblInfo.id} (${tblInfo.label})`,
        `${rangeInfo.compactRange} (${state.selectedDurationMins} mins) Dine-In.`,
        'success',
        2600
      );
      break;
    }

    case 'place-order': {
      if (state.isSubmittingOrder || state.cart.length === 0) break;
      state.isSubmittingOrder = true;
      renderApp();

      try {
        const chosenNum = state.orderType === 'dine-in' ? state.selectedTableNumber : null;
        const chosenDur = state.orderType === 'dine-in' ? state.selectedDurationMins : null;
        const order = await apiClient.bookSlotAndOrder({
          studentId: CURRENT_STUDENT_ID,
          studentName: state.studentName.trim() || CURRENT_STUDENT_NAME,
          slotId: state.selectedSlotId,
          orderType: state.orderType,
          durationMins: chosenDur,
          tableNumber: chosenNum,
          tableId: chosenNum ? `T${chosenNum}` : null,
          items: state.cart.map((c) => ({ itemId: c.itemId, qty: c.qty }))
        });

        state.cart = [];
        state.isCartOpen = false;
        state.selectedTableNumber = null;
        state.userExplicitDuration = false;
        enforceDurationForSlot(state.selectedSlotId);
        state.nlpFeedback = null;
        state.slotSuggestion = null;
        await syncAllData();

        const rangeText =
          order.orderType === 'dine-in'
            ? `Table T${order.tableNumber} • ${
                formatTimeRange(order.slotId, order.durationMins || 30).compactRange
              } (${order.durationMins || 30}m)`
            : `${order.slotId} Takeaway`;

        showToast(
          `Order Confirmed • #${order.token}`,
          `Booked ${rangeText}.`,
          'success',
          4600
        );

        document.getElementById('live-order-tracker')?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      } catch (err) {
        if (err.code === 'TABLE_TAKEN' || err.code === 'TABLE_DURATION_CONFLICT') {
          state.selectedTableNumber = null;
          state.isTableMapOpen = true;
          await syncAllData();
          showToast(
            err.code === 'TABLE_DURATION_CONFLICT' ? 'Time Window Conflict' : 'Table Just Booked',
            err.message,
            'warning'
          );
        } else if (err.code === 'SLOT_FULL' || err.code === 'TABLES_FULL') {
          trySelectSlot(state.selectedSlotId, state.orderType);
        } else {
          showToast('Order Failed', err.message, 'error');
        }
      } finally {
        state.isSubmittingOrder = false;
        renderApp();
      }
      break;
    }

    case 'scroll-to-tracker': {
      document.getElementById('live-order-tracker')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      break;
    }

    case 'dismiss-ready-banner': {
      const id = actionEl.dataset.orderId;
      if (id && !state.dismissedReadyIds.includes(id)) {
        state.dismissedReadyIds.push(id);
        renderApp();
      }
      break;
    }

    case 'collect-order': {
      const orderId = actionEl.dataset.orderId;
      await apiClient.updateOrderStatus(orderId, 'COLLECTED');
      await syncAllData();
      showToast('Order Picked Up', 'Enjoy your meal!', 'success');
      break;
    }

    case 'set-kds-batch-slot': {
      state.kdsBatchSlot = actionEl.dataset.slotId || 'all';
      renderApp();
      break;
    }

    case 'update-order-status': {
      const orderId = actionEl.dataset.orderId;
      const nextStatus = actionEl.dataset.status;
      const updated = await apiClient.updateOrderStatus(orderId, nextStatus);
      if (nextStatus === 'READY' && updated.studentId === CURRENT_STUDENT_ID) {
        state.dismissedReadyIds = state.dismissedReadyIds.filter((id) => id !== updated.id);
      }
      await syncAllData();
      showToast(
        `Ticket #${updated.token} → ${nextStatus}`,
        nextStatus === 'READY'
          ? 'Student Live Status & Order Ready alert updated!'
          : nextStatus === 'COLLECTED'
          ? 'Marked Picked Up.'
          : 'Kitchen ticket updated.',
        nextStatus === 'READY' || nextStatus === 'COLLECTED' ? 'success' : 'info'
      );
      break;
    }

    case 'toggle-stock': {
      const itemId = actionEl.dataset.itemId;
      const nextVal = actionEl.dataset.nextVal === 'true';
      const updated = await apiClient.toggleItemStock(itemId, { inStock: nextVal });
      await syncAllData();
      showToast(
        updated.name,
        updated.inStock ? 'Marked In Stock on Student Menu' : 'Marked Out of Stock (Overlay active)',
        updated.inStock ? 'success' : 'warning'
      );
      break;
    }

    case 'toggle-new-flag': {
      const itemId = actionEl.dataset.itemId;
      const nextVal = actionEl.dataset.nextVal === 'true';
      const updated = await apiClient.toggleItemStock(itemId, { isNew: nextVal });
      await syncAllData();
      showToast(
        updated.name,
        updated.isNew ? 'Featured with NEW ribbon & New Updates tab' : 'Removed NEW ribbon',
        'info'
      );
      break;
    }

    case 'set-manager-tab': {
      state.managerTab = actionEl.dataset.tab || 'all';
      renderApp();
      break;
    }

    case 'apply-smart-rec': {
      const rec = {
        id: actionEl.dataset.recId,
        title: actionEl.dataset.recTitle,
        itemName: actionEl.dataset.itemName,
        deltaQty: Number(actionEl.dataset.deltaQty) || 12,
        slotId: actionEl.dataset.slotId || '12:30',
        note: actionEl.dataset.recNote
      };
      const applied = await apiClient.applyPrepRecommendation(rec);
      await syncAllData();
      showToast(
        'Smart Batch Prep Applied',
        `${applied.deltaQty > 0 ? '+' : ''}${applied.deltaQty}× ${applied.itemName} pushed to Kitchen KDS (${applied.slotId}).`,
        'success'
      );
      break;
    }

    default:
      break;
  }
});

document.addEventListener('input', (event) => {
  const action = event.target.dataset.action;

  if (action === 'input-nlp') {
    state.nlpQuery = event.target.value;
    const clearBtn = document.getElementById('nlp-clear-btn');
    if (clearBtn) {
      clearBtn.hidden = !state.nlpQuery;
    }
    const previewMount = document.getElementById('nlp-preview-mount');
    if (previewMount) {
      previewMount.innerHTML = renderNlpLivePreview(state.nlpQuery, state.menu, state.slots);
    }
  } else if (action === 'update-student-name') {
    state.studentName = event.target.value;
  } else if (action === 'input-staff-pin') {
    state.staffLoginPin = event.target.value;
    state.staffLoginError = null;
  }
});

document.addEventListener('change', (event) => {
  const action = event.target.dataset.action;

  if (action === 'change-order-type-select') {
    state.orderType = event.target.value;
    ensureValidSelectedSlot();
    enforceDurationForSlot(state.selectedSlotId);
    renderApp();
  } else if (action === 'change-slot-select') {
    trySelectSlot(event.target.value, state.orderType);
    enforceDurationForSlot(state.selectedSlotId);
    renderApp();
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  const action = form.dataset.action;
  if (!action) return;
  event.preventDefault();

  if (action === 'submit-nlp') {
    handleNlpSubmit();
  } else if (action === 'submit-staff-login') {
    const fd = new FormData(form);
    const pin = String(fd.get('pin') || state.staffLoginPin || '').trim();

    try {
      const session = await apiClient.authenticateStaff({
        pin,
        role: state.staffLoginRole
      });
      state.staffSession = session;
      state.staffLoginPin = '';
      state.staffLoginError = null;
      renderApp();
      showToast(
        'Staff Portal Unlocked',
        `Signed in as ${session.role === 'manager' ? 'Canteen Manager' : 'Kitchen Staff (KDS)'}.`,
        'success'
      );
    } catch (err) {
      state.staffLoginError = err.message;
      renderApp();
      document.getElementById('staff-pin-input')?.focus();
    }
  } else if (action === 'publish-menu-item') {
    const fd = new FormData(form);
    const created = await apiClient.addMenuItem({
      name: fd.get('name'),
      price: Number(fd.get('price')),
      isVeg: fd.get('isVeg') === 'true',
      calories: Number(fd.get('calories')),
      protein: Number(fd.get('protein')) || 12,
      isNew: fd.get('isNew') === 'on'
    });

    await syncAllData();
    showToast(
      `Published: ${created.name}`,
      'Now live in Student Menu & Plain-Language Order Parser!',
      'success'
    );
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.isTableMapOpen) {
      state.isTableMapOpen = false;
      renderApp();
    } else if (state.activeDishModalId) {
      state.activeDishModalId = null;
      renderApp();
    } else if (state.isCartOpen) {
      state.isCartOpen = false;
      renderApp();
    }
  }
});

window.addEventListener('hashchange', () => {
  state.route = resolveRouteFromHash();
  if (state.route === 'staff' && state.staffSession) {
    setApiUserRole(state.staffSession.role);
    renderApp();
  } else {
    setApiUserRole('student');
    syncAllData({ type: 'ROUTE_RETURN' });
  }
});

/* ==========================================================================
   Bootstrap Application
   ========================================================================== */

(async function init() {
  if (window.location.hostname === 'localhost') {
    console.info(
      '[CampusBite Sync] Running on localhost — keep both Student and #staff tabs on the exact same host (127.0.0.1:8080 or localhost:8080) so localStorage & BroadcastChannel stay shared.'
    );
  }

  if (state.route === 'staff' && state.staffSession) {
    setApiUserRole(state.staffSession.role);
  } else {
    setApiUserRole('student');
  }
  await syncAllData();
  apiClient.subscribeToUpdates((evt) => {
    syncAllData(evt);
  });
  apiClient.subscribeToOrderUpdates(null, (order, meta) => {
    if (order.studentId === CURRENT_STUDENT_ID && order.status === 'READY') {
      syncAllData(meta);
    }
  });

  // Live 1-second countdown tick for seated Dine-In Student Active Pass
  window.setInterval(() => {
    const countdownEls = document.querySelectorAll('[data-countdown-order-id]');
    if (!countdownEls.length) return;
    const now = Date.now();
    for (const el of countdownEls) {
      const ordId = el.dataset.countdownOrderId;
      const ord = state.orders.find((o) => o.id === ordId);
      if (!ord || ord.status !== 'READY') continue;
      el.textContent = `⏱ ${formatLiveTableCountdown(ord, now)}`;
    }
  }, 1000);
})();
