import { CANTEEN_TABLES } from '../data/mockSeed.js';
import { icon } from '../utils/icons.js';
import {
  PEAK_MAX_DURATION_MINS,
  computeTablesAvailability,
  escapeHtml,
  formatTimeRange,
  isPeakSlot
} from '../utils/format.js';
import { renderDurationSelector } from './DurationSelector.js';

/**
 * Top-down canteen dining pod graphic (1 table + 4 or 5 chair shapes).
 * Represents a whole group dining table rather than individual cinema seats.
 */
function renderTablePodSvg(seats) {
  if (seats >= 5) {
    // 5-Seater: 2 top chairs, 2 bottom chairs, 1 right-head chair
    return `
      <svg class="table-pod-svg" viewBox="0 0 112 72" aria-hidden="true">
        <rect x="26" y="4" width="22" height="9" rx="4.5" class="chair-shape" />
        <rect x="56" y="4" width="22" height="9" rx="4.5" class="chair-shape" />
        <rect x="16" y="17" width="70" height="38" rx="10" class="table-surface" />
        <rect x="92" y="25" width="9" height="22" rx="4.5" class="chair-shape" />
        <rect x="26" y="59" width="22" height="9" rx="4.5" class="chair-shape" />
        <rect x="56" y="59" width="22" height="9" rx="4.5" class="chair-shape" />
      </svg>
    `;
  }

  // 4-Seater: 2 top chairs, 2 bottom chairs
  return `
    <svg class="table-pod-svg" viewBox="0 0 104 72" aria-hidden="true">
      <rect x="20" y="4" width="24" height="9" rx="4.5" class="chair-shape" />
      <rect x="60" y="4" width="24" height="9" rx="4.5" class="chair-shape" />
      <rect x="14" y="17" width="76" height="38" rx="10" class="table-surface" />
      <rect x="20" y="59" width="24" height="9" rx="4.5" class="chair-shape" />
      <rect x="60" y="59" width="24" height="9" rx="4.5" class="chair-shape" />
    </svg>
  `;
}

function renderZoneRow(title, tables, availabilityByNum, selectedTableNumber) {
  const openCount = tables.filter((t) => !availabilityByNum.get(t.number)?.isBooked).length;

  return `
    <div class="floor-zone">
      <div class="floor-zone-head">
        <span>${escapeHtml(title)}</span>
        <span class="floor-zone-sub">${openCount}/${tables.length} open</span>
      </div>
      <div class="table-pods-row">
        ${tables
          .map((tbl) => {
            const info = availabilityByNum.get(tbl.number) || {};
            const isBooked = Boolean(info.isBooked);
            const hasConflict = Boolean(info.hasConflict);
            const isSelected = !isBooked && Number(selectedTableNumber) === tbl.number;
            const statusClass = isBooked
              ? 'is-booked'
              : isSelected
              ? 'is-selected'
              : hasConflict
              ? 'has-conflict'
              : 'is-available';

            const badgeLabel = isBooked
              ? info.bookedRange
                ? `Booked (${info.bookedRange.split('–')[1]?.trim() || 'Occupied'})`
                : 'Booked'
              : isSelected
              ? `${icon('check', 11)} Selected`
              : hasConflict
              ? `Next @ ${info.conflictAt}`
              : `Open (${tbl.seats} Seats)`;

            const titleAttr = isBooked
              ? `Booked ${info.bookedRange || ''}`
              : hasConflict
              ? `Next slot booked at ${info.conflictAt} (max ${info.maxAllowedDurationMins} mins)`
              : `Open (${tbl.seats} Seats)`;

            return `
              <button
                type="button"
                class="table-pod-card ${statusClass}"
                data-action="select-table"
                data-table-number="${tbl.number}"
                data-table-id="${escapeHtml(tbl.id)}"
                title="${escapeHtml(titleAttr)}"
                aria-pressed="${isSelected}"
                ${isBooked ? 'disabled' : ''}
              >
                <div class="table-pod-top">
                  <span class="table-pod-id">${escapeHtml(tbl.id)}</span>
                  <span class="table-pod-seats">${tbl.seats} Seats</span>
                </div>

                ${renderTablePodSvg(tbl.seats)}

                <div class="table-pod-badge ${statusClass}">
                  ${badgeLabel}
                </div>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function renderTableAvailabilityModal(state) {
  if (!state.isTableMapOpen) return '';

  const {
    slots,
    orders = [],
    selectedSlotId,
    selectedTableNumber,
    selectedDurationMins = 30,
    cart
  } = state;
  const activeSlot = slots.find((s) => s.id === selectedSlotId) || slots[0];
  if (!activeSlot) return '';

  const effectiveDurationMins = isPeakSlot(activeSlot, slots)
    ? Math.min(PEAK_MAX_DURATION_MINS, Number(selectedDurationMins) || PEAK_MAX_DURATION_MINS)
    : Number(selectedDurationMins) || 30;

  const availability = computeTablesAvailability(
    orders,
    CANTEEN_TABLES,
    activeSlot.id,
    effectiveDurationMins
  );
  const availabilityByNum = new Map(availability.map((t) => [t.number, t]));

  const bookedSet = new Set(activeSlot.bookedTableNumbers || []);
  for (const t of availability) {
    if (t.isBooked) bookedSet.add(t.number);
  }

  const windowTables = CANTEEN_TABLES.filter((t) => t.zone === 'Window Row');
  const mainHallTables = CANTEEN_TABLES.filter((t) => t.zone === 'Main Hall');
  const selectedTable = CANTEEN_TABLES.find(
    (t) => t.number === Number(selectedTableNumber) && !bookedSet.has(t.number)
  );
  const freeCount = Math.max(0, activeSlot.maxDineInTables - bookedSet.size);
  const rangeInfo = formatTimeRange(activeSlot.id, effectiveDurationMins);

  return `
    <div
      class="modal-backdrop"
      data-action="close-table-map"
      role="dialog"
      aria-modal="true"
      aria-label="Canteen Table Availability Map"
    >
      <div class="modal-card table-map-modal" data-stop-propagation="true">
        <div class="table-map-header">
          <div>
            <div class="table-map-eyebrow">${icon('table', 14)} Live Canteen Floor Plan</div>
            <h3>Choose Your Group Table</h3>
            <p>Multi-slot overlap locking keeps your table reserved across your entire dining duration.</p>
          </div>
          <button
            type="button"
            class="btn-icon-close"
            data-action="close-table-map"
            aria-label="Close Table Availability Map"
          >
            ${icon('close', 18)}
          </button>
        </div>

        <div class="table-map-slot-tabs" role="tablist" aria-label="Dining Time Slots">
          ${slots
            .map((slot) => {
              const slotAvail = computeTablesAvailability(
                orders,
                CANTEEN_TABLES,
                slot.id,
                selectedDurationMins
              );
              const occupiedCount = Math.max(
                slot.bookedTableNumbers?.length ?? slot.dineInTablesCount,
                slotAvail.filter((t) => t.isBooked).length
              );
              const slotFree = Math.max(0, slot.maxDineInTables - occupiedCount);
              const isSelected = slot.id === activeSlot.id;
              const isFull = slotFree === 0 || slot.isFoodFull;
              return `
                <button
                  type="button"
                  role="tab"
                  aria-selected="${isSelected}"
                  class="map-slot-pill ${isSelected ? 'active' : ''} ${isFull ? 'is-full' : ''}"
                  data-action="select-slot-in-map"
                  data-slot-id="${escapeHtml(slot.id)}"
                >
                  <span class="map-slot-time">${escapeHtml(slot.id)}</span>
                  <span class="map-slot-free">• ${slotFree}/${slot.maxDineInTables} Tables Free</span>
                </button>
              `;
            })
            .join('')}
        </div>

        ${renderDurationSelector({
          slots,
          orders,
          selectedSlotId: activeSlot.id,
          selectedDurationMins: effectiveDurationMins,
          selectedTableNumber,
          compact: true
        })}

        <div class="table-map-legend-row">
          <div class="counter-entry-bar">
            <span>🍽️ Pickup Counter &amp; Main Entry</span>
          </div>
          <div class="table-legend-pills">
            <span class="legend-item"><i class="leg-dot open"></i> Open</span>
            <span class="legend-item"><i class="leg-dot selected"></i> Selected</span>
            <span class="legend-item"><i class="leg-dot conflict"></i> Partial / Next Booked</span>
            <span class="legend-item"><i class="leg-dot booked"></i> Booked</span>
          </div>
        </div>

        <div class="table-map-zones">
          ${renderZoneRow('Window Row • 4-Seaters (T1–T5)', windowTables, availabilityByNum, selectedTableNumber)}
          ${renderZoneRow('Main Hall • 5-Seaters (T6–T10)', mainHallTables, availabilityByNum, selectedTableNumber)}
        </div>

        <div class="table-map-footer">
          <div class="table-map-status-note">
            ${
              selectedTable
                ? `<span class="reserved-confirm-text">${icon('checkCircle', 16)} Reserved: Table <strong>${escapeHtml(
                    selectedTable.id
                  )} (${escapeHtml(selectedTable.label)})</strong> • <strong>${escapeHtml(
                    rangeInfo.compactRange
                  )} (${rangeInfo.durationMins}m)</strong></span>`
                : freeCount === 0
                ? `<span class="reserved-warn-text">${icon('alert', 16)} All 10 tables are booked at ${escapeHtml(
                    activeSlot.id
                  )}. Switch to another time slot above.</span>`
                : `<span class="reserved-hint-text">Tap any emerald table above to reserve for <strong>${escapeHtml(
                    rangeInfo.compactRange
                  )}</strong> (${freeCount} open).</span>`
            }
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button
              type="button"
              class="btn-nlp-submit"
              style="padding:10px 18px;"
              data-action="confirm-table-map"
            >
              ${
                selectedTable
                  ? cart.length > 0
                    ? `Confirm ${escapeHtml(selectedTable.id)} & Checkout`
                    : `Confirm Table ${escapeHtml(selectedTable.id)}`
                  : 'Done'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

