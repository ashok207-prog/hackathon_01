/**
 * Formatting and safe HTML escaping utilities.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatRupees(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

export function getSlotStatusColor(count, max = 10) {
  if (count >= max) return 'red';
  if (count >= 8) return 'amber';
  return 'green';
}

export function getSlotStatusLabel(count, max = 10) {
  if (count >= max) return 'Full • Locked';
  const left = max - count;
  if (count >= 8) return `Filling Fast • ${left} left`;
  return `Open • ${left} left`;
}

export const DINING_DURATIONS = [
  { mins: 15, label: '15 mins', tag: 'Quick Bite' },
  { mins: 30, label: '30 mins', tag: 'Standard Meal' },
  { mins: 45, label: '45 mins', tag: 'Group Lunch' },
  { mins: 60, label: '60 mins', tag: 'Study / Long Break' }
];

export const PEAK_SLOT_IDS = ['12:30', '12:40'];
export const PEAK_MAX_DURATION_MINS = 15;
export const PEAK_CAPACITY_THRESHOLD = 0.7;

/**
 * Returns true when a slot is a designated Peak Rush Window (12:30, 12:40)
 * OR dynamically reaches >= 70% capacity (7+ of 10 orders/tables).
 */
export function isPeakSlot(slotOrId, slots = []) {
  const slotObj =
    typeof slotOrId === 'object' && slotOrId !== null
      ? slotOrId
      : (slots || []).find((s) => s.id === slotOrId);
  const slotId = typeof slotOrId === 'string' ? slotOrId : slotObj?.id;

  if (slotId && PEAK_SLOT_IDS.includes(slotId)) return true;
  if (!slotObj) return false;

  const foodRatio = (slotObj.foodOrdersCount || 0) / Math.max(1, slotObj.maxFoodOrders || 10);
  const tableRatio = (slotObj.dineInTablesCount || 0) / Math.max(1, slotObj.maxDineInTables || 10);
  return Math.max(foodRatio, tableRatio) >= PEAK_CAPACITY_THRESHOLD;
}

export function getMaxDurationForSlot(slotOrId, slots = []) {
  return isPeakSlot(slotOrId, slots) ? PEAK_MAX_DURATION_MINS : 60;
}

export function getDefaultDurationForSlot(slotOrId, slots = []) {
  return isPeakSlot(slotOrId, slots) ? PEAK_MAX_DURATION_MINS : 30;
}

/**
 * Parses a slot time string like "12:30" into minutes since midnight (750).
 * Supports afternoon 1:00-6:59 as PM (13:00-18:59) if ever extended past noon.
 */
export function slotIdToMinutes(slotId) {
  const match = String(slotId || '12:30').match(/(\d{1,2}):(\d{2})/);
  if (!match) return 750;
  let hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  if (hours >= 1 && hours <= 7) hours += 12;
  return hours * 60 + mins;
}

/**
 * Formats minutes since midnight into concise 12-hour clock text ("1:00 PM").
 */
export function formatMinutesTo12h(totalMinutes, includeMeridiem = true) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(m).padStart(2, '0');
  return includeMeridiem ? `${h12}:${mm} ${meridiem}` : `${h12}:${mm}`;
}

/**
 * Computes formatted reservation window strings for a start slot & duration.
 * e.g. ("12:30", 30) -> { compactRange: "12:30 – 1:00 PM", fullRange: "12:30 PM – 1:00 PM", ... }
 */
export function formatTimeRange(slotId, durationMins = 30) {
  const startMins = slotIdToMinutes(slotId);
  const safeDuration = Math.max(10, Number(durationMins) || 30);
  const endMins = startMins + safeDuration;
  const startMeridiem = startMins >= 720 ? 'PM' : 'AM';
  const endMeridiem = endMins >= 720 ? 'PM' : 'AM';

  const startShort = formatMinutesTo12h(startMins, false);
  const startFull = formatMinutesTo12h(startMins, true);
  const endFull = formatMinutesTo12h(endMins, true);

  const compactRange =
    startMeridiem === endMeridiem
      ? `${startShort} – ${endFull}`
      : `${startFull} – ${endFull}`;

  return {
    startMins,
    endMins,
    durationMins: safeDuration,
    startLabel: startFull,
    endLabel: endFull,
    compactRange,
    fullRange: `${startFull} – ${endFull}`
  };
}

export function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

/**
 * Evaluates all 10 canteen tables against active Dine-In orders for a target slot
 * and requested stay duration, including multi-slot carry-over locks and future conflicts.
 */
export function computeTablesAvailability(orders = [], tables = [], slotId = '12:30', durationMins = 30) {
  const slotStart = slotIdToMinutes(slotId);
  const slotWindowEnd = slotStart + 10;
  const requestedEnd = slotStart + Math.max(10, Number(durationMins) || 30);

  const activeDineIn = (orders || []).filter(
    (ord) => ord.status !== 'CANCELLED' && ord.orderType === 'dine-in'
  );

  // Map simulated unnumbered dine-in bookings deterministically per slot if any exist
  const normalizedOrders = activeDineIn.map((ord) => {
    const start = slotIdToMinutes(ord.slotId);
    const dur = Math.max(10, Number(ord.durationMins) || 30);
    return {
      ...ord,
      startMins: start,
      endMins: start + dur,
      durationMins: dur
    };
  });

  return tables.map((tbl) => {
    const tableOrders = normalizedOrders.filter((ord) => Number(ord.tableNumber) === tbl.number);

    // 1. Direct overlap with the 10-min slot window itself -> table is Booked / Occupied right now
    const occupyingOrder = tableOrders.find((ord) =>
      intervalsOverlap(slotStart, slotWindowEnd, ord.startMins, ord.endMins)
    );

    // 2. Future overlap inside requested duration (table is free at slotStart, booked later during stay)
    const futureConflicts = tableOrders
      .filter(
        (ord) =>
          ord.startMins >= slotWindowEnd &&
          intervalsOverlap(slotStart, requestedEnd, ord.startMins, ord.endMins)
      )
      .sort((a, b) => a.startMins - b.startMins);

    const nextConflict = futureConflicts[0] || null;
    const anyFutureForTable = tableOrders
      .filter((ord) => ord.startMins >= slotWindowEnd)
      .sort((a, b) => a.startMins - b.startMins)[0];

    const maxAllowedDurationMins = anyFutureForTable
      ? Math.max(0, anyFutureForTable.startMins - slotStart)
      : 60;

    return {
      ...tbl,
      isBooked: Boolean(occupyingOrder),
      occupyingOrder: occupyingOrder || null,
      bookedRange: occupyingOrder
        ? formatTimeRange(occupyingOrder.slotId, occupyingOrder.durationMins).compactRange
        : null,
      hasConflict: !occupyingOrder && Boolean(nextConflict),
      conflictAt: nextConflict ? nextConflict.slotId : null,
      nextBookingAt: anyFutureForTable ? anyFutureForTable.slotId : null,
      maxAllowedDurationMins
    };
  });
}

/**
 * Formats live countdown timer badge text for seated/active Student Dine-In pass.
 */
export function formatLiveTableCountdown(order, nowMs = Date.now()) {
  if (!order || order.orderType !== 'dine-in') return '';
  const durationMins = Math.max(10, Number(order.durationMins) || 30);

  if (order.status !== 'READY') {
    return `${durationMins}m reserved`;
  }

  const seatedMs = order.seatedAt ? new Date(order.seatedAt).getTime() : nowMs;
  const endMs = seatedMs + durationMins * 60 * 1000;
  const remainingSec = Math.max(0, Math.floor((endMs - nowMs) / 1000));

  if (remainingSec <= 0) return 'Session Ended';
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  return `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s left`;
}

