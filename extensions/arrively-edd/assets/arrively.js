/**
 * Arrively — Estimated Delivery Date
 * Calculates delivery window based on merchant config and variant rules.
 * No external dependencies. No API calls. Pure client-side.
 */

(function () {
  "use strict";

  const WIDGET_ID = "arrively-widget";

  // --- Date utilities ---

  function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function toDateString(date) {
    return date.toISOString().split("T")[0];
  }

  function addBusinessDays(startDate, days, excludeWeekends, holidays) {
    const holidaySet = new Set(holidays || []);
    let current = new Date(startDate);
    let added = 0;

    while (added < days) {
      current.setDate(current.getDate() + 1);
      if (excludeWeekends && isWeekend(current)) continue;
      if (holidaySet.has(toDateString(current))) continue;
      added++;
    }

    return current;
  }

  function formatDate(date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // --- Config resolution ---

  /**
   * Pick the most specific rule for the current product/variant.
   * Priority: variant > product > collection > tag > default
   */
  function resolveRule(config, rules, productId, variantId, productTags, productCollections) {
    const def = {
      processingDays: parseInt(config.processingDays || "1", 10),
      shippingDaysMin: parseInt(config.shippingDaysMin || "3", 10),
      shippingDaysMax: parseInt(config.shippingDaysMax || "7", 10),
    };

    if (!rules || !Array.isArray(rules)) return def;

    // Rank: variant=4, product=3, collection=2, tag=1
    const rank = { variant: 4, product: 3, collection: 2, tag: 1 };
    let best = null;
    let bestRank = 0;

    for (const rule of rules) {
      const r = rank[rule.type] || 0;
      if (r <= bestRank) continue;

      const ruleData = {
        processingDays: parseInt(rule.processingDays || "1", 10),
        shippingDaysMin: parseInt(rule.shippingDaysMin || "3", 10),
        shippingDaysMax: parseInt(rule.shippingDaysMax || "7", 10),
      };

      if (rule.type === "variant" && rule.targetId === String(variantId)) {
        best = ruleData; bestRank = r;
      } else if (rule.type === "product" && rule.targetId === String(productId)) {
        best = ruleData; bestRank = r;
      } else if (rule.type === "collection" && productCollections.includes(rule.targetId)) {
        best = ruleData; bestRank = r;
      } else if (rule.type === "tag" && productTags.includes(rule.targetId)) {
        best = ruleData; bestRank = r;
      }
    }

    return best || def;
  }

  // --- Core render ---

  function renderWidget(config, rules, productId, variantId) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    const msgEl = widget.querySelector(".arrively-message");
    const iconEl = widget.querySelector(".arrively-icon");
    if (!msgEl) return;

    // Gather product meta from data attributes
    const productTags = (widget.dataset.productTags || "").split(",").filter(Boolean);
    const productCollections = (widget.dataset.productCollections || "").split(",").filter(Boolean);

    const rule = resolveRule(config, rules, productId, variantId, productTags, productCollections);

    // Determine effective processing start
    // If order is after cutoff hour, add one day
    const now = new Date();
    const cutoffHour = parseInt(config.cutoffHour || "14", 10);
    const processingStart = new Date(now);

    // Simple cutoff check (local time approximation; server-side would be more accurate)
    if (now.getHours() >= cutoffHour) {
      processingStart.setDate(processingStart.getDate() + 1);
    }

    const excludeWeekends = config.excludeWeekends !== false;
    const holidays = config.holidays || [];

    // Processing time
    let shippedDate = processingStart;
    if (rule.processingDays > 0) {
      shippedDate = addBusinessDays(processingStart, rule.processingDays, excludeWeekends, holidays);
    }

    // Shipping window
    const deliveryStart = addBusinessDays(shippedDate, rule.shippingDaysMin, excludeWeekends, holidays);
    const deliveryEnd = addBusinessDays(shippedDate, rule.shippingDaysMax, excludeWeekends, holidays);

    // Build message
    const template = config.messageTemplate || "Estimated delivery: {date_start} – {date_end}";
    const message = template
      .replace("{date_start}", formatDate(deliveryStart))
      .replace("{date_end}", formatDate(deliveryEnd));

    msgEl.textContent = message;

    // Show/hide truck icon
    if (iconEl) {
      iconEl.style.display = config.showTruckIcon !== false ? "" : "none";
    }

    // Apply accent color
    if (config.accentColor) {
      widget.style.setProperty("--arrively-accent", config.accentColor);
    }

    widget.style.display = "";
  }

  // --- Variant change listener ---

  function watchVariants(config, rules, productId) {
    // Shopify fires a custom event when variant changes
    document.addEventListener("variant:change", function (e) {
      const variantId = e.detail?.variant?.id;
      if (variantId) renderWidget(config, rules, productId, variantId);
    });

    // Also listen for select/radio changes on variant selectors
    document.querySelectorAll('select[name="id"], input[name="id"]').forEach(function (el) {
      el.addEventListener("change", function () {
        renderWidget(config, rules, productId, el.value);
      });
    });
  }

  // --- Bootstrap ---

  function init() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    let config, rules;

    try {
      config = JSON.parse(widget.dataset.config || "{}");
    } catch (e) {
      config = {};
    }

    try {
      rules = JSON.parse(widget.dataset.rules || "[]");
    } catch (e) {
      rules = [];
    }

    const productId = widget.dataset.productId;

    // Get currently selected variant
    const variantSelect = document.querySelector('select[name="id"]');
    const variantRadio = document.querySelector('input[name="id"]:checked');
    const variantId = variantSelect
      ? variantSelect.value
      : variantRadio
      ? variantRadio.value
      : widget.dataset.variants
        ? JSON.parse(widget.dataset.variants || "[]")[0]
        : null;

    renderWidget(config, rules, productId, variantId);
    watchVariants(config, rules, productId);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
