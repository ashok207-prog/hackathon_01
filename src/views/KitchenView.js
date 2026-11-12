import { icon } from '../utils/icons.js';
import { escapeHtml, formatTimeRange } from '../utils/format.js';

export function renderKitchenView(state) {
  const { orders, slots, kdsBatchSlot, prepAdjustments = [] } = state;

  // Exclude already collected/cancelled orders from active KDS prep queue
  const activeOrders = orders.filter(
    (o) => o.status !== 'COLLECTED' && o.status !== 'CANCELLED'
  );

  // Batch-Cooking Aggregator counts items that still need cooking (PLACED or PREPARING)
  const toCookOrders = activeOrders.filter((o) => {
    const needsPrep = o.status === 'PLACED' || o.status === 'PREPARING';
    if (!needsPrep) return false;
    return kdsBatchSlot === 'all' ? true : o.slotId === kdsBatchSlot;
  });

  const batchCounts = new Map();
  for (const ord of toCookOrders) {
    for (const item of ord.items) {
      batchCounts.set(item.name, (batchCounts.get(item.name) || 0) + item.qty);
    }
  }

  const sortedBatch = Array.from(batchCounts.entries()).sort((a, b) => b[1] - a[1]);
  const batchHeading =
    kdsBatchSlot === 'all' ? 'All Slots Batch (To Cook)' : `${kdsBatchSlot} Batch`;

  return `
    <div class="kds-container view-enter">
      <section class="batch-aggregator-bar" aria-label="Batch Cooking Aggregator">
        <div class="batch-header-row">
          <h2 class="batch-title">
            ${icon('flame', 20)}
            <span>${escapeHtml(batchHeading)}:</span>
            <span style="font-size:0.84rem;font-weight:600;color:var(--text-secondary);">
              ${toCookOrders.length} active ticket${toCookOrders.length === 1 ? '' : 's'}
            </span>
          </h2>

          <div class="batch-slot-tabs" role="tablist" aria-label="Filter Batch Summary Slot">
            <button
              type="button"
              class="batch-tab ${kdsBatchSlot === 'all' ? 'active' : ''}"
              data-action="set-kds-batch-slot"
              data-slot-id="all"
            >
              All Active
            </button>
            ${slots
              .map((s) => {
                const slotPendingCount = activeOrders.filter(
                  (o) =>
                    o.slotId === s.id &&
                    (o.status === 'PLACED' || o.status === 'PREPARING')
                ).length;
                return `
                <button
                  type="button"
                  class="batch-tab ${kdsBatchSlot === s.id ? 'active' : ''}"
                  data-action="set-kds-batch-slot"
                  data-slot-id="${escapeHtml(s.id)}"
                >
                  ${escapeHtml(s.id)} (${slotPendingCount})
                </button>
              `;
              })
              .join('')}
          </div>
        </div>

        <div class="batch-items-strip">
          ${
            sortedBatch.length === 0
              ? `<span style="color:var(--text-muted);font-size:0.86rem;font-weight:600;">All dishes for this batch are ready or handed over.</span>`
              : sortedBatch
                  .map(
                    ([dishName, qty]) => `
                <div class="batch-pill">
                  <span class="batch-qty">${qty}×</span>
                  <span>${escapeHtml(dishName)}</span>
                </div>
              `
                  )
                  .join('')
          }
        </div>
        ${
          prepAdjustments.length > 0
            ? `
        <div class="kds-prep-boosts" aria-label="Manager Recommended Batch Prep Targets">
          <span class="kds-boost-label">${icon('sparkles', 14)} Manager Batch Prep Boost:</span>
          ${prepAdjustments
            .filter((adj) => kdsBatchSlot === 'all' || adj.slotId === kdsBatchSlot)
            .map((adj) => {
              const sign = adj.deltaQty > 0 ? '+' : '';
              return `
                <span class="kds-boost-pill" title="${escapeHtml(adj.note || adj.title)}">
                  <strong>${sign}${adj.deltaQty}×</strong>
                  <span>${escapeHtml(adj.itemName)}</span>
                  <span class="kds-boost-slot">(${escapeHtml(adj.slotId)})</span>
                </span>
              `;
            })
            .join('')}
        </div>
        `
            : ''
        }
      </section>

      <section class="kds-slots-board" aria-label="Slot-Grouped Kitchen Tickets">
        ${slots
          .map((slot) => {
            const slotOrders = activeOrders
              .filter((o) => o.slotId === slot.id)
              .sort((a, b) => {
                const rank = { PLACED: 0, PREPARING: 1, READY: 2 };
                return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
              });

            return `
            <div class="kds-slot-column">
              <div class="kds-col-header">
                <div>
                  <div class="kds-col-time">${escapeHtml(slot.id)} Slot</div>
                  <div style="font-size:0.74rem;font-weight:600;color:var(--text-muted);font-variant-numeric:tabular-nums;">
                    ${slot.foodOrdersCount}/${slot.maxFoodOrders} orders • ${slot.dineInTablesCount}/${slot.maxDineInTables} tables
                  </div>
                </div>
                <span class="mini-tag">${slotOrders.length} active</span>
              </div>

              ${
                slotOrders.length === 0
                  ? `<div class="empty-state" style="padding:18px 8px;">No pending tickets in ${escapeHtml(slot.id)}.</div>`
                  : slotOrders
                      .map((ord) => {
                        const isReady = ord.status === 'READY';
                        const isPreparing = ord.status === 'PREPARING';

                        return `
                      <article class="kds-order-card ${isReady ? 'status-ready' : ''}">
                        <div class="kds-order-head">
                          <span class="kds-token">#${escapeHtml(ord.token)}</span>
                          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;">
                            <span class="mini-tag ${
                              ord.orderType === 'dine-in' ? 'dine-in' : 'takeaway'
                            }">
                              ${
                                ord.orderType === 'dine-in'
                                  ? `Dine-In • T${ord.tableNumber || 1} • ${escapeHtml(
                                      formatTimeRange(ord.slotId, ord.durationMins || 30).compactRange
                                    )} • ${Number(ord.durationMins) || 30}m`
                                  : 'Takeaway'
                              }
                            </span>
                            <span class="slot-status-pill ${
                              isReady ? 'green' : isPreparing ? 'amber' : 'red'
                            }">
                              ${isReady ? 'Ready' : isPreparing ? 'Preparing' : 'New Order'}
                            </span>
                          </div>
                        </div>

                        <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);">
                          ${escapeHtml(ord.studentName)}
                        </div>

                        <ul class="kds-items-list">
                          ${ord.items
                            .map(
                              (item) => `
                            <li>
                              <span class="kds-qty-chip">${item.qty}×</span>
                              <span>${escapeHtml(item.name)}</span>
                            </li>
                          `
                            )
                            .join('')}
                        </ul>

                        <div class="kds-actions">
                          ${
                            isReady
                              ? `
                            <button
                              type="button"
                              class="btn-kds-secondary"
                              style="width:100%;"
                              data-action="update-order-status"
                              data-order-id="${escapeHtml(ord.id)}"
                              data-status="COLLECTED"
                            >
                              ${icon('check', 14)} Picked Up
                            </button>
                          `
                              : `
                            ${
                              ord.status === 'PLACED'
                                ? `
                              <button
                                type="button"
                                class="btn-kds-secondary"
                                data-action="update-order-status"
                                data-order-id="${escapeHtml(ord.id)}"
                                data-status="PREPARING"
                              >
                                Start Prep
                              </button>
                            `
                                : ''
                            }
                            <button
                              type="button"
                              class="btn-mark-ready"
                              data-action="update-order-status"
                              data-order-id="${escapeHtml(ord.id)}"
                              data-status="READY"
                            >
                              ${icon('checkCircle', 15)}
                              <span>Mark Ready</span>
                            </button>
                          `
                          }
                        </div>
                      </article>
                    `;
                      })
                      .join('')
              }
            </div>
          `;
          })
          .join('')}
      </section>
    </div>
  `;
}

