import { icon } from '../utils/icons.js';
import { getDishArt } from '../utils/foodArt.js';
import {
  computeTablesAvailability,
  escapeHtml,
  formatRupees,
  formatTimeRange,
  getSlotStatusColor,
  isPeakSlot
} from '../utils/format.js';
import { CANTEEN_TABLES } from '../data/mockSeed.js';
import { renderManagerAnalytics } from '../components/ManagerAnalytics.js';

function renderManagerSlotBoard(slots, orders) {
  const validOrders = orders.filter((o) => o.status !== 'CANCELLED');
  const totalFoodBooked = slots.reduce((s, slot) => s + slot.foodOrdersCount, 0);
  const totalTablesBooked = slots.reduce((s, slot) => s + slot.dineInTablesCount, 0);
  const maxFoodTotal = slots.reduce((s, slot) => s + slot.maxFoodOrders, 0);
  const maxTablesTotal = slots.reduce((s, slot) => s + slot.maxDineInTables, 0);

  return `
    <section class="panel-card" aria-label="Real-Time Slot and Table Bookings">
      <div class="panel-title-row" style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <h3>${icon('clock', 18)} Real-Time Slot &amp; Table Bookings</h3>
          <span class="live-sync-pill">
            <span class="live-dot"></span>
            <span>Live</span>
          </span>
        </div>
        <span class="section-count">
          Food ${totalFoodBooked}/${maxFoodTotal} • Tables ${totalTablesBooked}/${maxTablesTotal}
        </span>
      </div>

      <div class="manager-slots-grid">
        ${slots
          .map((slot) => {
            const slotOrders = validOrders.filter((o) => o.slotId === slot.id);
            const foodPct = Math.min(
              100,
              Math.round((slot.foodOrdersCount / slot.maxFoodOrders) * 100)
            );
            const tablePct = Math.min(
              100,
              Math.round((slot.dineInTablesCount / slot.maxDineInTables) * 100)
            );
            const foodColor = getSlotStatusColor(slot.foodOrdersCount, slot.maxFoodOrders);
            const tableColor = getSlotStatusColor(slot.dineInTablesCount, slot.maxDineInTables);

            const peakCount = Math.max(slot.foodOrdersCount, slot.dineInTablesCount);
            const overallColor = getSlotStatusColor(peakCount, slot.maxFoodOrders);
            const statusText =
              slot.isFoodFull && slot.isTablesFull
                ? 'Full'
                : slot.isFoodFull
                ? 'Food Full'
                : slot.isTablesFull
                ? 'Tables Full'
                : peakCount >= 8
                ? 'Filling Fast'
                : 'Open';

            // Build 10-table visual occupancy map (T1..T10) accounting for multi-slot durations
            const tableAvailability = computeTablesAvailability(
              validOrders,
              CANTEEN_TABLES,
              slot.id,
              10
            );
            const explicitTables = new Set(
              tableAvailability.filter((t) => t.isBooked).map((t) => t.number)
            );
            for (let n = 1; n <= slot.maxDineInTables && explicitTables.size < slot.dineInTablesCount; n += 1) {
              explicitTables.add(n);
            }

            // Include carry-over Dine-In bookings occupying a table in this slot from an earlier window
            const carryOverOrders = tableAvailability
              .map((t) => t.occupyingOrder)
              .filter((ord) => ord && ord.slotId !== slot.id);
            const rosterOrders = [...slotOrders, ...carryOverOrders];

            return `
              <article class="manager-slot-card ${
                slot.isFoodFull || slot.isTablesFull ? 'is-full' : ''
              }">
                <div class="manager-slot-head">
                  <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
                    <span class="manager-slot-time">${escapeHtml(slot.id)}</span>
                    ${
                      isPeakSlot(slot, slots)
                        ? `<span class="peak-cap-badge">⚡ Peak (15m Cap)</span>`
                        : ''
                    }
                  </div>
                  <span class="slot-status-pill ${overallColor}">${statusText}</span>
                </div>

                <div class="manager-meter-group">
                  <div class="manager-meter-row">
                    <span>Food Pickups</span>
                    <strong class="slot-cap-text ${foodColor}">
                      ${slot.foodOrdersCount}/${slot.maxFoodOrders}
                    </strong>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${foodColor}" style="width:${foodPct}%"></div>
                  </div>

                  <div class="manager-meter-row" style="margin-top:6px;">
                    <span>Dine-In Tables</span>
                    <strong class="slot-cap-text ${tableColor}">
                      ${slot.dineInTablesCount}/${slot.maxDineInTables}
                    </strong>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill ${tableColor}" style="width:${tablePct}%"></div>
                  </div>
                </div>

                <div>
                  <div class="table-map-label">Table Map (T1–T10)</div>
                  <div class="table-mini-grid">
                    ${Array.from({ length: slot.maxDineInTables }, (_, idx) => {
                      const tNum = idx + 1;
                      const tblInfo = tableAvailability.find((t) => t.number === tNum);
                      const isBooked = explicitTables.has(tNum);
                      const dur = tblInfo?.occupyingOrder?.durationMins || 30;
                      const tip = isBooked
                        ? `Table ${tNum}: Reserved ${tblInfo?.bookedRange || slot.id} (${dur}m)${
                            tblInfo?.occupyingOrder ? ` • #${tblInfo.occupyingOrder.token}` : ''
                          }`
                        : `Table ${tNum}: Available`;
                      return `<span class="table-chip ${
                        isBooked ? 'booked' : 'open'
                      }" title="${escapeHtml(tip)}">T${tNum}${
                        isBooked && tblInfo?.bookedRange ? ` · ${dur}m` : ''
                      }</span>`;
                    }).join('')}
                  </div>
                </div>

                <div class="manager-slot-orders">
                  <div class="table-map-label">Booked Tokens (${rosterOrders.length})</div>
                  ${
                    rosterOrders.length === 0
                      ? `<div class="manager-slot-empty">No direct order tickets yet</div>`
                      : `
                        <ul class="manager-token-list">
                          ${rosterOrders
                            .map((ord) => {
                              const isCarryOver = ord.slotId !== slot.id;
                              const dineDur = Number(ord.durationMins) || 30;
                              const rangeLabel =
                                ord.orderType === 'dine-in'
                                  ? `${formatTimeRange(ord.slotId, dineDur).compactRange} • ${dineDur}m`
                                  : 'Takeaway';
                              return `
                            <li>
                              <span class="manager-tok-id">#${escapeHtml(ord.token)}</span>
                              <span class="manager-tok-meta">
                                ${escapeHtml(ord.studentName.split('•')[0].trim())} • ${
                                ord.orderType === 'dine-in'
                                  ? `T${ord.tableNumber || 1} (${escapeHtml(rangeLabel)})`
                                  : 'Takeaway'
                              }${isCarryOver ? ' <em>hold</em>' : ''}
                              </span>
                              <span class="mini-tag ${
                                ord.status === 'READY' || ord.status === 'COLLECTED'
                                  ? 'takeaway'
                                  : 'dine-in'
                              }">${escapeHtml(ord.status)}</span>
                            </li>
                          `;
                            })
                            .join('')}
                        </ul>
                      `
                  }
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

export function renderManagerView(state) {
  const { menu, orders, slots, managerTab = 'all' } = state;

  const validOrders = orders.filter((o) => o.status !== 'CANCELLED');
  const totalOrdersToday = validOrders.length;
  const totalRevenue = validOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);

  const peakSlot = [...slots].sort((a, b) => b.foodOrdersCount - a.foodOrdersCount)[0];
  const activeTables = validOrders.filter(
    (o) => o.orderType === 'dine-in' && o.status !== 'COLLECTED'
  ).length;
  const maxTablesTotal = slots.reduce((s, slot) => s + slot.maxDineInTables, 0);

  const showOperations = managerTab === 'all' || managerTab === 'operations';
  const showAnalytics = managerTab === 'all' || managerTab === 'analytics';

  return `
    <div class="manager-container view-enter">
      <div class="manager-subnav-bar" role="tablist" aria-label="Canteen Manager Sections">
        <div class="manager-subnav-pills">
          <button
            type="button"
            class="manager-subnav-btn ${managerTab === 'all' ? 'active' : ''}"
            data-action="set-manager-tab"
            data-tab="all"
            role="tab"
            aria-selected="${managerTab === 'all'}"
          >
            ${icon('sliders', 15)} All Overview
          </button>
          <button
            type="button"
            class="manager-subnav-btn ${managerTab === 'operations' ? 'active' : ''}"
            data-action="set-manager-tab"
            data-tab="operations"
            role="tab"
            aria-selected="${managerTab === 'operations'}"
          >
            ${icon('clock', 15)} Operations &amp; Slots
          </button>
          <button
            type="button"
            class="manager-subnav-btn ${managerTab === 'analytics' ? 'active' : ''}"
            data-action="set-manager-tab"
            data-tab="analytics"
            role="tab"
            aria-selected="${managerTab === 'analytics'}"
          >
            ${icon('trending', 15)} Order Insights &amp; Analytics
          </button>
        </div>
        <span class="manager-subnav-meta">Canteen Manager Command Center</span>
      </div>

      ${
        showOperations
          ? `
      <section class="kpi-strip" aria-label="Live Canteen KPIs">
        <div class="kpi-card">
          <div>
            <div class="kpi-label">Total Orders Today</div>
            <div class="kpi-value">${totalOrdersToday}</div>
            <div class="kpi-sub">Revenue: ${formatRupees(totalRevenue)}</div>
          </div>
          <div class="kpi-icon-box brand">${icon('trending', 22)}</div>
        </div>

        <div class="kpi-card">
          <div>
            <div class="kpi-label">Peak Rush Slot</div>
            <div class="kpi-value">${peakSlot ? escapeHtml(peakSlot.id) : '--'}</div>
            <div class="kpi-sub">
              ${
                peakSlot
                  ? `${peakSlot.foodOrdersCount}/${peakSlot.maxFoodOrders} food orders booked`
                  : 'No active slots'
              }
            </div>
          </div>
          <div class="kpi-icon-box amber">${icon('clock', 22)}</div>
        </div>

        <div class="kpi-card">
          <div>
            <div class="kpi-label">Active Table Reservations</div>
            <div class="kpi-value">${activeTables}</div>
            <div class="kpi-sub">Across ${maxTablesTotal} total dine-in table capacity</div>
          </div>
          <div class="kpi-icon-box emerald">${icon('table', 22)}</div>
        </div>
      </section>

      ${renderManagerSlotBoard(slots, orders)}

      <div class="manager-grid">
        <section class="panel-card" aria-label="Menu and Stock Controls">
          <div class="panel-title-row">
            <h3>Menu &amp; Live Stock Controls</h3>
            <span class="section-count">${menu.filter((m) => m.inStock).length}/${menu.length} available</span>
          </div>

          <div class="stock-table-wrap">
            <table class="stock-table">
              <thead>
                <tr>
                  <th>Dish</th>
                  <th>Price</th>
                  <th>In Stock</th>
                  <th>New Update</th>
                </tr>
              </thead>
              <tbody>
                ${menu
                  .map(
                    (item) => `
                  <tr>
                    <td>
                      <div class="stock-dish-cell">
                        <div class="stock-thumb">${getDishArt(item.artKey, item.isVeg, item.name, item.image)}</div>
                        <div>
                          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:var(--text-primary);">
                            <span class="diet-indicator ${item.isVeg ? 'veg' : 'non-veg'}"></span>
                            <span>${escapeHtml(item.name)}</span>
                          </div>
                          <div style="font-size:0.74rem;color:var(--text-muted);font-variant-numeric:tabular-nums;">
                            ${item.calories} kcal • ${item.protein}g protein
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><strong>${formatRupees(item.price)}</strong></td>
                    <td>
                      <button
                        type="button"
                        class="switch-toggle"
                        role="switch"
                        aria-checked="${item.inStock}"
                        data-action="toggle-stock"
                        data-item-id="${escapeHtml(item.id)}"
                        data-next-val="${!item.inStock}"
                      >
                        <span class="switch-track stock"><span class="switch-thumb"></span></span>
                        <span class="switch-label" style="color:${
                          item.inStock ? 'var(--emerald)' : 'var(--crimson)'
                        };">
                          ${item.inStock ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        class="switch-toggle"
                        role="switch"
                        aria-checked="${item.isNew}"
                        data-action="toggle-new-flag"
                        data-item-id="${escapeHtml(item.id)}"
                        data-next-val="${!item.isNew}"
                      >
                        <span class="switch-track new-flag"><span class="switch-thumb"></span></span>
                        <span class="switch-label">
                          ${item.isNew ? 'NEW Ribbon' : 'Standard'}
                        </span>
                      </button>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel-card" aria-label="Add New Menu Item">
          <div class="panel-title-row">
            <h3>
              ${icon('plus', 18)}
              <span>Add New Menu Item</span>
            </h3>
          </div>

          <form class="publish-form" data-action="publish-menu-item">
            <div class="form-field">
              <label for="new-item-name">Dish Name</label>
              <input
                id="new-item-name"
                name="name"
                type="text"
                class="form-input"
                placeholder="e.g. Paneer Butter Bowl"
                required
              />
            </div>

            <div class="form-row-2">
              <div class="form-field">
                <label for="new-item-price">Price (₹)</label>
                <input
                  id="new-item-price"
                  name="price"
                  type="number"
                  min="5"
                  max="999"
                  class="form-input"
                  placeholder="85"
                  required
                />
              </div>

              <div class="form-field">
                <label for="new-item-diet">Dietary Type</label>
                <select id="new-item-diet" name="isVeg" class="form-select">
                  <option value="true">Veg</option>
                  <option value="false">Non-Veg</option>
                </select>
              </div>
            </div>

            <div class="form-row-2">
              <div class="form-field">
                <label for="new-item-calories">Calories (kcal)</label>
                <input
                  id="new-item-calories"
                  name="calories"
                  type="number"
                  min="20"
                  max="2000"
                  class="form-input"
                  placeholder="380"
                  required
                />
              </div>

              <div class="form-field">
                <label for="new-item-protein">Protein (g)</label>
                <input
                  id="new-item-protein"
                  name="protein"
                  type="number"
                  min="1"
                  max="120"
                  class="form-input"
                  value="12"
                />
              </div>
            </div>

            <label style="display:flex;align-items:center;gap:8px;font-size:0.83rem;font-weight:700;color:var(--text-secondary);cursor:pointer;">
              <input type="checkbox" name="isNew" checked />
              <span>Badge as “NEW” under Student New Updates</span>
            </label>

            <button type="submit" class="btn-primary-full">
              Publish to Live Canteen Menu
            </button>
          </form>
        </section>
      </div>
      `
          : ''
      }

      ${showAnalytics ? renderManagerAnalytics(state) : ''}
    </div>
  `;
}

