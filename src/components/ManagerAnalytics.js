import { icon } from '../utils/icons.js';
import { escapeHtml, formatRupees } from '../utils/format.js';
import { getDishArt } from '../utils/foodArt.js';

/**
 * Baseline daily campus dish demand before live session orders are added,
 * keeping percentages grounded and responsive to real checkout orders.
 */
const BASELINE_ITEM_VOLUMES = {
  'masala-dosa': 248,
  'cold-coffee': 206,
  'paneer-roll': 164,
  'chole-bhature': 132,
  'peri-peri-chicken': 98,
  'veg-puff': 84,
  'egg-fried-rice': 76,
  'samosa': 68
};

/**
 * Computes rule-based actionable smart recommendation from live slots and orders.
 */
function buildSmartRecommendation(slots = [], orders = [], menu = []) {
  const busierSlot = [...slots].sort((a, b) => b.foodOrdersCount - a.foodOrdersCount)[0];
  const slot1230 = slots.find((s) => s.id === '12:30') || busierSlot;
  const outOfStockItem = menu.find((m) => !m.inStock);

  if (slot1230 && slot1230.foodOrdersCount >= 7) {
    const pct = Math.round((slot1230.foodOrdersCount / Math.max(1, slot1230.maxFoodOrders)) * 100);
    return {
      id: `rec-rush-${slot1230.id}`,
      badge: 'High Rush Alert',
      title: `${slot1230.id} slot is at ${pct}% capacity — prep +12 Masala Dosas now`,
      detail:
        'Pre-heating tawa batter 10 mins ahead avoids pickup queue spillover during peak dining.',
      itemName: 'Masala Dosa',
      deltaQty: 12,
      slotId: slot1230.id,
      note: `${pct}% slot load • Auto-suggested from live ${slot1230.id} pre-orders`
    };
  }

  if (outOfStockItem) {
    return {
      id: 'rec-substitute-dosa',
      badge: 'Stock Redirect',
      title: `${outOfStockItem.name} paused — prep +8 Paneer Kathi Rolls for 12:30`,
      detail:
        'Redirect kitchen prep capacity toward top-converting Veg alternatives to keep zero idle line time.',
      itemName: 'Paneer Kathi Roll',
      deltaQty: 8,
      slotId: '12:30',
      note: `Compensates paused ${outOfStockItem.name} demand`
    };
  }

  const slot1250 = slots.find((s) => s.id === '12:50');
  if (slot1250 && slot1250.foodOrdersCount <= 2) {
    return {
      id: 'rec-reduce-puff-3pm',
      badge: 'Waste Prevention',
      title: 'Reduce afternoon Veg Puff batch by 20% after 3 PM',
      detail:
        'Pre-order demand drops sharply post-rush; trimming off-peak trays saves ~₹420 in daily pastry waste.',
      itemName: 'Veg Puff (-20% off-peak)',
      deltaQty: -6,
      slotId: '12:50',
      note: 'Post-3 PM batch trim • Est. ₹420 daily waste saved'
    };
  }

  const totalLive = orders.filter((o) => o.status !== 'CANCELLED').length;
  return {
    id: 'rec-prebatch-1230',
    badge: 'Smart Batch Tip',
    title: '12:30 rush builds fast — pre-stage +12 Masala Dosas & Cold Coffee',
    detail: `Based on ${totalLive} active pre-orders, staging batter and espresso shots cuts ticket turnaround by 34%.`,
    itemName: 'Masala Dosa',
    deltaQty: 12,
    slotId: '12:30',
    note: 'Peak window staging boost'
  };
}

/**
 * Ranks top 4 demanded dishes by combining baseline + live student order quantities.
 */
function computeTopDemandedItems(menu = [], orders = []) {
  const validOrders = orders.filter((o) => o.status !== 'CANCELLED');
  const counts = {};

  for (const item of menu) {
    counts[item.id] = BASELINE_ITEM_VOLUMES[item.id] || 42;
  }

  for (const order of validOrders) {
    for (const line of order.items || []) {
      const id = line.itemId;
      counts[id] = (counts[id] || 40) + Number(line.qty || 1) * 6;
    }
  }

  const totalUnits = Math.max(
    1,
    menu.reduce((sum, item) => sum + (counts[item.id] || 0), 0)
  );

  const ranked = menu
    .map((item) => {
      const volume = counts[item.id] || 40;
      const share = Math.max(4, Math.round((volume / totalUnits) * 100));
      return { item, volume, share };
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 4);

  const maxVolume = Math.max(1, ranked[0]?.volume || 1);
  return ranked.map((entry) => ({
    ...entry,
    barWidth: Math.max(18, Math.round((entry.volume / maxVolume) * 100))
  }));
}

/**
 * Renders the responsive inline SVG dual-line Hourly & Slot Demand Prediction chart.
 */
function renderDemandPredictionChart(slots = [], orders = []) {
  const slot1230 = slots.find((s) => s.id === '12:30');
  const liveBoost = (slot1230?.foodOrdersCount || 0) * 6 + orders.length * 2;
  const peakActual = Math.min(395, 318 + liveBoost);

  const labels = ['9 AM', '11 AM', '12:30 PM', '1 PM', '3 PM', '5 PM'];
  const predicted = [92, 195, 350, 325, 165, 118];
  const actual = [88, 184, peakActual, 338, 152, 112];

  const width = 640;
  const height = 228;
  const padL = 44;
  const padR = 24;
  const padT = 30;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxY = 400;

  const toX = (idx) => padL + (idx / (labels.length - 1)) * plotW;
  const toY = (val) => padT + plotH - (Math.min(maxY, Math.max(0, val)) / maxY) * plotH;

  const buildSmoothPath = (pts) => {
    if (!pts.length) return '';
    return pts.reduce((acc, pt, i, arr) => {
      if (i === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      const prev = arr[i - 1];
      const cx1 = prev.x + (pt.x - prev.x) * 0.45;
      const cx2 = prev.x + (pt.x - prev.x) * 0.55;
      return `${acc} C ${cx1.toFixed(1)} ${prev.y.toFixed(1)}, ${cx2.toFixed(1)} ${pt.y.toFixed(1)}, ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');
  };

  const predPts = predicted.map((v, i) => ({ x: toX(i), y: toY(v), val: v }));
  const actPts = actual.map((v, i) => ({ x: toX(i), y: toY(v), val: v }));

  const predPath = buildSmoothPath(predPts);
  const actPath = buildSmoothPath(actPts);
  const areaPath = `${actPath} L ${actPts[actPts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${actPts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const yTicks = [0, 100, 200, 300, 400];
  const peakPoint = actPts[2]; // 12:30 PM

  return `
    <div class="analytics-card analytics-chart-card">
      <div class="analytics-card-head">
        <div>
          <h3>Hourly &amp; Slot Demand Prediction</h3>
          <p>Pre-order forecast vs. actual campus throughput across operating windows</p>
        </div>
        <div class="chart-legend" aria-label="Chart Legend">
          <span class="legend-item">
            <span class="legend-swatch actual"></span> Actual Orders
          </span>
          <span class="legend-item">
            <span class="legend-swatch predicted"></span> Predicted Demand
          </span>
        </div>
      </div>

      <div class="demand-chart-wrap">
        <div class="peak-callout-badge" title="Peak Dining Window">
          <span class="peak-dot"></span>
          <span>Peak Rush Window (~350 orders)</span>
        </div>

        <svg class="demand-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hourly Demand Prediction Line Chart">
          <defs>
            <linearGradient id="actualAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#34D399" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="#34D399" stop-opacity="0.01"/>
            </linearGradient>
            <filter id="emeraldGlow" x="-15%" y="-15%" width="130%" height="130%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          <!-- Peak Rush Window Highlight Band (12:30 PM - 1:00 PM) -->
          <rect
            x="${(actPts[2].x - 16).toFixed(1)}"
            y="${padT}"
            width="${(actPts[3].x - actPts[2].x + 32).toFixed(1)}"
            height="${plotH}"
            rx="10"
            fill="rgba(251, 191, 36, 0.08)"
            stroke="rgba(251, 191, 36, 0.24)"
            stroke-dasharray="4 4"
          />

          <!-- Horizontal Gridlines -->
          ${yTicks
            .map((tick) => {
              const y = toY(tick).toFixed(1);
              return `
                <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
                <text x="${padL - 10}" y="${Number(y) + 4}" text-anchor="end" fill="#8E9B92" font-size="11" font-weight="600">${tick}</text>
              `;
            })
            .join('')}

          <!-- Actual Area Fill -->
          <path d="${areaPath}" fill="url(#actualAreaGrad)"/>

          <!-- Predicted Dashed Line -->
          <path
            d="${predPath}"
            fill="none"
            stroke="#8E9B92"
            stroke-width="2.2"
            stroke-dasharray="6 5"
            stroke-linecap="round"
          />

          <!-- Actual Solid Glowing Line -->
          <path
            d="${actPath}"
            fill="none"
            stroke="#34D399"
            stroke-width="3"
            stroke-linecap="round"
            filter="url(#emeraldGlow)"
          />

          <!-- Data Points & X-Axis Labels -->
          ${labels
            .map((label, idx) => {
              const pt = actPts[idx];
              const isPeak = idx === 2 || idx === 3;
              return `
                <circle
                  cx="${pt.x.toFixed(1)}"
                  cy="${pt.y.toFixed(1)}"
                  r="${isPeak ? 5.5 : 4}"
                  fill="${isPeak ? '#FBBF24' : '#34D399'}"
                  stroke="#0B100D"
                  stroke-width="2"
                />
                <text
                  x="${pt.x.toFixed(1)}"
                  y="${height - 10}"
                  text-anchor="middle"
                  fill="${isPeak ? '#FBBF24' : '#8E9B92'}"
                  font-size="11.5"
                  font-weight="${isPeak ? '700' : '600'}"
                >${label}</text>
              `;
            })
            .join('')}

          <!-- Peak Indicator Marker Ring -->
          <circle
            cx="${peakPoint.x.toFixed(1)}"
            cy="${peakPoint.y.toFixed(1)}"
            r="11"
            fill="none"
            stroke="rgba(251, 191, 36, 0.45)"
            stroke-width="1.5"
          />
        </svg>
      </div>
    </div>
  `;
}

/**
 * Renders the full "Order Insights & Demand Analytics" dashboard inside Canteen Manager.
 */
export function renderManagerAnalytics(state) {
  const { menu = [], orders = [], slots = [], prepAdjustments = [] } = state;

  const validOrders = orders.filter((o) => o.status !== 'CANCELLED');
  const totalOrdersToday = 832 + validOrders.length; // Seed 10 orders => 842; increments live
  const wasteRate = Math.max(12, 18 - Math.min(4, prepAdjustments.length));
  const predictionAccuracy = Math.min(97, 92 + (prepAdjustments.length > 0 ? 1 : 0));
  const costSaved = 1070 + validOrders.length * 18 + prepAdjustments.length * 180; // Seed 10 orders => ₹1,250

  const topItems = computeTopDemandedItems(menu, orders);
  const recommendation = buildSmartRecommendation(slots, orders, menu);
  const isRecApplied = prepAdjustments.some((adj) => adj.id === recommendation.id);

  // Circular radial ring math for 35% Food Waste Reduction
  const wastePct = 35;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (wastePct / 100) * circumference;

  const outOfStockCount = menu.filter((m) => !m.inStock).length;
  const adequateCount = menu.length - outOfStockCount;

  const inventoryRows = menu.slice(0, 6).map((item) => {
    let statusLabel = 'Adequate';
    let statusClass = 'adequate';

    if (!item.inStock) {
      statusLabel = 'Out of Stock';
      statusClass = 'out';
    } else if (item.id === 'chole-bhature' || item.id === 'samosa' || item.isNew) {
      statusLabel = 'Low Stock';
      statusClass = 'low';
    }

    return { item, statusLabel, statusClass };
  });

  return `
    <section class="analytics-dashboard" aria-label="Order Insights and Demand Analytics">
      <div class="analytics-section-intro">
        <div>
          <span class="analytics-eyebrow">${icon('trending', 14)} Order Insights &amp; Demand Analytics</span>
          <h2>Predictive Kitchen Load &amp; Zero-Waste Telemetry</h2>
        </div>
        <div class="analytics-live-pill">
          <span class="pulse-dot" style="background:var(--emerald)"></span>
          Synced with ${validOrders.length} active pre-orders
        </div>
      </div>

      <!-- 1. Top 4 Live KPI Insight Cards -->
      <div class="analytics-kpi-grid">
        <article class="analytics-kpi-card">
          <div class="analytics-kpi-top">
            <span class="analytics-kpi-label">Total Orders Today</span>
            <span class="trend-badge positive">↑ 12%</span>
          </div>
          <div class="analytics-kpi-value">${totalOrdersToday.toLocaleString('en-IN')}</div>
          <div class="analytics-kpi-foot">Includes ${validOrders.length} live slot pre-orders</div>
        </article>

        <article class="analytics-kpi-card">
          <div class="analytics-kpi-top">
            <span class="analytics-kpi-label">Food Waste Rate</span>
            <span class="trend-badge positive">↓ 35% vs last week</span>
          </div>
          <div class="analytics-kpi-value">${wasteRate}%</div>
          <div class="analytics-kpi-foot">Pre-ordered trays cut end-of-day surplus</div>
        </article>

        <article class="analytics-kpi-card">
          <div class="analytics-kpi-top">
            <span class="analytics-kpi-label">Slot Prediction Accuracy</span>
            <span class="trend-badge amber">92%+ Target</span>
          </div>
          <div class="analytics-kpi-value">${predictionAccuracy}%</div>
          <div class="analytics-kpi-foot">Matches 10-min kitchen prep throughput</div>
        </article>

        <article class="analytics-kpi-card">
          <div class="analytics-kpi-top">
            <span class="analytics-kpi-label">Food &amp; Cost Saved</span>
            <span class="trend-badge positive">Batch Gain</span>
          </div>
          <div class="analytics-kpi-value">${formatRupees(costSaved)}</div>
          <div class="analytics-kpi-foot">Saved today via pre-order batch cooking</div>
        </article>
      </div>

      <!-- 2. Middle Row (65% / 35%): Demand Prediction Chart + Top Demanded Items -->
      <div class="analytics-mid-grid">
        ${renderDemandPredictionChart(slots, orders)}

        <div class="analytics-card top-dishes-card">
          <div class="analytics-card-head">
            <div>
              <h3>Top Demanded Food Items</h3>
              <p>Live campus order share across menu</p>
            </div>
            <span class="badge-chip neutral">Top 4</span>
          </div>

          <div class="top-dishes-list">
            ${topItems
              .map(
                ({ item, volume, share, barWidth }, idx) => `
              <div class="top-dish-row">
                <div class="top-dish-meta">
                  <div class="top-dish-left">
                    <span class="top-dish-rank">#${idx + 1}</span>
                    <div class="top-dish-thumb">
                      ${getDishArt(item.artKey, item.isVeg, item.name, item.image)}
                    </div>
                    <div>
                      <div class="top-dish-name">${escapeHtml(item.name)}</div>
                      <div class="top-dish-vol">${volume} orders</div>
                    </div>
                  </div>
                  <span class="top-dish-share">${share}%</span>
                </div>
                <div class="top-dish-bar-track">
                  <div class="top-dish-bar-fill" style="width:${barWidth}%"></div>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>

      <!-- 3. Bottom Row (3 Cards): Waste Ring + Inventory Overview + Smart Recommendation -->
      <div class="analytics-bottom-grid">
        <!-- Card 1: Food Waste Reduction -->
        <article class="analytics-card waste-card">
          <div class="analytics-card-head compact">
            <h3>Food Waste Reduction</h3>
            <span class="trend-badge positive">On Track</span>
          </div>

          <div class="waste-ring-layout">
            <div class="waste-ring-wrap">
              <svg class="waste-ring-svg" viewBox="0 0 110 110" aria-hidden="true">
                <circle cx="55" cy="55" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"/>
                <circle
                  cx="55"
                  cy="55"
                  r="${radius}"
                  fill="none"
                  stroke="#34D399"
                  stroke-width="10"
                  stroke-linecap="round"
                  stroke-dasharray="${circumference.toFixed(1)}"
                  stroke-dashoffset="${dashOffset.toFixed(1)}"
                  transform="rotate(-90 55 55)"
                />
              </svg>
              <div class="waste-ring-center">
                <strong>${wastePct}%</strong>
                <span>Reduced</span>
              </div>
            </div>

            <div class="waste-highlights">
              <div class="waste-bullet">
                <span class="waste-check">${icon('check', 13)}</span>
                <span>Auto slot load-balancing</span>
              </div>
              <div class="waste-bullet">
                <span class="waste-check">${icon('check', 13)}</span>
                <span>Pre-order batch prep</span>
              </div>
              <div class="waste-bullet">
                <span class="waste-check">${icon('check', 13)}</span>
                <span>Low-stock alerts</span>
              </div>
            </div>
          </div>
        </article>

        <!-- Card 2: Inventory & Stock Status Overview -->
        <article class="analytics-card inventory-card">
          <div class="analytics-card-head compact">
            <div>
              <h3>Inventory &amp; Stock Status</h3>
              <p>${adequateCount} In Stock • ${outOfStockCount} Paused</p>
            </div>
          </div>

          <div class="inventory-status-list">
            ${inventoryRows
              .map(
                ({ item, statusLabel, statusClass }) => `
              <div class="inventory-row">
                <span class="inventory-name">${escapeHtml(item.name)}</span>
                <span class="inventory-pill ${statusClass}">${statusLabel}</span>
              </div>
            `
              )
              .join('')}
          </div>
        </article>

        <!-- Card 3: Interactive Smart Recommendation -->
        <article class="analytics-card smart-rec-card">
          <div class="analytics-card-head compact">
            <span class="rec-badge">${icon('sparkles', 14)} Smart Recommendation</span>
            <span class="badge-chip amber">${escapeHtml(recommendation.badge)}</span>
          </div>

          <p class="rec-title">${escapeHtml(recommendation.title)}</p>
          <p class="rec-detail">${escapeHtml(recommendation.detail)}</p>

          <div class="rec-actions">
            <button
              type="button"
              class="btn ${isRecApplied ? 'btn-soft' : 'btn-primary'} rec-apply-btn"
              data-action="apply-smart-rec"
              data-rec-id="${escapeHtml(recommendation.id)}"
              data-rec-title="${escapeHtml(recommendation.title)}"
              data-item-name="${escapeHtml(recommendation.itemName)}"
              data-delta-qty="${recommendation.deltaQty}"
              data-slot-id="${escapeHtml(recommendation.slotId)}"
              data-rec-note="${escapeHtml(recommendation.note)}"
            >
              ${
                isRecApplied
                  ? `${icon('checkCircle', 16)} Applied to Kitchen KDS`
                  : `${icon('bolt', 16)} Apply Suggestion`
              }
            </button>
          </div>
        </article>
      </div>
    </section>
  `;
}
