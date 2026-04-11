/**
 * Arrively — Estimated Delivery Date
 * Calculates delivery window based on merchant config, badges, and variant rules.
 * No external dependencies (except optional IP-geo and postal-code lookups).
 * Pure client-side logic — no server calls required after page load.
 *
 * Geo detection priority (Amazon-style):
 *   1. User-saved postal code (localStorage) — most accurate, explicit
 *   2. IP-based lookup (ipapi.co) — province-level for anonymous visitors
 *   3. Shopify/Cloudflare GeoIP via Liquid — country-level, always present
 */

(function () {
  "use strict";

  const WIDGET_ID = "arrively-widget";
  const GEO_CACHE_KEY = "arrively_geo_v1";       // sessionStorage — IP lookup cache
  const LOCATION_KEY = "arrively_location_v1";   // localStorage  — user-saved postal
  const GEO_CACHE_TTL = 3600 * 1000; // 1 hour in ms

  // ─── Module state (allows geo updates to propagate to variant listeners) ────

  const _s = {
    config: {},
    rules: [],
    badges: [],
    productId: null,
    variantId: null,
    country: null,
    province: null,
    city: null,
  };

  // ─── Date utilities ───────────────────────────────────────────────────────

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

  // ─── Location storage ─────────────────────────────────────────────────────

  function getSavedLocation() {
    try {
      const raw = localStorage.getItem(LOCATION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) { return null; }
  }

  function saveLocation(geo) {
    try {
      localStorage.setItem(LOCATION_KEY, JSON.stringify(geo));
    } catch (_e) {}
  }

  // ─── IP-based geo lookup (province/state for anonymous visitors) ──────────

  function fetchIpGeo(callback) {
    try {
      const cached = sessionStorage.getItem(GEO_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed._ts && Date.now() - parsed._ts < GEO_CACHE_TTL) {
          callback(parsed);
          return;
        }
      }
    } catch (_e) {}

    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, 2500);

    fetch("https://ipapi.co/json/", { signal: controller.signal })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        clearTimeout(timeout);
        if (!data) return;
        const geo = {
          country: (data.country_code || "").toUpperCase(),
          province: (data.region_code || "").toUpperCase(),
          city: data.city || "",
          _ts: Date.now(),
        };
        try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo)); } catch (_e) {}
        callback(geo);
      })
      .catch(function() { clearTimeout(timeout); });
  }

  // ─── Postal code geo lookup (Amazon-style user input) ────────────────────

  /**
   * Detect country from postal code format.
   * US: 5 digits (90210) or ZIP+4 (90210-1234)
   * Canada: A1A 1A1 or A1A
   * UK: SW1A 1AA, M1 1AA, etc.
   * Returns ISO country code or null if uncertain.
   */
  function detectCountryFromPostal(postal) {
    const p = postal.trim().replace(/\s+/g, "").toUpperCase();
    if (/^\d{5}(-\d{4})?$/.test(p)) return "US";
    if (/^[A-Z]\d[A-Z](\d[A-Z]\d)?$/.test(p)) return "CA";
    if (/^[A-Z]{1,2}\d[A-Z\d]?(\d[A-Z]{2})?$/.test(p)) return "GB";
    if (/^\d{4}$/.test(p)) return "AU";
    return null;
  }

  /**
   * Look up geo data from a postal code using api.zippopotam.us.
   * Free, no API key, covers US/CA/GB/AU/DE/FR/NL + 20 more countries.
   * callback(geo | null)
   */
  function fetchPostalGeo(postal, fallbackCountry, callback) {
    const detected = detectCountryFromPostal(postal);
    const cc = (detected || fallbackCountry || "US").toUpperCase();

    // zippopotam.us uses "gb" for UK, lowercase country codes
    const ccLower = cc.toLowerCase();

    // For Canada, use first 3 chars (FSA) if full code provided
    const cleanPostal = cc === "CA"
      ? postal.trim().replace(/\s+/g, "").substring(0, 3).toUpperCase()
      : postal.trim().split(/\s+/)[0].toUpperCase();

    const url = "https://api.zippopotam.us/" + ccLower + "/" + encodeURIComponent(cleanPostal);

    const controller = new AbortController();
    const timeout = setTimeout(function() { controller.abort(); }, 4000);

    fetch(url, { signal: controller.signal })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        clearTimeout(timeout);
        if (!data || !data.places || !data.places.length) {
          callback(null);
          return;
        }
        const place = data.places[0];
        const geo = {
          country: (data["country abbreviation"] || cc).toUpperCase(),
          province: (place["state abbreviation"] || "").toUpperCase(),
          city: place["place name"] || "",
          postal: postal.trim(),
          _source: "postal",
          _ts: Date.now(),
        };
        callback(geo);
      })
      .catch(function() {
        clearTimeout(timeout);
        callback(null);
      });
  }

  // ─── Badge resolution ─────────────────────────────────────────────────────

  function matchesGeo(badge, customerCountry, customerProvince) {
    if (!badge.geoTargetType || badge.geoTargetType === "all") return true;
    if (!badge.geoTargets || badge.geoTargets.length === 0) return true;
    if (!customerCountry) return true;

    const cc = customerCountry.toUpperCase();
    const pc = customerProvince ? customerProvince.toUpperCase() : null;

    return badge.geoTargets.some(function(target) {
      const parts = target.split("-");
      const targetCountry = parts[0].toUpperCase();
      const targetProvince = parts.length > 1 ? parts.slice(1).join("-").toUpperCase() : null;

      if (targetCountry !== cc) return false;
      if (!targetProvince) return true;        // country-level target
      if (!pc) return true;                    // known country, unknown province → show
      return pc === targetProvince;
    });
  }

  function resolveBadge(badges, productId, productTags, productCollections, customerCountry, customerProvince) {
    if (!badges || !Array.isArray(badges) || badges.length === 0) return null;

    const activeBadges = badges
      .filter((b) => b.isActive !== false)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));

    const stripGid = (id) => String(id).split("/").pop();
    const geoOk = (badge) => matchesGeo(badge, customerCountry, customerProvince);

    // 1. Specific product + geo
    for (const badge of activeBadges) {
      if (badge.targetType === "specific") {
        const ids = (badge.productIds || []).map((p) => stripGid(typeof p === "object" ? p.id : p));
        if (ids.includes(String(productId)) && geoOk(badge)) return badge;
      }
    }

    // 2. Collection + geo
    for (const badge of activeBadges) {
      if (badge.targetType === "collection") {
        const colIds = (badge.collectionIds || []).map((c) => stripGid(typeof c === "object" ? c.id : c));
        const strippedProductCollections = productCollections.map(stripGid);
        if (colIds.some((id) => strippedProductCollections.includes(id)) && geoOk(badge)) return badge;
      }
    }

    // 3. Tag + geo
    for (const badge of activeBadges) {
      if (badge.targetType === "tag") {
        const badgeTags = badge.tags || [];
        if (badgeTags.some((t) => productTags.includes(t)) && geoOk(badge)) return badge;
      }
    }

    // 4. All products + geo
    for (const badge of activeBadges) {
      if (badge.targetType === "all" && geoOk(badge)) return badge;
    }

    return null;
  }

  // ─── Config/rule resolution ───────────────────────────────────────────────

  function resolveRule(config, rules, productId, variantId, productTags, productCollections) {
    const def = {
      processingDays: parseInt(config.processingDays || "1", 10),
      shippingDaysMin: parseInt(config.shippingDaysMin || "3", 10),
      shippingDaysMax: parseInt(config.shippingDaysMax || "7", 10),
    };

    if (!rules || !Array.isArray(rules)) return def;

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

  // ─── Core render ──────────────────────────────────────────────────────────

  function renderWidget(config, rules, badges, productId, variantId, customerCountry, customerProvince) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    const msgEl = widget.querySelector(".arrively-message");
    const iconEl = widget.querySelector(".arrively-icon");
    if (!msgEl) return;

    const productTags = (widget.dataset.productTags || "").split(",").map((t) => t.trim()).filter(Boolean);
    const productCollections = (widget.dataset.productCollections || "").split(",").map((c) => c.trim()).filter(Boolean);

    const badge = resolveBadge(badges, productId, productTags, productCollections, customerCountry, customerProvince);

    const displayStyle = (badge && badge.displayStyle) || "outlined";
    const iconChar = badge && badge.icon !== undefined ? badge.icon : (config.showTruckIcon !== false ? "🚚" : "");
    const accentColor = (badge && badge.accentColor) || config.accentColor || "#2C6ECB";
    const template = (badge && badge.messageTemplate) || config.messageTemplate || "Estimated delivery: {date_start} – {date_end}";

    let windowConfig = config;
    if (badge && badge.processingDays !== null && badge.processingDays !== undefined) {
      windowConfig = { ...config, processingDays: badge.processingDays, shippingDaysMin: badge.shippingDaysMin, shippingDaysMax: badge.shippingDaysMax };
    }
    const rule = resolveRule(windowConfig, rules, productId, variantId, productTags, productCollections);

    const now = new Date();
    const cutoffHour = parseInt(config.cutoffHour || "14", 10);
    const processingStart = new Date(now);
    if (now.getHours() >= cutoffHour) processingStart.setDate(processingStart.getDate() + 1);

    const excludeWeekends = config.excludeWeekends !== false;
    const holidays = config.holidays || [];

    let shippedDate = processingStart;
    if (rule.processingDays > 0) {
      shippedDate = addBusinessDays(processingStart, rule.processingDays, excludeWeekends, holidays);
    }

    const deliveryStart = addBusinessDays(shippedDate, rule.shippingDaysMin, excludeWeekends, holidays);
    const deliveryEnd = addBusinessDays(shippedDate, rule.shippingDaysMax, excludeWeekends, holidays);

    const dateRange = formatDate(deliveryStart) + "\u2013" + formatDate(deliveryEnd);
    const message = template
      .replace("{date_range}", dateRange)
      .replace("{date_start}", formatDate(deliveryStart))
      .replace("{date_end}", formatDate(deliveryEnd));

    msgEl.textContent = message;

    if (iconEl) {
      if (iconChar) { iconEl.textContent = iconChar; iconEl.style.display = ""; }
      else { iconEl.style.display = "none"; }
    }

    widget.style.setProperty("--arrively-accent", accentColor);
    widget.className = "arrively-widget arrively-style-" + displayStyle;
    widget.style.display = "";
  }

  // ─── Re-render helper (uses module state) ────────────────────────────────

  function rerender() {
    renderWidget(_s.config, _s.rules, _s.badges, _s.productId, _s.variantId, _s.country, _s.province);
  }

  // ─── Variant change listener ──────────────────────────────────────────────

  function watchVariants() {
    document.addEventListener("variant:change", function(e) {
      const variantId = e.detail && e.detail.variant && e.detail.variant.id;
      if (variantId) { _s.variantId = variantId; rerender(); }
    });

    document.querySelectorAll('select[name="id"], input[name="id"]').forEach(function(el) {
      el.addEventListener("change", function() {
        _s.variantId = el.value; rerender();
      });
    });
  }

  // ─── Amazon-style location bar ────────────────────────────────────────────

  /**
   * Returns human-readable location label: "Los Angeles, CA", "Ontario, CA", "United States", etc.
   */
  function locationLabel(city, province, country) {
    if (city && province) return city + ", " + province;
    if (city && country) return city + ", " + country;
    if (province && country) return province + ", " + country;
    if (country) {
      // Expand common ISO codes to readable names
      const names = {
        US: "United States", CA: "Canada", GB: "United Kingdom",
        AU: "Australia", DE: "Germany", FR: "France", NL: "Netherlands",
        MX: "Mexico", BR: "Brazil", IN: "India", JP: "Japan",
      };
      return names[country] || country;
    }
    return null;
  }

  /**
   * Build and attach the location bar below the delivery message.
   * Only called when geo targeting is active.
   */
  function initLocationBar(widget) {
    // Don't double-create
    if (widget.querySelector(".arrively-location-bar")) return;

    const bar = document.createElement("div");
    bar.className = "arrively-location-bar";
    bar.innerHTML =
      '<span class="arrively-location-pin" aria-hidden="true">📍</span>' +
      '<span class="arrively-location-text"></span>' +
      '<button class="arrively-change-btn" type="button">Change</button>' +
      '<span class="arrively-postal-form" style="display:none">' +
        '<input class="arrively-postal-input" type="text" placeholder="ZIP / postal code" maxlength="10" autocomplete="postal-code" aria-label="Enter your postal code">' +
        '<button class="arrively-postal-submit" type="button">Apply</button>' +
        '<button class="arrively-postal-cancel" type="button" aria-label="Cancel">✕</button>' +
      '</span>';

    widget.appendChild(bar);

    const textEl = bar.querySelector(".arrively-location-text");
    const changeBtn = bar.querySelector(".arrively-change-btn");
    const postalForm = bar.querySelector(".arrively-postal-form");
    const postalInput = bar.querySelector(".arrively-postal-input");
    const submitBtn = bar.querySelector(".arrively-postal-submit");
    const cancelBtn = bar.querySelector(".arrively-postal-cancel");

    function showForm() {
      postalForm.style.display = "";
      changeBtn.style.display = "none";
      textEl.style.display = "none";
      bar.querySelector(".arrively-location-pin").style.display = "none";
      postalInput.focus();
    }

    function hideForm() {
      postalForm.style.display = "none";
      changeBtn.style.display = "";
      textEl.style.display = "";
      bar.querySelector(".arrively-location-pin").style.display = "";
    }

    function applyPostal() {
      const val = postalInput.value.trim();
      if (!val) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "…";

      fetchPostalGeo(val, _s.country, function(geo) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Apply";

        if (!geo) {
          postalInput.classList.add("arrively-postal-error");
          postalInput.placeholder = "Not found — try again";
          postalInput.value = "";
          postalInput.focus();
          return;
        }

        postalInput.classList.remove("arrively-postal-error");

        // Update state
        _s.country = geo.country || _s.country;
        _s.province = geo.province || null;
        _s.city = geo.city || null;

        // Persist across pages (like Amazon)
        saveLocation({
          country: _s.country,
          province: _s.province,
          city: _s.city,
          postal: geo.postal,
          _ts: Date.now(),
        });

        updateLocationBarText(textEl, _s.city, _s.province, _s.country);
        hideForm();
        rerender();
      });
    }

    changeBtn.addEventListener("click", showForm);
    cancelBtn.addEventListener("click", function() {
      postalInput.classList.remove("arrively-postal-error");
      postalInput.value = "";
      hideForm();
    });
    submitBtn.addEventListener("click", applyPostal);
    postalInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") applyPostal();
      if (e.key === "Escape") { postalInput.value = ""; hideForm(); }
    });

    // Set initial text
    updateLocationBarText(textEl, _s.city, _s.province, _s.country);
  }

  function updateLocationBarText(textEl, city, province, country) {
    if (!textEl) return;
    const label = locationLabel(city, province, country);
    if (label) {
      textEl.textContent = "Delivering to " + label + " · ";
    } else {
      textEl.textContent = "Set your location · ";
    }
  }

  // ─── Placement ───────────────────────────────────────────────────────────

  function placeWidget(widget) {
    const manualSel = (widget.dataset.manualSelector || "").trim();
    if (manualSel) {
      try {
        const target = document.querySelector(manualSel);
        if (target && target.parentNode) { target.parentNode.insertBefore(widget, target); return; }
      } catch (_e) {}
    }

    const insertionSelectors = [
      ".product-form__buttons",          // Dawn, Sense, Craft, Refresh
      "buy-buttons",                     // Dawn 2.0+ web component
      ".product-purchase",               // Impulse / Turbo
      ".product-purchase-button",
      ".product__payment-button-set",    // Pipeline / Broadcast
      ".product-form__actions",
      ".purchase-info__actions",         // Prestige
      ".product-form__item--submit",     // Debut / Brooklyn / Simple
      ".product-form .product-form__controls-group--submit",
      ".product-single-form .product-form__controls-group", // Narrative
      ".product-single__add-to-cart",    // Expanse / Gecko / Parallax
      ".shopify-payment-button",
      'form[action*="/cart/add"] .product-form__buttons',
      'form[action*="/cart/add"] [type="submit"]',
      ".product-form",
      "product-form",
    ];

    for (const sel of insertionSelectors) {
      const target = document.querySelector(sel);
      if (target && target.parentNode) { target.parentNode.insertBefore(widget, target); return; }
    }
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────

  function init() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    placeWidget(widget);

    try { _s.config = JSON.parse(widget.dataset.config || "{}"); } catch { _s.config = {}; }
    try { _s.rules = JSON.parse(widget.dataset.rules || "[]"); } catch { _s.rules = []; }
    try {
      const raw = widget.dataset.badges;
      _s.badges = raw ? JSON.parse(raw) : [];
    } catch { _s.badges = []; }

    _s.productId = widget.dataset.productId;

    // Base geo from Liquid (Shopify/Cloudflare GeoIP for anonymous visitors)
    _s.country = (widget.dataset.customerCountry || "").trim().toUpperCase() || null;
    _s.province = (widget.dataset.customerProvince || "").trim().toUpperCase() || null;
    _s.city = null;

    // Check if any badge has geo targeting (determines whether to show location bar)
    const hasGeoTargeting = (_s.badges || []).some(function(b) {
      return b.geoTargetType === "specific" && (b.geoTargets || []).length > 0;
    });

    // Resolve variant
    const variantSelect = document.querySelector('select[name="id"]');
    const variantRadio = document.querySelector('input[name="id"]:checked');
    _s.variantId = variantSelect
      ? variantSelect.value
      : variantRadio
      ? variantRadio.value
      : widget.dataset.variants
      ? JSON.parse(widget.dataset.variants || "[]")[0]
      : null;

    // Check for user-saved postal location (like Amazon's "Deliver to" persistence)
    const saved = getSavedLocation();
    if (saved && saved.country) {
      _s.country = saved.country;
      _s.province = saved.province || null;
      _s.city = saved.city || null;
    }

    // Initial render
    rerender();
    watchVariants();

    // Show location bar for geo-targeted stores
    if (hasGeoTargeting) {
      initLocationBar(widget);
    }

    // IP geo lookup: only if no saved postal AND (province is unknown AND province targeting exists)
    if (!saved && !_s.province) {
      const hasProvinceTargeting = (_s.badges || []).some(function(b) {
        return b.geoTargetType === "specific" && (b.geoTargets || []).some(function(t) { return t.indexOf("-") !== -1; });
      });

      if (hasProvinceTargeting) {
        fetchIpGeo(function(geo) {
          if (!geo) return;
          const countryChanged = geo.country && geo.country !== _s.country;
          const provinceAdded = geo.province && !_s.province;
          if (countryChanged || provinceAdded) {
            _s.country = geo.country || _s.country;
            _s.province = geo.province || _s.province;
            _s.city = geo.city || _s.city;
            rerender();

            // Update location bar text if it exists
            const textEl = widget.querySelector(".arrively-location-text");
            if (textEl) updateLocationBarText(textEl, _s.city, _s.province, _s.country);
          }
        });
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
