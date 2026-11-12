import { icon } from '../utils/icons.js';
import { escapeHtml, formatRupees, formatTimeRange } from '../utils/format.js';
import { CANTEEN_TABLES } from '../data/mockSeed.js';
import { renderDurationSelector } from './DurationSelector.js';

export function renderCartDrawer(state) {
  const {
    isCartOpen,
    cart,
    menu,
    slots,
    orders = [],
    selectedSlotId,
    selectedTableNumber,
    selectedDurationMins = 30,
    orderType,
    studentName,
    isSubmittingOrder
  } = state;

  const lines = cart
    .map((line) => {
      const dish = menu.find((m) => m.id === line.itemId);
      return dish ? { ...line, dish } : null;
    })
    .filter(Boolean);

  const subtotal = lines.reduce((sum, l) => sum + l.dish.price * l.qty, 0);
  const totalKcal = lines.reduce((sum, l) => sum + l.dish.calories * l.qty, 0);
  const totalProtein = lines.reduce((sum, l) => sum + l.dish.protein * l.qty, 0);

  const activeSlot = slots.find((s) => s.id === selectedSlotId);
  const chosenTable =
    orderType === 'dine-in' && selectedTableNumber
      ? CANTEEN_TABLES.find((t) => t.number === Number(selectedTableNumber))
      : null;
  const isSlotBlocked =
    !activeSlot ||
    activeSlot.isFoodFull ||
    (orderType === 'dine-in' && activeSlot.isTablesFull);

  return `
    <div class="drawer-backdrop ${isCartOpen ? 'open' : ''}" data-action="close-cart"></div>
    <aside
      class="cart-drawer ${isCartOpen ? 'open' : ''}"
      role="dialog"
      aria-modal="true"
      aria-label="Your Pre-Order Cart"
    >
      <div class="drawer-header">
        <div>
          <h3>Your Pre-Order Tray</h3>
          <div style="font-size:0.78rem;color:var(--text-muted);font-weight:600;">
            ${lines.length ? `${totalKcal} kcal • ${totalProtein}g protein total` : 'Add dishes or use Plain-Language Order'}
          </div>
        </div>
        <button type="button" class="btn-icon-close" data-action="close-cart" aria-label="Close Cart">
          ${icon('close', 18)}
        </button>
      </div>

      <div class="drawer-body">
        ${
          lines.length === 0
            ? `
          <div class="empty-state">
            <div style="font-size:2rem;margin-bottom:8px;">🍽️</div>
            <strong>Your tray is empty</strong>
            <p style="margin:6px 0 0;">Try typing <em>"2 masala dosa and 1 cold coffee for 12:30 dine-in"</em> in the smart bar!</p>
          </div>
        `
            : `
          ${lines
            .map(
              ({ dish, qty }) => `
            <div class="cart-item-row">
              <div class="cart-item-info">
                <div class="cart-item-name" style="display:flex;align-items:center;gap:6px;">
                  <span class="diet-indicator ${dish.isVeg ? 'veg' : 'non-veg'}"></span>
                  <span>${escapeHtml(dish.name)}</span>
                </div>
                <div class="cart-item-price">
                  ${formatRupees(dish.price)} each • ${formatRupees(dish.price * qty)}
                </div>
                ${
                  !dish.inStock
                    ? `<div style="font-size:0.72rem;color:var(--crimson);font-weight:700;">Out of stock — remove to proceed</div>`
                    : ''
                }
              </div>
              <div class="qty-stepper">
                <button type="button" data-action="dec-cart" data-item-id="${escapeHtml(dish.id)}" aria-label="Decrease quantity">−</button>
                <span>${qty}</span>
                <button type="button" data-action="inc-cart" data-item-id="${escapeHtml(dish.id)}" aria-label="Increase quantity">+</button>
              </div>
            </div>
          `
            )
            .join('')}

          <div class="panel-card" style="padding:12px;background:rgba(255, 255, 255, 0.03);margin-top:4px;">
            <div class="form-field" style="margin-bottom:10px;">
              <label for="cart-student-name">Student Name / Roll</label>
              <input
                id="cart-student-name"
                type="text"
                class="form-input"
                value="${escapeHtml(studentName)}"
                data-action="update-student-name"
                placeholder="e.g. Aarav • CS-3B"
              />
            </div>

            <div class="form-row-2">
              <div class="form-field">
                <label>Order Mode</label>
                <select class="form-select" data-action="change-order-type-select">
                  <option value="takeaway" ${orderType === 'takeaway' ? 'selected' : ''}>Takeaway</option>
                  <option value="dine-in" ${orderType === 'dine-in' ? 'selected' : ''}>Dine-In (Table)</option>
                </select>
              </div>

              <div class="form-field">
                <label>Pickup Slot</label>
                <select class="form-select" data-action="change-slot-select">
                  ${slots
                    .map((slot) => {
                      const full =
                        slot.isFoodFull || (orderType === 'dine-in' && slot.isTablesFull);
                      const count =
                        orderType === 'dine-in'
                          ? Math.max(slot.foodOrdersCount, slot.dineInTablesCount)
                          : slot.foodOrdersCount;
                      return `<option value="${slot.id}" ${
                        slot.id === selectedSlotId ? 'selected' : ''
                      } ${full ? 'disabled' : ''}>${slot.id} (${count}/10)${
                        full ? ' FULL' : ''
                      }</option>`;
                    })
                    .join('')}
                </select>
              </div>
            </div>

            ${
              orderType === 'dine-in'
                ? `
              <div class="cart-table-picker">
                <div>
                  <div class="cart-table-lbl">Canteen Table</div>
                  <div class="cart-table-val">
                    ${
                      chosenTable
                        ? `${escapeHtml(chosenTable.id)} • ${escapeHtml(chosenTable.label)} (${escapeHtml(chosenTable.zone)})`
                        : 'Auto-assign open table'
                    }
                  </div>
                </div>
                <button type="button" class="btn-pick-table-inline" data-action="open-table-map">
                  ${icon('table', 13)}
                  <span>${chosenTable ? 'Change' : 'Pick Table'}</span>
                </button>
              </div>
              <div style="margin-top:10px;">
                ${renderDurationSelector({
                  slots,
                  orders,
                  selectedSlotId,
                  selectedDurationMins,
                  selectedTableNumber,
                  compact: true
                })}
              </div>
            `
                : ''
            }
          </div>
        `
        }
      </div>

      ${
        lines.length > 0
          ? `
        <div class="drawer-footer">
          <div class="summary-line">
            <span>Slot &amp; Mode</span>
            <span>${
              orderType === 'dine-in'
                ? `${escapeHtml(
                    formatTimeRange(selectedSlotId || '12:30', selectedDurationMins).compactRange
                  )} (${selectedDurationMins}m) • ${
                    chosenTable
                      ? `Dine-In (${escapeHtml(chosenTable.id)})`
                      : 'Dine-In Table Reserved'
                  }`
                : `${escapeHtml(selectedSlotId || 'None')} • Takeaway Counter`
            }</span>
          </div>
          <div class="summary-total">
            <span>Total Payable</span>
            <span>${formatRupees(subtotal)}</span>
          </div>
          <button
            type="button"
            class="btn-primary-full"
            data-action="place-order"
            ${isSubmittingOrder || isSlotBlocked || lines.some((l) => !l.dish.inStock) ? 'disabled style="opacity:0.55;cursor:not-allowed;"' : ''}
          >
            ${
              isSubmittingOrder
                ? 'Sending to Kitchen...'
                : isSlotBlocked
                ? 'Selected Slot Full — Choose Open Slot'
                : `Place Pre-Order • ${formatRupees(subtotal)}`
            }
          </button>
        </div>
      `
          : ''
      }
    </aside>
  `;
}

