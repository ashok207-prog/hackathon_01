import { icon } from '../utils/icons.js';
import { getDishArt } from '../utils/foodArt.js';
import { renderTokenQR } from '../utils/qrGenerator.js';
import { parsePlainLanguageOrder } from '../utils/nlpOrderParser.js';
import {
  escapeHtml,
  formatLiveTableCountdown,
  formatRupees,
  formatTimeRange,
  getSlotStatusColor,
  isPeakSlot
} from '../utils/format.js';
import { renderDurationSelector } from '../components/DurationSelector.js';
import { CURRENT_STUDENT_ID, CANTEEN_TABLES } from '../data/mockSeed.js';

const EXAMPLE_PROMPTS = [
  '2 masala dosa and 1 cold coffee for 12:30 dine-in',
  '1 chicken tikka wrap, 2 masala chai at 12:40 takeaway'
];

export function renderNlpLivePreview(nlpQuery, menu, slots) {
  const slotIds = slots.map((s) => s.id);
  const liveParsed = nlpQuery.trim()
    ? parsePlainLanguageOrder(nlpQuery, menu, slotIds, slots)
    : null;

  if (!liveParsed) return '';

  return `
    <div class="nlp-live-preview" aria-live="polite">
      ${liveParsed.items
        .map(
          (entry) =>
            `<span class="parse-tag item">${icon('check', 12)} ${entry.quantity}× ${escapeHtml(entry.item.name)}</span>`
        )
        .join('')}
      ${liveParsed.outOfStockItems
        .map(
          (entry) =>
            `<span class="parse-tag warn">${icon('alert', 12)} ${escapeHtml(entry.item.name)} (Out of Stock)</span>`
        )
        .join('')}
      ${
        liveParsed.slotId
          ? `<span class="parse-tag slot">${icon('clock', 12)} ${escapeHtml(liveParsed.slotId)}</span>`
          : ''
      }
      ${
        liveParsed.orderType
          ? `<span class="parse-tag mode">${
              liveParsed.orderType === 'dine-in' ? 'Dine-In' : 'Takeaway'
            }</span>`
          : ''
      }
      ${
        liveParsed.durationMins
          ? `<span class="parse-tag slot">${icon('clock', 12)} ${liveParsed.durationMins} mins</span>`
          : ''
      }
      ${
        liveParsed.requestedUnsupportedTime
          ? `<span class="parse-tag warn">Use 12:20–12:50 slots</span>`
          : ''
      }
    </div>
  `;
}

function renderPlainLanguageHero(state) {
  const { nlpQuery, menu, slots, nlpFeedback } = state;

  return `
    <section class="nlp-hero" aria-label="Plain-Language Quick Ordering">
      <div class="nlp-top-row">
        <h2>${icon('sparkles', 19)} Order in plain English</h2>
        <span class="nlp-hint">Auto-fills tray, dine-in/takeaway &amp; slot</span>
      </div>

      <form class="nlp-form" data-action="submit-nlp">
        <div class="nlp-input-wrap">
          <span class="nlp-input-icon">${icon('sparkles', 16)}</span>
          <input
            type="text"
            id="nlp-order-input"
            class="nlp-input"
            value="${escapeHtml(nlpQuery)}"
            data-action="input-nlp"
            placeholder="Try: '2 masala dosa and 1 cold coffee for 12:30 dine-in'"
            autocomplete="off"
          />
          <button
            type="button"
            id="nlp-clear-btn"
            class="nlp-clear-btn"
            data-action="clear-nlp"
            aria-label="Clear prompt"
            ${nlpQuery ? '' : 'hidden'}
          >
            ${icon('close', 12)}
          </button>
        </div>
        <button type="submit" class="btn-nlp-submit">
          <span>Add Order</span>
        </button>
      </form>

      <div class="nlp-examples">
        <span class="nlp-examples-label">Try:</span>
        ${EXAMPLE_PROMPTS.map(
          (ex) => `
          <button
            type="button"
            class="nlp-chip"
            data-action="use-nlp-example"
            data-example="${escapeHtml(ex)}"
          >
            ${escapeHtml(ex)}
          </button>
        `
        ).join('')}
      </div>

      <div id="nlp-preview-mount">
        ${renderNlpLivePreview(nlpQuery, menu, slots)}
      </div>

      ${
        nlpFeedback
          ? `
        <div class="nlp-confirm-banner ${nlpFeedback.hasWarning ? 'has-warning' : ''}" role="status">
          <span>${escapeHtml(nlpFeedback.message)}</span>
          <button
            type="button"
            class="btn-ready-dismiss"
            style="padding:4px 10px;"
            data-action="open-cart"
          >
            View Tray
          </button>
        </div>
      `
          : ''
      }
    </section>
  `;
}

function renderMenuSection(state) {
  const { menu, menuFilter, cart } = state;

  const newCount = menu.filter((m) => m.isNew).length;
  const filteredMenu = menu.filter((item) => {
    if (menuFilter === 'veg') return item.isVeg;
    if (menuFilter === 'non-veg') return !item.isVeg;
    if (menuFilter === 'new') return item.isNew;
    if (menuFilter === 'snacks') return item.category === 'Snacks' || item.category === 'Quick Bites';
    if (menuFilter === 'burgers') return item.category === 'Burgers';
    if (menuFilter === 'beverages') return item.category === 'Beverages';
    if (menuFilter === 'desserts') return item.category === 'Desserts';
    return true;
  });

  return `
    <section aria-label="Canteen Menu">
      <div class="section-header">
        <h3 class="section-title">Menu</h3>

        <div class="filter-pills" role="tablist" aria-label="Menu Filters">
          <button
            type="button"
            class="filter-pill ${menuFilter === 'all' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="all"
          >
            All
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'veg' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="veg"
          >
            <span class="diet-indicator veg"></span>
            <span>Veg</span>
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'non-veg' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="non-veg"
          >
            <span class="diet-indicator non-veg"></span>
            <span>Non-Veg</span>
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'new' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="new"
          >
            ${icon('sparkles', 13)}
            <span>New Updates</span>
            ${newCount > 0 ? `<span class="role-badge">${newCount}</span>` : ''}
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'snacks' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="snacks"
          >
            <span>🍟 Snacks</span>
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'burgers' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="burgers"
          >
            <span>🍔 Burgers</span>
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'beverages' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="beverages"
          >
            <span>🥤 Beverages</span>
          </button>
          <button
            type="button"
            class="filter-pill ${menuFilter === 'desserts' ? 'active' : ''}"
            data-action="set-menu-filter"
            data-filter="desserts"
          >
            <span>🍨 Ice Cream</span>
          </button>
        </div>
      </div>

      ${
        filteredMenu.length === 0
          ? `<div class="panel-card empty-state">No dishes match this filter right now.</div>`
          : `
        <div class="menu-grid">
          ${filteredMenu
            .map((dish) => {
              const cartLine = cart.find((c) => c.itemId === dish.id);
              const qty = cartLine ? cartLine.qty : 0;

              return `
              <article class="menu-card ${qty > 0 ? 'in-cart' : ''} ${
                !dish.inStock ? 'is-out-of-stock' : ''
              }">
                ${dish.isNew ? '<span class="new-ribbon">NEW</span>' : ''}

                ${
                  !dish.inStock
                    ? `
                  <div class="out-of-stock-overlay">
                    <span class="oos-badge">Out of Stock</span>
                  </div>
                `
                    : ''
                }

                <div
                  class="menu-card-media"
                  data-action="open-dish-modal"
                  data-item-id="${escapeHtml(dish.id)}"
                  title="View full nutrition & details"
                >
                  ${getDishArt(dish.artKey, dish.isVeg, dish.name, dish.image)}
                  <span class="rating-pill">
                    <span>${dish.rating.toFixed(1)}</span>
                    <span class="star">★</span>
                  </span>
                </div>

                <div class="menu-title-row">
                  <span class="diet-indicator ${dish.isVeg ? 'veg' : 'non-veg'}" title="${
                    dish.isVeg ? 'Veg' : 'Non-Veg'
                  }"></span>
                  <h4 class="menu-dish-name">${escapeHtml(dish.name)}</h4>
                </div>

                <button
                  type="button"
                  class="nutrition-badge"
                  data-action="open-dish-modal"
                  data-item-id="${escapeHtml(dish.id)}"
                >
                  ${escapeHtml(dish.nutritionBadge || `${dish.calories} kcal • ${dish.protein}g protein`)}
                </button>

                <div class="menu-card-footer">
                  <span class="menu-price">${formatRupees(dish.price)}</span>

                  ${
                    qty > 0 && dish.inStock
                      ? `
                    <div class="qty-stepper">
                      <button type="button" data-action="dec-cart" data-item-id="${escapeHtml(dish.id)}" aria-label="Remove one">−</button>
                      <span>${qty}</span>
                      <button type="button" data-action="inc-cart" data-item-id="${escapeHtml(dish.id)}" aria-label="Add one more">+</button>
                    </div>
                  `
                      : `
                    <button
                      type="button"
                      class="btn-add-item"
                      data-action="add-to-cart"
                      data-item-id="${escapeHtml(dish.id)}"
                      ${!dish.inStock ? 'disabled' : ''}
                    >
                      Add +
                    </button>
                  `
                  }
                </div>
              </article>
            `;
            })
            .join('')}
        </div>
      `
      }
    </section>
  `;
}

function renderSlotSelectorPanel(state) {
  const {
    slots,
    orders = [],
    selectedSlotId,
    selectedTableNumber,
    selectedDurationMins = 30,
    orderType,
    slotSuggestion,
    flashSlotId,
    shakeSlotId,
    cart,
    menu
  } = state;

  const activeSlotObj = slots.find((s) => s.id === selectedSlotId);
  const freeTablesCount = activeSlotObj
    ? Math.max(
        0,
        activeSlotObj.maxDineInTables -
          (activeSlotObj.bookedTableNumbers?.length ?? activeSlotObj.dineInTablesCount)
      )
    : 10;
  const chosenTableObj =
    orderType === 'dine-in' && selectedTableNumber
      ? CANTEEN_TABLES.find((t) => t.number === Number(selectedTableNumber))
      : null;

  const cartQty = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => {
    const item = menu.find((m) => m.id === l.itemId);
    return s + (item ? item.price * l.qty : 0);
  }, 0);

  return `
    <section class="panel-card" id="slot-selector-panel" aria-label="Pickup and Table Slots">
      <div class="panel-title-row">
        <h3>${icon('clock', 17)} Pickup &amp; Table Slot</h3>
      </div>

      <div class="mode-toggle" role="group" aria-label="Order Mode">
        <button
          type="button"
          class="mode-btn ${orderType === 'takeaway' ? 'active' : ''}"
          data-action="set-order-type"
          data-order-type="takeaway"
        >
          ${icon('bag', 14)}
          <span>Takeaway</span>
        </button>
        <button
          type="button"
          class="mode-btn ${orderType === 'dine-in' ? 'active' : ''}"
          data-action="set-order-type"
          data-order-type="dine-in"
        >
          ${icon('table', 14)}
          <span>Dine-In</span>
        </button>
      </div>

      ${
        slotSuggestion
          ? `
        <div class="slot-suggestion-banner" role="alert">
          <span>${icon('alert', 15)}</span>
          <span>${escapeHtml(slotSuggestion.message)}</span>
        </div>
      `
          : ''
      }

      <div class="slot-grid">
        ${slots
          .map((slot) => {
            const effectiveCount =
              orderType === 'dine-in'
                ? Math.max(slot.foodOrdersCount, slot.dineInTablesCount)
                : slot.foodOrdersCount;
            const maxCap =
              orderType === 'dine-in' ? slot.maxDineInTables : slot.maxFoodOrders;
            const isFull = effectiveCount >= maxCap;
            const color = getSlotStatusColor(effectiveCount, maxCap);
            const pct = Math.min(100, Math.round((effectiveCount / maxCap) * 100));
            const isSelected = slot.id === selectedSlotId && !isFull;
            const isSuggested = slotSuggestion && slotSuggestion.suggestedSlotId === slot.id;

            const capWord = isFull
              ? 'Full'
              : effectiveCount >= 8
              ? 'Filling Fast'
              : 'Open';

            return `
            <button
              type="button"
              class="slot-card ${isSelected ? 'selected' : ''} ${
                isFull ? 'slot-full' : ''
              } ${isSuggested ? 'suggested-glow' : ''} ${
                flashSlotId === slot.id ? 'flash-highlight' : ''
              } ${shakeSlotId === slot.id ? 'shake-denied' : ''}"
              data-action="select-slot"
              data-slot-id="${escapeHtml(slot.id)}"
              aria-pressed="${isSelected}"
            >
              <div class="slot-top">
                <span class="slot-clock">${escapeHtml(slot.id)}</span>
                <span class="slot-cap-text ${color}">${effectiveCount}/${maxCap}</span>
              </div>

              <div class="progress-track">
                <div class="progress-fill ${color}" style="width:${pct}%"></div>
              </div>

              <div class="slot-sub-meta">
                <span>${capWord} • ${
                  orderType === 'dine-in'
                    ? `Tables ${slot.dineInTablesCount}/10`
                    : `${10 - effectiveCount} left`
                }</span>
                ${
                  isPeakSlot(slot, slots)
                    ? `<span class="peak-cap-badge">⚡ Peak (15m Cap)</span>`
                    : ''
                }
              </div>
            </button>
          `;
          })
          .join('')}
      </div>

      <button
        type="button"
        class="btn-table-map-trigger"
        data-action="open-table-map"
      >
        <span>${icon('table', 14)} Check Table Availability</span>
        <span class="table-trigger-badge">${freeTablesCount}/10 Free</span>
      </button>

      ${
        orderType === 'dine-in'
          ? renderDurationSelector({
              slots,
              orders,
              selectedSlotId,
              selectedDurationMins,
              selectedTableNumber
            })
          : ''
      }

      ${
        chosenTableObj
          ? `
        <div class="selected-table-chip">
          <span>${icon('checkCircle', 14)} Reserved: <strong>${escapeHtml(
              chosenTableObj.id
            )} (${escapeHtml(chosenTableObj.label)})</strong> • ${escapeHtml(
              formatTimeRange(selectedSlotId, selectedDurationMins).compactRange
            )} (${selectedDurationMins}m)</span>
          <button type="button" class="chip-change-btn" data-action="open-table-map">Change</button>
        </div>
      `
          : ''
      }

      ${
        cartQty > 0
          ? `
        <button
          type="button"
          class="btn-primary-full"
          style="margin-top:14px;"
          data-action="open-cart"
        >
          Checkout (${cartQty} items • ${formatRupees(cartTotal)})
        </button>
      `
          : ''
      }
    </section>
  `;
}

function renderLiveOrderTracker(state) {
  const myOrders = state.orders.filter(
    (o) => o.studentId === CURRENT_STUDENT_ID && o.status !== 'COLLECTED'
  );

  if (myOrders.length === 0) {
    return `
      <section class="panel-card" id="live-order-tracker">
        <div class="panel-title-row" style="margin-bottom:4px;">
          <h3>Live Order</h3>
        </div>
        <div class="empty-state" style="padding:10px 4px;">
          Your 4-digit Pickup Token, QR pass &amp; live status will appear here.
        </div>
      </section>
    `;
  }

  // Prioritize any order that is READY so its token, QR & 100% emerald progress spotlight immediately
  const order = myOrders.find((o) => o.status === 'READY') || myOrders[0];
  const stepIndex = order.status === 'READY' ? 2 : order.status === 'PREPARING' ? 1 : 0;
  const isReady = order.status === 'READY';
  const itemsSummary = order.items.map((i) => `${i.qty}× ${i.name}`).join(', ');
  const dineInDuration = Math.max(10, Number(order.durationMins) || 30);
  const dineInRange =
    order.orderType === 'dine-in'
      ? formatTimeRange(order.slotId, dineInDuration)
      : null;

  return `
    <section
      id="live-order-tracker"
      data-active-order-id="${escapeHtml(order.id)}"
      data-active-token="${escapeHtml(order.token)}"
    >
      <div class="live-order-card ${isReady ? 'is-ready' : ''}">
        <div class="panel-title-row" style="margin-bottom:0;">
          <h3>${isReady ? 'Ready for Pickup!' : 'Active Order'}</h3>
          <span class="slot-status-pill ${isReady ? 'green is-ready-pill' : 'amber'}">
            ${isReady ? 'READY' : order.status === 'PREPARING' ? 'Preparing' : 'Placed'}
          </span>
        </div>

        <div class="token-qr-row">
          <div>
            <div class="token-code">#${escapeHtml(order.token)}</div>
            <div class="token-tags">
              <span class="mini-tag">${escapeHtml(order.slotId)}</span>
              <span class="mini-tag ${order.orderType === 'dine-in' ? 'dine-in' : 'takeaway'}">
                ${
                  order.orderType === 'dine-in'
                    ? `Table T${order.tableNumber || 1} • ${escapeHtml(
                        dineInRange.compactRange
                      )} (${dineInDuration}m)`
                    : 'Takeaway'
                }
              </span>
              ${
                order.orderType === 'dine-in'
                  ? `<span class="table-countdown-pill ${
                      isReady ? 'is-live' : ''
                    }" data-countdown-order-id="${escapeHtml(order.id)}">${
                      isReady ? '⏱ ' : ''
                    }${escapeHtml(formatLiveTableCountdown(order))}</span>`
                  : ''
              }
            </div>
          </div>
          <div class="qr-box">${renderTokenQR(`${order.id}-${order.token}`)}</div>
        </div>

        <div class="order-stepper" aria-label="Order progress">
          <div class="step-node ${stepIndex > 0 ? 'done' : 'current'}">
            <div class="step-bar-seg"></div>
            <div class="step-label">Order Placed</div>
          </div>
          <div class="step-node ${stepIndex > 1 ? 'done' : stepIndex === 1 ? 'current' : ''}">
            <div class="step-bar-seg"></div>
            <div class="step-label">Preparing</div>
          </div>
          <div class="step-node ${isReady ? 'ready-current' : ''}">
            <div class="step-bar-seg"></div>
            <div class="step-label">Ready for Pickup</div>
          </div>
        </div>

        <div class="order-items-summary">
          <span>${escapeHtml(itemsSummary)}</span>
          <strong>${formatRupees(order.totalAmount)}</strong>
        </div>

        ${
          isReady
            ? `
          <button
            type="button"
            class="btn-ready-cta"
            style="width:100%;padding:9px;"
            data-action="collect-order"
            data-order-id="${escapeHtml(order.id)}"
          >
            Mark Collected
          </button>
        `
            : ''
        }
      </div>
    </section>
  `;
}

export function renderStudentView(state) {
  const cartQty = state.cart.reduce((sum, l) => sum + l.qty, 0);
  const cartTotal = state.cart.reduce((sum, l) => {
    const item = state.menu.find((m) => m.id === l.itemId);
    return sum + (item ? item.price * l.qty : 0);
  }, 0);

  return `
    <div class="student-layout view-enter">
      ${renderPlainLanguageHero(state)}

      <div class="student-workspace">
        <div>${renderMenuSection(state)}</div>

        <aside class="student-sidebar">
          ${renderSlotSelectorPanel(state)}
          ${renderLiveOrderTracker(state)}
        </aside>
      </div>

      ${
        cartQty > 0
          ? `
        <button type="button" class="mobile-cart-bar" data-action="open-cart">
          <span style="font-weight:800;">${cartQty} item${cartQty > 1 ? 's' : ''} • ${escapeHtml(state.selectedSlotId)}</span>
          <span style="font-weight:800;color:var(--gold-cta);">Checkout ${formatRupees(cartTotal)} →</span>
        </button>
      `
          : ''
      }
    </div>
  `;
}
