import { icon } from '../utils/icons.js';
import { getDishArt } from '../utils/foodArt.js';
import { escapeHtml, formatRupees } from '../utils/format.js';

export function renderDishDetailModal(state) {
  const { activeDishModalId, menu, cart } = state;
  if (!activeDishModalId) return '';

  const dish = menu.find((m) => m.id === activeDishModalId);
  if (!dish) return '';

  const inCart = cart.find((c) => c.itemId === dish.id);

  return `
    <div class="modal-backdrop" data-action="close-dish-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(dish.name)} details">
      <div class="modal-card" data-stop-propagation="true">
        <div class="modal-hero">
          <button type="button" class="modal-close-float" data-action="close-dish-modal" aria-label="Close dish details">
            ${icon('close', 18)}
          </button>
          ${getDishArt(dish.artKey, dish.isVeg, dish.name, dish.image)}
        </div>
        <div class="modal-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="diet-indicator ${dish.isVeg ? 'veg' : 'non-veg'}"></span>
              <span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);">
                ${escapeHtml(dish.category)} • ~${dish.prepMins} min prep
              </span>
            </div>
            <span style="font-size:0.84rem;font-weight:800;color:var(--text-primary);">
              <span style="color:var(--amber);">★</span> ${dish.rating.toFixed(1)}
            </span>
          </div>

          <div>
            <h3 style="margin:0 0 6px;font-size:1.25rem;font-weight:800;color:var(--text-primary);">
              ${escapeHtml(dish.name)}
            </h3>
            <p style="margin:0;font-size:0.86rem;color:var(--text-secondary);line-height:1.45;">
              ${escapeHtml(dish.description)}
            </p>
          </div>

          <div>
            <div style="font-size:0.74rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:8px;">
              Nutritional Info • Per Portion
            </div>
            <div class="macro-grid">
              <div class="macro-box">
                <div class="macro-val">${dish.calories}</div>
                <div class="macro-lbl">kcal</div>
              </div>
              <div class="macro-box">
                <div class="macro-val">${dish.protein}g</div>
                <div class="macro-lbl">Protein</div>
              </div>
              <div class="macro-box">
                <div class="macro-val">${dish.carbs ?? 38}g</div>
                <div class="macro-lbl">Carbs</div>
              </div>
              <div class="macro-box">
                <div class="macro-val">${dish.fat ?? 12}g</div>
                <div class="macro-lbl">Fat</div>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:6px;">
            <div style="font-size:1.3rem;font-weight:800;color:var(--text-primary);font-variant-numeric:tabular-nums;">
              ${formatRupees(dish.price)}
            </div>
            ${
              !dish.inStock
                ? `<span class="oos-badge">Out of Stock</span>`
                : inCart
                ? `
                <div class="qty-stepper">
                  <button type="button" data-action="dec-cart" data-item-id="${escapeHtml(dish.id)}">−</button>
                  <span>${inCart.qty}</span>
                  <button type="button" data-action="inc-cart" data-item-id="${escapeHtml(dish.id)}">+</button>
                </div>
              `
                : `
                <button type="button" class="btn-nlp-submit" style="padding:10px 18px;" data-action="add-to-cart" data-item-id="${escapeHtml(dish.id)}">
                  Add to Tray
                </button>
              `
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

