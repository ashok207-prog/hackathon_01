import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/format.js';
import { CURRENT_STUDENT_ID } from '../data/mockSeed.js';

export function renderOrderReadyBanner(state) {
  // Only show student pickup alert on the public Student Portal
  if (state.route === 'staff') return '';

  const readyOrders = state.orders.filter(
    (o) =>
      o.studentId === CURRENT_STUDENT_ID &&
      o.status === 'READY' &&
      !state.dismissedReadyIds.includes(o.id)
  );

  if (readyOrders.length === 0) return '';

  const order = readyOrders[0];
  const itemSummary = order.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
  const pickupLocation =
    order.orderType === 'dine-in'
      ? `Table T${order.tableNumber || 1}`
      : 'Takeaway Counter';

  return `
    <div class="ready-banner-wrap" role="status" aria-live="polite">
      <div class="order-ready-banner">
        <div class="ready-banner-left">
          <div class="ready-icon-circle">${icon('bell', 20)}</div>
          <div>
            <div class="ready-banner-title">
              <span>🎉 Order #${escapeHtml(order.token)} is Ready!</span>
              <span class="ready-token-pill">READY</span>
            </div>
            <div class="ready-banner-sub">
              Please collect it at <strong>${escapeHtml(pickupLocation)}</strong> (${escapeHtml(order.slotId)} • ${escapeHtml(itemSummary)}).
            </div>
          </div>
        </div>
        <div class="ready-banner-actions">
          <button type="button" class="btn-ready-cta" data-action="scroll-to-tracker">
            View Token &amp; QR
          </button>
          <button
            type="button"
            class="btn-ready-dismiss"
            data-action="dismiss-ready-banner"
            data-order-id="${escapeHtml(order.id)}"
          >
            Got It / Dismiss
          </button>
        </div>
      </div>
    </div>
  `;
}
