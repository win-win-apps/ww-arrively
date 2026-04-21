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
    zones: [],
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

    // Priority order wins. First matching badge (by priority) is returned.
    for (const badge of activeBadges) {
      if (!geoOk(badge)) continue;

      if (badge.targetType === "all") return badge;

      if (badge.targetType === "specific") {
        const ids = (badge.productIds || []).map((p) => stripGid(typeof p === "object" ? p.id : p));
        if (ids.includes(String(productId))) return badge;
      }

      if (badge.targetType === "collection") {
        const colIds = (badge.collectionIds || []).map((c) => stripGid(typeof c === "object" ? c.id : c));
        const strippedProductCollections = productCollections.map(stripGid);
        if (colIds.some((id) => strippedProductCollections.includes(id))) return badge;
      }

      if (badge.targetType === "tag") {
        const badgeTags = badge.tags || [];
        if (badgeTags.some((t) => productTags.includes(t))) return badge;
      }
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

  // ─── Zone matching ────────────────────────────────────────────────────────

  /**
   * Find the best matching zone for a customer's location.
   * Falls back to the zone with id "fallback" if no geo match.
   * zones = array of SavedZone objects from the $app:zones metafield.
   */
  function matchZone(zones, customerCountry, customerProvince) {
    if (!zones || !Array.isArray(zones) || zones.length === 0) return null;

    var cc = (customerCountry || "").toUpperCase();
    var pc = (customerProvince || "").toUpperCase();

    // Try province-level match first, then country-level
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (!z.enabled || z.id === "fallback") continue;
      var codes = z.geoCodes || [];
      for (var j = 0; j < codes.length; j++) {
        var parts = codes[j].split("-");
        var zCountry = parts[0].toUpperCase();
        var zProvince = parts.length > 1 ? parts.slice(1).join("-").toUpperCase() : null;
        if (zCountry === cc) {
          if (zProvince && pc && zProvince === pc) return z;
          if (!zProvince) return z;
        }
      }
    }

    // Fall back to the "fallback" zone
    for (var k = 0; k < zones.length; k++) {
      if (zones[k].id === "fallback" && zones[k].enabled) return zones[k];
    }
    return null;
  }

  // ─── SVG icon library (matches admin BadgeIcon) ──────────────────────────

  var ICON_SVGS = {
    truck: '<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16V6h11v10"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></g></svg>',
    box: '<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4"/><path d="M12 21V11"/></g></svg>',
    timer: '<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M10 2h4"/></g></svg>',
    check: '<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-5"/></g></svg>',
    calendar: '<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/></g></svg>',
    bolt: '<svg width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function iconSvg(name, size, color) {
    var tpl = ICON_SVGS[name];
    if (!tpl) return "";
    return tpl.replace(/SIZE/g, String(size)).replace(/COLOR/g, color);
  }

  // ─── Core render ──────────────────────────────────────────────────────────

  function renderWidget(config, rules, badges, productId, variantId, customerCountry, customerProvince) {
    var widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    var msgEl = widget.querySelector(".arrively-message");
    var iconEl = widget.querySelector(".arrively-icon");
    if (!msgEl) return;

    var productTags = (widget.dataset.productTags || "").split(",").map(function(t) { return t.trim(); }).filter(Boolean);
    var productCollections = (widget.dataset.productCollections || "").split(",").map(function(c) { return c.trim(); }).filter(Boolean);

    var badge = resolveBadge(badges, productId, productTags, productCollections, customerCountry, customerProvince);

    var displayStyle = (badge && badge.displayStyle) || "card";
    var iconName = badge && badge.icon !== undefined ? badge.icon : "truck";
    var accentColor = (badge && badge.accentColor) || config.accentColor || "#2C6ECB";
    var textColor = (badge && badge.textColor) || "#FFFFFF";
    var template = (badge && badge.messageTemplate) || config.messageTemplate || "Get it {date_range}";

    var windowConfig = config;
    if (badge && badge.processingDays !== null && badge.processingDays !== undefined) {
      windowConfig = Object.assign({}, config, { processingDays: badge.processingDays, shippingDaysMin: badge.shippingDaysMin, shippingDaysMax: badge.shippingDaysMax });
    }
    var rule = resolveRule(windowConfig, rules, productId, variantId, productTags, productCollections);

    var now = new Date();
    var cutoffHour = parseInt(config.cutoffHour || "14", 10);
    var processingStart = new Date(now);
    if (now.getHours() >= cutoffHour) processingStart.setDate(processingStart.getDate() + 1);

    var excludeWeekends = config.excludeWeekends !== false;
    var holidays = config.holidays || [];

    var shippedDate = processingStart;
    if (rule.processingDays > 0) {
      shippedDate = addBusinessDays(processingStart, rule.processingDays, excludeWeekends, holidays);
    }

    var deliveryStart = addBusinessDays(shippedDate, rule.shippingDaysMin, excludeWeekends, holidays);
    var deliveryEnd = addBusinessDays(shippedDate, rule.shippingDaysMax, excludeWeekends, holidays);

    var dateRange = formatDate(deliveryStart) + " - " + formatDate(deliveryEnd);

    // ── Express dates from zone data ──
    var expressStartStr = "";
    var expressEndStr = "";
    var zone = matchZone(_s.zones, customerCountry, customerProvince);
    if (zone && zone.expressEnabled) {
      var expMin = parseInt(zone.expressDaysMin || "0", 10);
      var expMax = parseInt(zone.expressDaysMax || "0", 10);
      if (expMin > 0 && expMax > 0) {
        var expStart = addBusinessDays(shippedDate, expMin, excludeWeekends, holidays);
        var expEnd = addBusinessDays(shippedDate, expMax, excludeWeekends, holidays);
        expressStartStr = formatDate(expStart);
        expressEndStr = formatDate(expEnd);
      }
    }

    function replaceDates(tpl) {
      return tpl
        .replace(/\{date_range\}/g, dateRange)
        .replace(/\{date_start\}/g, formatDate(deliveryStart))
        .replace(/\{date_end\}/g, formatDate(deliveryEnd))
        .replace(/\{express_start\}/g, expressStartStr)
        .replace(/\{express_end\}/g, expressEndStr);
    }

    var message = replaceDates(template);

    // ── Sub-message ──
    var subMessageTemplate = badge ? (badge.subMessage || "") : "Or get it by {express_end} with Express";
    var subMessageIconName = badge ? (badge.subMessageIcon || "") : "bolt";
    var subMessageText = subMessageTemplate ? replaceDates(subMessageTemplate) : "";

    // ── Preview mode: no badges configured yet ──
    var isPreview = !badge;

    // Card style renders rich markup (label + headline w/ highlighted date + subtext);
    // all other styles render plain text message.
    if (displayStyle === "card") {
      var labelText = isPreview ? "This is a preview" : ((badge && badge.badgeText) || (badge && badge.cardLabel) || "Delivery");
      // Build headline with highlighted date portion
      var dateText = dateRange;
      var headlineParts = message.split(dateText);
      var headlineHtml = headlineParts.length === 2
        ? headlineParts[0] + '<span class="arrively-card-date">' + dateText + '</span>' + headlineParts[1]
        : message;

      var subHtml = "";
      if (subMessageText) {
        var subIconColor = isPreview ? "#6b7280" : (textColor + "99");
        var subIconHtml = subMessageIconName ? iconSvg(subMessageIconName, 12, subIconColor) : "";
        subHtml = '<span class="arrively-card-subtext">' +
          (subIconHtml ? '<span style="vertical-align:middle;margin-right:4px;display:inline-block">' + subIconHtml + '</span>' : '') +
          subMessageText + '</span>';
      }

      // Build icon HTML for inline use (icon sits next to headline, NOT next to label)
      var cardIconHtml = "";
      if (iconName && ICON_SVGS[iconName]) {
        cardIconHtml = '<span class="arrively-card-icon">' + iconSvg(iconName, 22, accentColor) + '</span>';
      }

      msgEl.innerHTML =
        '<span class="arrively-card-label">' + labelText + '</span>' +
        '<span class="arrively-card-body">' +
          cardIconHtml +
          '<span class="arrively-card-text">' +
            '<span class="arrively-card-headline">' + headlineHtml + '</span>' +
            subHtml +
          '</span>' +
        '</span>';

      // Hide the old outer icon element for card style
      if (iconEl) { iconEl.style.display = "none"; }
    } else {
      // Simple / outlined / filled / pill / minimal styles
      var mainHtml = "";
      if (iconName && ICON_SVGS[iconName]) {
        mainHtml += '<span style="display:inline-flex;vertical-align:middle;margin-right:4px">' + iconSvg(iconName, 14, "currentColor") + '</span>';
      }
      mainHtml += '<span>' + message + '</span>';

      if (subMessageText) {
        var subIc = subMessageIconName ? '<span style="display:inline-flex;vertical-align:middle;margin-right:3px">' + iconSvg(subMessageIconName, 11, "currentColor") + '</span>' : '';
        mainHtml += '<br><span class="arrively-sub-message">' + subIc + subMessageText + '</span>';
      }

      msgEl.innerHTML = mainHtml;

      if (iconEl) { iconEl.style.display = "none"; }
    }

    widget.style.setProperty("--arrively-accent", accentColor);
    var alignClass = config.textAlign && config.textAlign !== "left" ? " arrively-align-" + config.textAlign : " arrively-align-left";
    widget.className = "arrively-widget arrively-style-" + displayStyle + (isPreview ? " arrively-preview" : "") + alignClass;
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
        if (target && target.parentNode) { target.parentNode.insertBefore(widget, target); return true; }
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
      if (target && target.parentNode) { target.parentNode.insertBefore(widget, target); return true; }
    }

    // Fallback: couldn't find a placement target (e.g. in theme editor).
    // Just leave the widget where it is - it'll render in place.
    return false;
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────

  function init() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    placeWidget(widget);

    try { _s.config = JSON.parse(widget.dataset.config || "{}") || {}; } catch(e) { _s.config = {}; }
    try { _s.rules = JSON.parse(widget.dataset.rules || "[]") || []; } catch(e) { _s.rules = []; }
    try {
      var badgesRaw = widget.dataset.badges;
      _s.badges = badgesRaw ? JSON.parse(badgesRaw) : [];
    } catch(e) { _s.badges = []; }
    try {
      var zonesRaw = widget.dataset.zones;
      _s.zones = zonesRaw ? JSON.parse(zonesRaw) : [];
    } catch(e) { _s.zones = []; }

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

  function tryInit() {
    if (document.getElementById(WIDGET_ID)) {
      init();
    } else {
      // Theme editor injects app embed HTML dynamically after DOMContentLoaded.
      // Poll briefly so the widget shows in the dirty/unsaved state.
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        if (document.getElementById(WIDGET_ID)) {
          clearInterval(poll);
          init();
        } else if (attempts > 50) { // give up after ~5 seconds
          clearInterval(poll);
        }
      }, 100);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    tryInit();
  }
})();
