import { CANTEEN_TABLES } from '../data/mockSeed.js';
import {
  DINING_DURATIONS,
  PEAK_MAX_DURATION_MINS,
  computeTablesAvailability,
  escapeHtml,
  formatTimeRange,
  isPeakSlot
} from '../utils/format.js';
import { icon } from '../utils/icons.js';

/**
 * Reusable Dine-In Duration Selector with real-time Reserved Window preview,
 * Peak-Hour 15-min cap enforcement, and multi-slot table overlap conflict disabling.
 */
export function renderDurationSelector({
  slots = [],
  orders = [],
  selectedSlotId = '12:30',
  selectedDurationMins = 30,
  selectedTableNumber = null,
  compact = false
}) {
  const slotIsPeak = isPeakSlot(selectedSlotId, slots);
  const safeDuration = slotIsPeak
    ? Math.min(PEAK_MAX_DURATION_MINS, Number(selectedDurationMins) || PEAK_MAX_DURATION_MINS)
    : Number(selectedDurationMins) || 30;
  const range = formatTimeRange(selectedSlotId, safeDuration);

  // Evaluate table constraints for the selected slot
  const baseAvailability = computeTablesAvailability(orders, CANTEEN_TABLES, selectedSlotId, safeDuration);
  const chosenTableInfo = selectedTableNumber
    ? baseAvailability.find((t) => t.number === Number(selectedTableNumber))
    : null;

  let conflictNotice = null;

  const pillsHtml = DINING_DURATIONS.map((opt) => {
    const isPeakLocked = slotIsPeak && opt.mins > PEAK_MAX_DURATION_MINS;
    const isTableConflictLocked =
      !isPeakLocked &&
      chosenTableInfo &&
      chosenTableInfo.nextBookingAt &&
      opt.mins > chosenTableInfo.maxAllowedDurationMins;

    let isAnyTableConflictLocked = false;
    if (!isPeakLocked && !chosenTableInfo) {
      const checkForOpt = computeTablesAvailability(orders, CANTEEN_TABLES, selectedSlotId, opt.mins);
      const anyCompletelyOpen = checkForOpt.some((t) => !t.isBooked && !t.hasConflict);
      if (!anyCompletelyOpen && checkForOpt.some((t) => !t.isBooked)) {
        isAnyTableConflictLocked = true;
      }
    }

    const isDisabled = Boolean(isPeakLocked || isTableConflictLocked || isAnyTableConflictLocked);
    const isSelected = opt.mins === safeDuration && !isDisabled;

    let tooltip = `${opt.label} (${opt.tag})`;
    if (isPeakLocked) {
      tooltip = `Capped at ${PEAK_MAX_DURATION_MINS} mins during Peak Rush Hour (${selectedSlotId})`;
    } else if (isTableConflictLocked) {
      tooltip = `Next slot booked at ${chosenTableInfo.nextBookingAt}`;
      conflictNotice = `Table ${chosenTableInfo.id} has a booking at ${chosenTableInfo.nextBookingAt} (max ${chosenTableInfo.maxAllowedDurationMins} mins).`;
    } else if (isAnyTableConflictLocked) {
      tooltip = 'No free tables remain open for full duration';
    }

    return `
      <button
        type="button"
        class="duration-pill ${isSelected ? 'active' : ''} ${isDisabled ? 'is-disabled' : ''} ${
          isPeakLocked ? 'is-peak-locked' : ''
        }"
        data-action="select-duration"
        data-duration-mins="${opt.mins}"
        title="${escapeHtml(tooltip)}"
        aria-pressed="${isSelected}"
        ${isDisabled ? 'disabled' : ''}
      >
        <span class="dur-top-line">
          <span class="dur-mins">${escapeHtml(opt.label)}</span>
          ${isDisabled ? `<span class="dur-lock-icon">${icon('lock', 11)}</span>` : ''}
        </span>
        ${!compact ? `<span class="dur-tag">${escapeHtml(opt.tag)}</span>` : ''}
        ${
          isPeakLocked
            ? `<span class="dur-lock-note">Peak Cap</span>`
            : isTableConflictLocked
            ? `<span class="dur-lock-note">Booked @ ${escapeHtml(chosenTableInfo.nextBookingAt)}</span>`
            : ''
        }
      </button>
    `;
  }).join('');

  return `
    <div class="duration-selector-box ${compact ? 'is-compact' : ''} ${slotIsPeak ? 'is-peak-active' : ''}" aria-label="Dining Duration Selector">
      <div class="duration-box-head">
        <span class="duration-box-title">
          ${icon('clock', 13)} Dining Duration
          ${slotIsPeak ? `<span class="peak-cap-badge">⚡ Peak (15m Cap)</span>` : ''}
        </span>
        <span class="duration-box-sub">${chosenTableInfo ? escapeHtml(chosenTableInfo.id) : 'All Open Tables'}</span>
      </div>

      <div class="duration-pills-grid">
        ${pillsHtml}
      </div>

      <div class="reserved-window-preview" aria-live="polite">
        <span class="rw-label">Reserved Window:</span>
        <strong>${escapeHtml(range.fullRange)} (${safeDuration} mins)</strong>
      </div>

      ${
        slotIsPeak
          ? `
        <div class="peak-duration-notice" role="status">
          ⚡ <strong>Peak Rush Hour (12:30 – 12:50 PM):</strong> Table bookings are capped at 15 mins so everyone gets a seat between classes. Need longer? Pick <strong>12:20</strong> or <strong>12:50</strong>.
        </div>
      `
          : ''
      }

      ${
        !slotIsPeak && conflictNotice
          ? `<div class="duration-conflict-hint">${icon('alert', 12)} <span>${escapeHtml(conflictNotice)}</span></div>`
          : ''
      }
    </div>
  `;
}

