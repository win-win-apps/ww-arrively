import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Select,
  BlockStack,
  InlineStack,
  Text,
  Tabs,
  ColorPicker,
  Popover,
  hsbToHex,
  hexToRgb,
  rgbToHsb,
  Divider,
  Box,
  InlineGrid,
  Tag,
  Banner,
} from "@shopify/polaris";
import { useState, useCallback, useEffect, useRef } from "react";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import type { DeliveryBadge, ZoneConfig } from "./app.badges._index";
import { GEO_REGIONS, COUNTRY_ONLY } from "../lib/geo-regions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Parse HH:MM → minutes since midnight, or null if invalid
function parseCutoff(s?: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Figure out if today counts as a shipping day based on cutoff
function cutoffDayOffset(cutoff?: string | null): number {
  const c = parseCutoff(cutoff);
  if (c == null) return 0; // no cutoff → ship today
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin < c ? 0 : 1;
}

function getExampleDates(minShip?: string | number, maxShip?: string | number, cutoff?: string | null) {
  const sMin = Number(minShip ?? 3);
  const sMax = Number(maxShip ?? 7);
  const mn = Number.isFinite(sMin) && sMin >= 0 ? sMin : 3;
  const mx = Number.isFinite(sMax) && sMax >= mn ? sMax : Math.max(mn, 7);
  const offset = cutoffDayOffset(cutoff);
  const now = new Date();
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { start: fmt(addDays(now, offset + mn)), end: fmt(addDays(now, offset + mx)) };
}

function hexToHsb(hex: string) {
  const rgb = hexToRgb(hex) || { red: 44, green: 110, blue: 203 };
  return rgbToHsb(rgb);
}

const ACCENT_COLORS = [
  "#2C6ECB", "#008060", "#E53935", "#FF6F00", "#F9A825",
  "#43A047", "#311B92", "#880E4F", "#000000", "#FFFFFF",
  "#005BD3", "#36B37E", "#FF5733", "#C62828", "#1565C0",
  "#6D7175", "#4E342E", "#00838F", "#6A1B9A", "#D32F2F",
];

// ─── Templates ───────────────────────────────────────────────────────────────

// ─── Zone picker helpers ─────────────────────────────────────────────────────

// Given the methods for a zone, auto-pick standard (free → slowest) and fastest (lowest max days → highest price)
function autoPickMethods(methods: ShippingMethod[]): {
  standard: ShippingMethod | null;
  fastest: ShippingMethod | null;
} {
  const usable = methods.filter((m) => !m.isCalculated); // skip carrier-calculated (no static days)
  if (usable.length === 0) return { standard: null, fastest: null };

  // Standard = the free option. Fallback = the one with the highest parsed max days.
  const free = usable.find((m) => m.priceAmount === 0);
  let standard: ShippingMethod | null = free ?? null;
  if (!standard) {
    const withDays = usable.filter((m) => m.parsedMax != null);
    standard = withDays.length
      ? withDays.reduce((a, b) => ((b.parsedMax! > (a.parsedMax ?? -1) ? b : a)))
      : usable[usable.length - 1];
  }

  // Fastest = lowest parsed max days; fallback = highest price (priced above standard)
  let fastest: ShippingMethod | null = null;
  const withDays = usable.filter((m) => m.parsedMax != null && m.id !== standard!.id);
  if (withDays.length) {
    fastest = withDays.reduce((a, b) => (b.parsedMax! < a.parsedMax! ? b : a));
  } else {
    const priced = usable.filter((m) => m.id !== standard!.id).sort((a, b) => b.priceAmount - a.priceAmount);
    fastest = priced[0] ?? null;
  }

  return { standard, fastest };
}

function zoneToConfig(zone: ShippingZone): ZoneConfig {
  const { standard } = autoPickMethods(zone.methods);
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    countryCodes: zone.countryCodes,
    standardMethodId: standard?.id ?? null,
    standardMethodName: standard?.name ?? "Standard",
    standardMin: standard?.parsedMin?.toString() ?? "3",
    standardMax: standard?.parsedMax?.toString() ?? "7",
    // Fastest is opt-in via the "+ Add secondary note for express" link
    fastestMethodId: null,
    fastestMethodName: "",
    fastestMin: "",
    fastestMax: "",
  };
}

function ZonePicker({
  zones,
  selected,
  onChange,
}: {
  zones: ShippingZone[];
  selected: ZoneConfig[];
  onChange: (z: ZoneConfig[]) => void;
}) {
  const available = zones.filter((z) => !selected.some((s) => s.zoneId === z.id));
  const [showFastest, setShowFastest] = useState<Record<string, boolean>>({});

  const addZone = (zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    onChange([...selected, zoneToConfig(zone)]);
  };

  const removeZone = (zoneId: string) => {
    onChange(selected.filter((s) => s.zoneId !== zoneId));
    setShowFastest((prev) => {
      const next = { ...prev };
      delete next[zoneId];
      return next;
    });
  };

  const updateZone = (zoneId: string, patch: Partial<ZoneConfig>) => {
    onChange(selected.map((s) => (s.zoneId === zoneId ? { ...s, ...patch } : s)));
  };

  if (zones.length === 0) {
    return (
      <Box padding="400" background="bg-surface-secondary" borderRadius="200">
        <Text as="p" variant="bodySm" tone="subdued">
          No delivery zones were found. Set up your zones in the Delivery Zones page first, then come back here.
        </Text>
      </Box>
    );
  }

  return (
    <BlockStack gap="400">
      {selected.length === 0 && (
        <Text as="p" variant="bodySm" tone="subdued">
          Select a zone below to start.
        </Text>
      )}

      {selected.map((cfg) => {
        const zone = zones.find((z) => z.id === cfg.zoneId);
        const methods = zone?.methods ?? [];
        const methodOptions = methods.map((m) => ({
          label: `${m.name}${m.priceAmount === 0 ? " (Free)" : m.isCalculated ? " (Calculated)" : ""}`,
          value: m.id,
        }));

        return (
          <Box key={cfg.zoneId} padding="400" background="bg-surface-secondary" borderRadius="200" borderWidth="025" borderColor="border">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h4" variant="headingSm">{cfg.zoneName}</Text>
                <Button variant="plain" tone="critical" onClick={() => removeZone(cfg.zoneId)}>
                  Remove
                </Button>
              </InlineStack>

              {/* Standard row */}
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="medium">Standard (main estimate)</Text>
                <InlineGrid columns={{ xs: "1fr", md: "2fr 1fr 1fr" }} gap="200">
                  <Box />
                  <Text as="p" variant="bodySm" tone="subdued">Min days</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Max days</Text>
                </InlineGrid>
                <InlineGrid columns={{ xs: "1fr", md: "2fr 1fr 1fr" }} gap="200">
                  <Select
                    label="Standard method"
                    labelHidden
                    options={methodOptions}
                    value={cfg.standardMethodId ?? ""}
                    onChange={(v) => {
                      const m = methods.find((mm) => mm.id === v);
                      updateZone(cfg.zoneId, {
                        standardMethodId: v || null,
                        standardMethodName: m?.name ?? "Standard",
                        standardMin: m?.parsedMin?.toString() ?? "3",
                        standardMax: m?.parsedMax?.toString() ?? "7",
                      });
                    }}
                  />
                  <TextField
                    label="Min days"
                    labelHidden
                    placeholder="Min"
                    type="number"
                    min="0"
                    value={cfg.standardMin}
                    onChange={(v) => updateZone(cfg.zoneId, { standardMin: v })}
                    autoComplete="off"
                  />
                  <TextField
                    label="Max days"
                    labelHidden
                    placeholder="Max"
                    type="number"
                    min="0"
                    value={cfg.standardMax}
                    onChange={(v) => updateZone(cfg.zoneId, { standardMax: v })}
                    autoComplete="off"
                  />
                </InlineGrid>
              </BlockStack>

              {/* Fastest row — only show if toggled on or already has a value */}
              {(showFastest[cfg.zoneId] || cfg.fastestMethodId) ? (
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodySm" fontWeight="medium">Express / fastest (subtext)</Text>
                    <Button
                      variant="plain"
                      onClick={() => {
                        updateZone(cfg.zoneId, {
                          fastestMethodId: null,
                          fastestMethodName: "",
                          fastestMin: "",
                          fastestMax: "",
                        });
                        setShowFastest((prev) => ({ ...prev, [cfg.zoneId]: false }));
                      }}
                    >
                      Remove
                    </Button>
                  </InlineStack>
                  <InlineGrid columns={{ xs: "1fr", md: "2fr 1fr 1fr" }} gap="200">
                    <Select
                      label="Fastest method"
                      labelHidden
                      options={methodOptions}
                      value={cfg.fastestMethodId ?? ""}
                      onChange={(v) => {
                        const m = methods.find((mm) => mm.id === v);
                        updateZone(cfg.zoneId, {
                          fastestMethodId: v || null,
                          fastestMethodName: m?.name ?? "",
                          fastestMin: m?.parsedMin?.toString() ?? "1",
                          fastestMax: m?.parsedMax?.toString() ?? "2",
                        });
                      }}
                    />
                    <TextField
                      label="Min days"
                      labelHidden
                      placeholder="Min"
                      type="number"
                      min="0"
                      value={cfg.fastestMin}
                      onChange={(v) => updateZone(cfg.zoneId, { fastestMin: v })}
                      autoComplete="off"
                      disabled={!cfg.fastestMethodId}
                    />
                    <TextField
                      label="Max days"
                      labelHidden
                      placeholder="Max"
                      type="number"
                      min="0"
                      value={cfg.fastestMax}
                      onChange={(v) => updateZone(cfg.zoneId, { fastestMax: v })}
                      autoComplete="off"
                      disabled={!cfg.fastestMethodId}
                    />
                  </InlineGrid>
                </BlockStack>
              ) : (
                <Button
                  variant="plain"
                  onClick={() => {
                    // Auto-pick the fastest non-standard method: lowest parsed max days wins,
                    // then fall back to any non-standard method so fields always get a selection.
                    const nonStandard = methods.filter((m) => m.id !== cfg.standardMethodId);
                    const withDays = nonStandard.filter((m) => m.parsedMax != null);
                    const fastest = withDays.length
                      ? withDays.sort((a, b) => (a.parsedMax ?? 999) - (b.parsedMax ?? 999))[0]
                      : nonStandard[0];
                    if (fastest) {
                      updateZone(cfg.zoneId, {
                        fastestMethodId: fastest.id,
                        fastestMethodName: fastest.name,
                        fastestMin: fastest.parsedMin?.toString() ?? "1",
                        fastestMax: fastest.parsedMax?.toString() ?? "2",
                      });
                    }
                    setShowFastest((prev) => ({ ...prev, [cfg.zoneId]: true }));
                  }}
                >
                  Add a secondary speed
                </Button>
              )}
            </BlockStack>
          </Box>
        );
      })}

      {available.length > 0 && (
        <InlineGrid columns={{ xs: 1, sm: 2, md: Math.min(available.length, 4) as 1 | 2 | 3 | 4 }} gap="300">
          {available.map((z) => {
            const countryLabel = z.countryCodes.length
              ? `${z.countryCodes.slice(0, 3).join(", ")}${z.countryCodes.length > 3 ? `, +${z.countryCodes.length - 3}` : ""}`
              : "";
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => addZone(z.id)}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: "1px dashed #c9cccf",
                  background: "#fff",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#2C6ECB";
                  e.currentTarget.style.background = "#f7f6ff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#c9cccf";
                  e.currentTarget.style.background = "#fff";
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "13px", color: "#1a1a1a", marginBottom: countryLabel ? "4px" : 0 }}>
                  {z.name}
                </div>
                {countryLabel && (
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{countryLabel}</div>
                )}
              </button>
            );
          })}
        </InlineGrid>
      )}
    </BlockStack>
  );
}

const BADGE_TEMPLATES = [
  {
    label: "Make my own",
    nameBase: "My Delivery Badge",
    displayStyle: "card" as const,
    icon: "",
    messageTemplate: "Get it {date_range}",
    accentColor: "#2C6ECB",
    blank: true,
  },
  {
    label: "Premium Card",
    nameBase: "Premium Delivery Card",
    displayStyle: "card" as const,
    icon: "",
    messageTemplate: "Get it {date_range}",
    accentColor: "#2C6ECB",
  },
  {
    label: "Standard",
    nameBase: "Standard Delivery",
    displayStyle: "simple" as const,
    icon: "truck",
    messageTemplate: "Delivery: {date_start} - {date_end}",
    accentColor: "#2C6ECB",
    simpleBgTransparent: true,
    simpleBorderColor: "#2C6ECB",
    simpleRounding: "rounded" as const,
  },
  {
    label: "Free ship",
    nameBase: "Free Shipping",
    displayStyle: "simple" as const,
    icon: "truck",
    messageTemplate: "Free delivery by {date_end}",
    accentColor: "#008060",
    simpleBgTransparent: false,
    simpleBorderColor: "",
    simpleRounding: "rounded" as const,
  },
  {
    label: "Express",
    nameBase: "Express Delivery",
    displayStyle: "simple" as const,
    icon: "bolt",
    messageTemplate: "Express: {date_start} - {date_end}",
    accentColor: "#E53935",
    simpleBgTransparent: false,
    simpleBorderColor: "",
    simpleRounding: "pill" as const,
  },
  {
    label: "Minimal",
    nameBase: "Minimal Badge",
    displayStyle: "simple" as const,
    icon: "box",
    messageTemplate: "Ships {date_start} - {date_end}",
    accentColor: "#6D7175",
    simpleBgTransparent: true,
    simpleBorderColor: "",
    simpleRounding: "none" as const,
  },
];

// ─── Loader ──────────────────────────────────────────────────────────────────

// ─── Shipping zone types (from delivery profiles) ──────────────────────────
export type ShippingMethod = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: number; // 0 for free
  isCalculated: boolean; // true for carrier-calculated (Canada Post etc.)
  parsedMin: number | null; // autodetected from name/description
  parsedMax: number | null;
};
export type ShippingZone = {
  id: string;
  name: string;
  countryCodes: string[];
  methods: ShippingMethod[];
};

// Parse "3-9 business days", "5 days", etc. from a string
function parseDaysFromString(s: string | null | undefined): { min: number | null; max: number | null } {
  if (!s) return { min: null, max: null };
  // Try range: "3-5 days", "2 to 4 working days", "1–2 business days" etc.
  const range = s.match(/(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})\s*(?:business|working|biz)?\s*days?/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  // Try single: "5 days", "3 business days"
  const single = s.match(/(\d{1,3})\s*(?:business|working|biz)?\s*days?/i);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return { min: null, max: null };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const res = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafield(namespace: "$app", key: "badges") { value }
      }
    }
  `);
  const data = await res.json();
  const raw = data?.data?.currentAppInstallation?.metafield?.value;
  let badges: DeliveryBadge[] = [];
  try { badges = JSON.parse(raw || "[]"); } catch { badges = []; }

  // Fetch shipping zones from delivery profiles
  let shippingZones: ShippingZone[] = [];
  try {
    const zonesRes = await admin.graphql(`
      query {
        deliveryProfiles(first: 10) {
          nodes {
            id
            name
            default
            profileLocationGroups {
              locationGroupZones(first: 25) {
                nodes {
                  zone {
                    id
                    name
                    countries { code { countryCode } }
                  }
                  methodDefinitions(first: 25) {
                    nodes {
                      id
                      name
                      description
                      active
                      rateProvider {
                        __typename
                        ... on DeliveryRateDefinition { id price { amount } }
                        ... on DeliveryParticipant { id carrierService { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    const zd = await zonesRes.json();
    const seen = new Set<string>();
    const profiles = zd?.data?.deliveryProfiles?.nodes ?? [];
    for (const p of profiles) {
      const groups = p?.profileLocationGroups ?? [];
      for (const g of groups) {
        const zoneNodes = g?.locationGroupZones?.nodes ?? [];
        for (const zn of zoneNodes) {
          const z = zn?.zone;
          if (!z || seen.has(z.id)) continue;
          seen.add(z.id);
          const countryCodes = (z.countries ?? [])
            .map((c: any) => c?.code?.countryCode)
            .filter(Boolean);
          const methodNodes = zn?.methodDefinitions?.nodes ?? [];
          const methods: ShippingMethod[] = methodNodes
            .filter((m: any) => m?.active !== false)
            .map((m: any) => {
              const rp = m?.rateProvider;
              const isCalculated = rp?.__typename === "DeliveryParticipant";
              const priceAmount = isCalculated
                ? -1
                : Number(rp?.price?.amount ?? 0);
              const parsed = parseDaysFromString(`${m?.name ?? ""} ${m?.description ?? ""}`);
              return {
                id: m.id,
                name: m.name || "Shipping",
                description: m.description ?? null,
                priceAmount,
                isCalculated,
                parsedMin: parsed.min,
                parsedMax: parsed.max,
              };
            });
          shippingZones.push({
            id: z.id,
            name: z.name,
            countryCodes,
            methods,
          });
        }
      }
    }
  } catch (e) {
    // Missing read_shipping scope or other error — continue without zones
    shippingZones = [];
  }

  // Fetch saved zones from metafield
  let savedZones: any[] = [];
  try {
    const zonesRes = await admin.graphql(`
      query {
        currentAppInstallation {
          metafield(namespace: "$app", key: "zones") { value }
        }
      }
    `);
    const zonesData = await zonesRes.json();
    const raw = zonesData?.data?.currentAppInstallation?.metafield?.value;
    if (raw) {
      savedZones = JSON.parse(raw);
    }
  } catch {
    savedZones = [];
  }

  const { id } = params;
  if (id === "new") {
    return json({ badge: null, isNew: true, appInstallationId: data.data.currentAppInstallation.id, shippingZones, savedZones });
  }

  const badge = badges.find((b) => b.id === id) || null;
  if (!badge) return redirect("/app/badges");
  return json({ badge, isNew: false, appInstallationId: data.data.currentAppInstallation.id, badges, shippingZones, savedZones });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const res = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafield(namespace: "$app", key: "badges") { value }
      }
    }
  `);
  const data = await res.json();
  const raw = data?.data?.currentAppInstallation?.metafield?.value;
  let badges: DeliveryBadge[] = [];
  try { badges = JSON.parse(raw || "[]"); } catch { badges = []; }
  const installId = data.data.currentAppInstallation.id;

  if (intent === "save") {
    const badgeJson = formData.get("badge") as string;
    const incoming: DeliveryBadge = JSON.parse(badgeJson);

    if (params.id === "new") {
      incoming.id = generateId();
      incoming.priority = badges.length;
      badges.push(incoming);
    } else {
      const idx = badges.findIndex((b) => b.id === params.id);
      if (idx !== -1) badges[idx] = { ...badges[idx], ...incoming };
      else badges.push(incoming);
    }

    await admin.graphql(
      `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      { variables: { metafields: [{ ownerId: installId, namespace: "$app", key: "badges", value: JSON.stringify(badges), type: "json" }] } }
    );
    return redirect(badges.length === 1 ? "/app" : "/app/badges");
  }

  return json({ ok: true });
}

// ─── Display style options ────────────────────────────────────────────────────

const DISPLAY_STYLES = [
  { value: "card",   label: "Card",   desc: "Rich card with badge label, icon, and accent colours" },
  { value: "simple", label: "Simple", desc: "Lightweight inline badge -- fully customisable" },
] as const;
type DisplayStyle = "card" | "simple";

// Rounding presets for Simple style
const ROUNDING_OPTIONS = [
  { value: "none",    label: "Sharp",   radius: "0" },
  { value: "rounded", label: "Rounded", radius: "8px" },
  { value: "pill",    label: "Pill",    radius: "999px" },
] as const;
type SimpleRounding = "none" | "rounded" | "pill";

// Proprietary single-color icon library. Icons are stroke-based SVGs
// that inherit color from the currentColor CSS property.
const ICON_PATHS: Record<string, React.ReactNode> = {
  truck: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16V6h11v10" />
      <path d="M14 9h4l3 3v4h-7" />
      <circle cx="7.5" cy="17" r="1.8" />
      <circle cx="16.5" cy="17" r="1.8" />
    </g>
  ),
  box: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
      <path d="M3 7l9 4 9-4" />
      <path d="M12 11v10" />
    </g>
  ),
  timer: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 3h6" />
    </g>
  ),
  check: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </g>
  ),
  calendar: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </g>
  ),
  bolt: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
    </g>
  ),
};

function BadgeIcon({ name, size = 18, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ color, display: "block" }} aria-hidden="true">
      {path}
    </svg>
  );
}

const ICONS = [
  { value: "",         label: "None" },
  { value: "truck",    label: "Truck" },
  { value: "box",      label: "Box" },
  { value: "timer",    label: "Timer" },
  { value: "check",    label: "Check" },
  { value: "calendar", label: "Calendar" },
  { value: "bolt",     label: "Express" },
];

// ─── GeoTargetPicker ─────────────────────────────────────────────────────────

function GeoTargetPicker({ selected, onChange }: { selected: string[]; onChange: (codes: string[]) => void }) {
  const [search, setSearch] = useState("");
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(
    () => new Set(selected.map((c) => c.split("-")[0]))
  );

  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);

  const toggleCountry = (countryCode: string, allCodes: string[]) => {
    const allSelected = allCodes.every((c) => selected.includes(c));
    if (allSelected) onChange(selected.filter((c) => !allCodes.includes(c) && c !== countryCode));
    else onChange([...new Set([...selected, ...allCodes])]);
  };

  const toggleExpand = (countryCode: string) => {
    setExpandedCountries((prev) => { const next = new Set(prev); next.has(countryCode) ? next.delete(countryCode) : next.add(countryCode); return next; });
  };

  const q = search.toLowerCase();
  const filteredRegions = GEO_REGIONS.map((c) => ({
    ...c,
    provinces: c.provinces.filter((p) => !q || p.name.toLowerCase().includes(q) || c.countryName.toLowerCase().includes(q)),
  })).filter((c) => !q || c.countryName.toLowerCase().includes(q) || c.provinces.length > 0);
  const filteredCountryOnly = COUNTRY_ONLY.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  const totalSelected = selected.length;

  return (
    <BlockStack gap="300">
      {totalSelected > 0 && (
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">{totalSelected} region{totalSelected !== 1 ? "s" : ""} selected</Text>
          <Button size="slim" variant="plain" tone="critical" onClick={() => onChange([])}>Clear all</Button>
        </InlineStack>
      )}
      <TextField label="" labelHidden placeholder="Search countries and regions…" value={search} onChange={setSearch} autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />
      <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", maxHeight: "320px", overflowY: "auto" }}>
        {filteredRegions.map((country, ci) => {
          const allCodes = country.provinces.map((p) => p.code);
          const selectedCount = allCodes.filter((c) => selected.includes(c)).length;
          const allChecked = allCodes.length > 0 && selectedCount === allCodes.length;
          const someChecked = selectedCount > 0 && selectedCount < allCodes.length;
          const isExpanded = expandedCountries.has(country.countryCode);
          return (
            <div key={country.countryCode} style={{ borderBottom: ci < filteredRegions.length - 1 || filteredCountryOnly.length > 0 ? "1px solid #e1e3e5" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", backgroundColor: "#f6f6f7", cursor: "pointer" }}>
                <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked; }} onChange={() => toggleCountry(country.countryCode, allCodes)} style={{ cursor: "pointer", flexShrink: 0 }} onClick={(e) => e.stopPropagation()} />
                <span style={{ flex: 1, fontWeight: 600, fontSize: "13px" }} onClick={() => toggleExpand(country.countryCode)}>
                  {country.flag} {country.countryName}
                  {selectedCount > 0 && <span style={{ marginLeft: 6, fontSize: "11px", color: "#005bd3", fontWeight: 500 }}>({selectedCount}/{allCodes.length})</span>}
                </span>
                <span style={{ color: "#8c9196", fontSize: "11px" }} onClick={() => toggleExpand(country.countryCode)}>{isExpanded ? "▲" : "▼"}</span>
              </div>
              {isExpanded && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", padding: "8px 14px 12px", backgroundColor: "white" }}>
                  {country.provinces.filter((p) => !q || p.name.toLowerCase().includes(q) || country.countryName.toLowerCase().includes(q)).map((province) => (
                    <label key={province.code} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", cursor: "pointer", fontSize: "12px" }}>
                      <input type="checkbox" checked={selected.includes(province.code)} onChange={() => toggle(province.code)} style={{ cursor: "pointer", flexShrink: 0 }} />
                      {province.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filteredCountryOnly.length > 0 && (
          <div>
            <div style={{ padding: "8px 14px", backgroundColor: "#f6f6f7", fontSize: "11px", fontWeight: 600, color: "#6d7175", letterSpacing: "0.04em", textTransform: "uppercase", borderBottom: "1px solid #e1e3e5" }}>Other countries</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", padding: "8px 14px 12px" }}>
              {filteredCountryOnly.map((country) => (
                <label key={country.code} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", cursor: "pointer", fontSize: "12px" }}>
                  <input type="checkbox" checked={selected.includes(country.code)} onChange={() => toggle(country.code)} style={{ cursor: "pointer", flexShrink: 0 }} />
                  {country.flag} {country.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {filteredRegions.length === 0 && filteredCountryOnly.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "#6d7175", fontSize: "13px" }}>No regions match "{search}"</div>
        )}
      </div>
    </BlockStack>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BadgeEditor() {
  const { badge, isNew, shippingZones, savedZones } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const shopify = useAppBridge();

  // ── Template state ──
  const [templateApplied, setTemplateApplied] = useState(!isNew);
  const showTemplates = false; // skip template picker, go straight to editor

  // ── Form state ──
  const [selectedTab, setSelectedTab] = useState(0);
  const [name, setName] = useState(badge?.name ?? "New delivery badge");
  const [targetType, setTargetType] = useState<DeliveryBadge["targetType"]>(badge?.targetType ?? "all");
  const [productIds, setProductIds] = useState<Array<{ id: string; title: string }>>(badge?.productIds ?? []);
  const [collectionIds, setCollectionIds] = useState<Array<{ id: string; title: string }>>(badge?.collectionIds ?? []);
  const [tags, setTags] = useState<string[]>(badge?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  // Migrate legacy styles (outlined/filled/minimal/pill) → simple with matching sub-options
  const [displayStyle, setDisplayStyle] = useState<DisplayStyle>(() => {
    const raw = badge?.displayStyle ?? "card";
    if (raw === "card" || raw === "simple") return raw;
    return "simple"; // legacy styles become "simple"
  });
  const [simpleBgTransparent, setSimpleBgTransparent] = useState<boolean>(() => {
    const raw = badge?.displayStyle;
    if (badge?.simpleBgTransparent != null) return badge.simpleBgTransparent;
    return raw === "outlined" || raw === "minimal"; // these had transparent bg
  });
  const [simpleBorderColor, setSimpleBorderColor] = useState<string>(() => {
    if (badge?.simpleBorderColor != null) return badge.simpleBorderColor;
    const raw = badge?.displayStyle;
    return raw === "outlined" ? (badge?.accentColor ?? "#2C6ECB") : ""; // "" = no border
  });
  const [simpleRounding, setSimpleRounding] = useState<SimpleRounding>(() => {
    if (badge?.simpleRounding) return badge.simpleRounding;
    const raw = badge?.displayStyle;
    if (raw === "pill") return "pill";
    if (raw === "minimal") return "none";
    return "rounded";
  });
  const [simpleAlign, setSimpleAlign] = useState<"left" | "center" | "right">(badge?.simpleAlign ?? "left");
  const [simpleBorderPickerOpen, setSimpleBorderPickerOpen] = useState(false);
  // Migrate legacy emoji values to "" (unknown icons become None)
  const initialIcon = (() => {
    const v = badge?.icon ?? "truck";
    return v in ICON_PATHS ? v : "truck";
  })();
  const [icon, setIcon] = useState(initialIcon);
  const [iconColor, setIconColor] = useState<string>(badge?.iconColor ?? badge?.accentColor ?? "#2C6ECB");
  const [iconColorPickerOpen, setIconColorPickerOpen] = useState(false);
  const [badgeText, setBadgeText] = useState<string>(badge?.badgeText ?? "Delivery");
  const [messageTemplate, setMessageTemplate] = useState(badge?.messageTemplate ?? "Get it {date_range}");
  const [subMessage, setSubMessage] = useState(badge?.subMessage ?? ((badge?.displayStyle ?? "card") === "card" ? "Or get it by {express_end} with Express" : ""));
  const [subMessageIcon, setSubMessageIcon] = useState(badge?.subMessageIcon ?? "bolt");
  const [messageFontSize, setMessageFontSize] = useState(badge?.messageFontSize ?? 14);
  const [subMessageFontSize, setSubMessageFontSize] = useState(badge?.subMessageFontSize ?? 10);
  const [iconPickerOpen, setIconPickerOpen] = useState<string | null>(null); // "message" | "sub" | null
  const [subMessageOpen, setSubMessageOpen] = useState(!!(badge?.subMessage) || (badge?.displayStyle ?? "card") === "card");
  const [accentColor, setAccentColor] = useState(badge?.accentColor ?? "#2C6ECB");
  const [textColor, setTextColor] = useState(badge?.textColor ?? "#1a1a1a");
  const [backgroundColor, setBackgroundColor] = useState(badge?.backgroundColor ?? "#FFFFFF");
  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);
  const [bgColorPickerOpen, setBgColorPickerOpen] = useState(false);
  const [shippingDaysMin, setShippingDaysMin] = useState(badge?.shippingDaysMin ?? "3");
  const [shippingDaysMax, setShippingDaysMax] = useState(badge?.shippingDaysMax ?? "7");
  const [cutoffTime, setCutoffTime] = useState<string>(badge?.cutoffTime ?? "11:00");
  const [zoneConfigs, setZoneConfigs] = useState<ZoneConfig[]>(badge?.zoneConfigs ?? []);
  const [geoTargetType, setGeoTargetType] = useState<"all" | "specific">(badge?.geoTargetType ?? "all");
  const [geoTargets, setGeoTargets] = useState<string[]>(badge?.geoTargets ?? []);

  // New: zone selection (which zones this badge applies to)
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>(badge?.selectedZoneIds ?? []);
  const [zoneSelectionMode, setZoneSelectionMode] = useState<"all" | "specific">(
    badge?.selectedZoneIds && badge.selectedZoneIds.length > 0 ? "specific" : "all"
  );
  const [previewZoneId, setPreviewZoneId] = useState<string>(
    savedZones.length > 0 ? savedZones[0].id : "fallback"
  );
  const [zoneSearchQuery, setZoneSearchQuery] = useState("");

  // ── Color picker state ──
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [accentHsb, setAccentHsb] = useState(hexToHsb(accentColor));
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const addToRecent = useCallback((hex: string) => {
    const n = hex.toUpperCase();
    setRecentColors((prev) => [n, ...prev.filter((c) => c.toUpperCase() !== n)].slice(0, 10));
  }, []);

  // ── Template application ──
  const applyTemplate = (t: typeof BADGE_TEMPLATES[0]) => {
    setDisplayStyle(t.displayStyle);
    setIcon(t.icon);
    setIconColor(t.accentColor);
    setBadgeText("Delivery");
    setMessageTemplate(t.messageTemplate);
    setAccentColor(t.accentColor);
    setAccentHsb(hexToHsb(t.accentColor));
    setTextColor("#1a1a1a");
    setBackgroundColor("#FFFFFF");
    // Apply simple options from template
    setSimpleBgTransparent((t as any).simpleBgTransparent ?? false);
    setSimpleBorderColor((t as any).simpleBorderColor ?? "");
    setSimpleRounding((t as any).simpleRounding ?? "rounded");
    setSimpleAlign((t as any).simpleAlign ?? "left");
    setName(t.nameBase);
    setTemplateApplied(true);
  };

  // ── Resource pickers ──
  async function openProductPicker() {
    try {
      // @ts-ignore
      const selected = await shopify.resourcePicker({ type: "product", multiple: true });
      if (selected) setProductIds(selected.map((p: any) => ({ id: p.id, title: p.title })));
    } catch {}
  }

  async function openCollectionPicker() {
    try {
      // @ts-ignore
      const selected = await shopify.resourcePicker({ type: "collection", multiple: true });
      if (selected) setCollectionIds(selected.map((c: any) => ({ id: c.id, title: c.title })));
    } catch {}
  }

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  // ── Dirty tracking ──
  const initialSnapshot = useRef<Record<string, unknown> | null>(null);
  if (isNew && initialSnapshot.current === null) {
    initialSnapshot.current = { name, targetType, displayStyle, icon, iconColor, badgeText, messageTemplate, subMessage, subMessageIcon, accentColor, textColor, backgroundColor, simpleBgTransparent, simpleBorderColor, simpleRounding, simpleAlign, cutoffTime, shippingDaysMin, shippingDaysMax, geoTargetType, productIds: JSON.stringify(productIds), collectionIds: JSON.stringify(collectionIds), tags: JSON.stringify(tags), geoTargets: JSON.stringify(geoTargets), zoneConfigs: JSON.stringify(zoneConfigs), zoneSelectionMode, selectedZoneIds: JSON.stringify(selectedZoneIds) };
  }
  const snap = initialSnapshot.current;

  const isDirty = isNew
    ? snap !== null && (
        name !== snap.name || targetType !== snap.targetType || displayStyle !== snap.displayStyle ||
        icon !== snap.icon || iconColor !== snap.iconColor || badgeText !== snap.badgeText || messageTemplate !== snap.messageTemplate || subMessage !== snap.subMessage || subMessageIcon !== snap.subMessageIcon || accentColor !== snap.accentColor ||
        textColor !== snap.textColor || backgroundColor !== snap.backgroundColor ||
        simpleBgTransparent !== snap.simpleBgTransparent || simpleBorderColor !== snap.simpleBorderColor || simpleRounding !== snap.simpleRounding || simpleAlign !== snap.simpleAlign ||
        cutoffTime !== snap.cutoffTime || shippingDaysMin !== snap.shippingDaysMin || shippingDaysMax !== snap.shippingDaysMax ||
        geoTargetType !== snap.geoTargetType || JSON.stringify(productIds) !== snap.productIds ||
        JSON.stringify(collectionIds) !== snap.collectionIds || JSON.stringify(tags) !== snap.tags ||
        JSON.stringify(geoTargets) !== snap.geoTargets ||
        JSON.stringify(zoneConfigs) !== snap.zoneConfigs ||
        zoneSelectionMode !== snap.zoneSelectionMode || JSON.stringify(selectedZoneIds) !== snap.selectedZoneIds
      )
    : (
        name !== (badge?.name ?? "New delivery badge") || targetType !== (badge?.targetType ?? "all") ||
        displayStyle !== (badge?.displayStyle ?? "card") || icon !== (badge?.icon ?? "truck") ||
        iconColor !== (badge?.iconColor ?? badge?.accentColor ?? "#2C6ECB") ||
        badgeText !== (badge?.badgeText ?? "Delivery") ||
        messageTemplate !== (badge?.messageTemplate ?? "Get it {date_range}") ||
        subMessage !== (badge?.subMessage ?? ((badge?.displayStyle ?? "card") === "card" ? "Or get it by {express_end} with Express" : "")) ||
        subMessageIcon !== (badge?.subMessageIcon ?? "bolt") ||
        messageFontSize !== (badge?.messageFontSize ?? 14) ||
        subMessageFontSize !== (badge?.subMessageFontSize ?? 10) ||
        accentColor !== (badge?.accentColor ?? "#2C6ECB") ||
        textColor !== (badge?.textColor ?? "#1a1a1a") ||
        backgroundColor !== (badge?.backgroundColor ?? "#FFFFFF") ||
        simpleBgTransparent !== (badge?.simpleBgTransparent ?? false) ||
        simpleBorderColor !== (badge?.simpleBorderColor ?? "") ||
        simpleRounding !== (badge?.simpleRounding ?? "rounded") ||
        simpleAlign !== (badge?.simpleAlign ?? "left") ||
        cutoffTime !== (badge?.cutoffTime ?? "") ||
        shippingDaysMin !== (badge?.shippingDaysMin ?? "3") ||
        shippingDaysMax !== (badge?.shippingDaysMax ?? "7") || geoTargetType !== (badge?.geoTargetType ?? "all") ||
        JSON.stringify(productIds) !== JSON.stringify(badge?.productIds ?? []) ||
        JSON.stringify(collectionIds) !== JSON.stringify(badge?.collectionIds ?? []) ||
        JSON.stringify(tags) !== JSON.stringify(badge?.tags ?? []) ||
        JSON.stringify(geoTargets) !== JSON.stringify(badge?.geoTargets ?? []) ||
        JSON.stringify(zoneConfigs) !== JSON.stringify(badge?.zoneConfigs ?? []) ||
        zoneSelectionMode !== (badge?.selectedZoneIds && badge.selectedZoneIds.length > 0 ? "specific" : "all") ||
        JSON.stringify(selectedZoneIds) !== JSON.stringify(badge?.selectedZoneIds ?? [])
      );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isDirty) {
      timer = setTimeout(() => shopify.saveBar.show("badge-save-bar"), 0);
    } else {
      shopify.saveBar.hide("badge-save-bar");
    }
    return () => { clearTimeout(timer); shopify.saveBar.hide("badge-save-bar"); };
  }, [isDirty]);

  // ── Save ──
  function handleSave() {
    shopify.saveBar.hide("badge-save-bar");
    const badgeData: DeliveryBadge = {
      id: badge?.id ?? "",
      name,
      isActive: badge?.isActive ?? true,
      priority: badge?.priority ?? 0,
      targetType,
      productIds: targetType === "specific" ? productIds : [],
      tags: targetType === "tag" ? tags : [],
      collectionIds: targetType === "collection" ? collectionIds : [],
      geoTargetType,
      geoTargets: geoTargetType === "specific" ? geoTargets : [],
      displayStyle,
      icon,
      iconColor,
      badgeText,
      messageTemplate,
      subMessage: subMessage || undefined,
      subMessageIcon: subMessageIcon || undefined,
      messageFontSize,
      subMessageFontSize,
      accentColor,
      textColor,
      backgroundColor,
      simpleBgTransparent,
      simpleBorderColor,
      simpleRounding,
      simpleAlign,
      processingDays: null,
      shippingDaysMin: shippingDaysMin || null,
      shippingDaysMax: shippingDaysMax || null,
      cutoffTime: cutoffTime || null,
      zoneConfigs: badge?.zoneConfigs ?? [],
      selectedZoneIds: zoneSelectionMode === "all" ? [] : selectedZoneIds,
    };
    const fd = new FormData();
    fd.append("intent", "save");
    fd.append("badge", JSON.stringify(badgeData));
    submit(fd, { method: "post" });
  }

  // ── Discard ──
  function handleDiscard() {
    shopify.saveBar.hide("badge-save-bar");
    if (isNew) { navigate("/app"); return; }
    setName(badge?.name ?? "New delivery badge");
    setTargetType(badge?.targetType ?? "all");
    setProductIds(badge?.productIds ?? []);
    setCollectionIds(badge?.collectionIds ?? []);
    setTags(badge?.tags ?? []);
    setDisplayStyle(badge?.displayStyle ?? "card");
    setIcon(((badge?.icon ?? "truck") in ICON_PATHS ? (badge?.icon ?? "truck") : "truck"));
    setIconColor(badge?.iconColor ?? badge?.accentColor ?? "#2C6ECB");
    setBadgeText(badge?.badgeText ?? "Delivery");
    setMessageTemplate(badge?.messageTemplate ?? "Get it {date_range}");
    setSubMessage(badge?.subMessage ?? ((badge?.displayStyle ?? "card") === "card" ? "Or get it by {express_end} with Express" : ""));
    setSubMessageIcon(badge?.subMessageIcon ?? "bolt");
    setSubMessageOpen(!!badge?.subMessage);
    setMessageFontSize(badge?.messageFontSize ?? 14);
    setSubMessageFontSize(badge?.subMessageFontSize ?? 10);
    setAccentColor(badge?.accentColor ?? "#2C6ECB");
    setAccentHsb(hexToHsb(badge?.accentColor ?? "#2C6ECB"));
    setTextColor(badge?.textColor ?? "#1a1a1a");
    setBackgroundColor(badge?.backgroundColor ?? "#FFFFFF");
    setSimpleBgTransparent(badge?.simpleBgTransparent ?? false);
    setSimpleBorderColor(badge?.simpleBorderColor ?? "");
    setSimpleRounding(badge?.simpleRounding ?? "rounded");
    setSimpleAlign(badge?.simpleAlign ?? "left");
    setShippingDaysMin(badge?.shippingDaysMin ?? "3");
    setShippingDaysMax(badge?.shippingDaysMax ?? "7");
    setCutoffTime(badge?.cutoffTime ?? "11:00");
    setZoneConfigs(badge?.zoneConfigs ?? []);
    setGeoTargetType(badge?.geoTargetType ?? "all");
    setGeoTargets(badge?.geoTargets ?? []);
  }

  // ── Preview ──
  // Decide which days to use for the main preview based on the selected preview zone.
  const currentPreviewZone = savedZones.find((z) => z.id === previewZoneId) ||
    { processingDays: "0", shippingDaysMin, shippingDaysMax };
  const mainMin = currentPreviewZone.shippingDaysMin;
  const mainMax = currentPreviewZone.shippingDaysMax;
  const { start, end } = getExampleDates(mainMin, mainMax, cutoffTime);
  // Express dates from the preview zone (if it has express enabled).
  // If no express data on this zone, use a sensible fallback (1-2 days) so the
  // preview always shows what the badge will look like with real dates.
  const expressMin = currentPreviewZone?.expressDaysMin;
  const expressMax = currentPreviewZone?.expressDaysMax;
  const hasExpress = currentPreviewZone?.expressEnabled && expressMin && expressMax;
  const { start: expressStart, end: expressEnd } = hasExpress
    ? getExampleDates(expressMin, expressMax, cutoffTime)
    : getExampleDates("1", "2", cutoffTime);

  const previewText = messageTemplate
    .replace("{date_range}", `${start} - ${end}`)
    .replace("{date_start}", start)
    .replace("{date_end}", end)
    .replace("{express_start}", expressStart)
    .replace("{express_end}", expressEnd);

  const previewSubText = subMessage
    ? subMessage
        .replace("{date_range}", `${start} - ${end}`)
        .replace("{date_start}", start)
        .replace("{date_end}", end)
        .replace("{express_start}", expressStart)
        .replace("{express_end}", expressEnd)
    : "";

  const simpleRadiusValue = ROUNDING_OPTIONS.find((r) => r.value === simpleRounding)?.radius ?? "8px";
  const needsBox = !simpleBgTransparent || !!simpleBorderColor; // has visible bg or border
  const simpleStyle: React.CSSProperties = {
    color: textColor,
    backgroundColor: simpleBgTransparent ? "transparent" : backgroundColor,
    border: simpleBorderColor ? `1.5px solid ${simpleBorderColor}` : "none",
    borderRadius: needsBox ? simpleRadiusValue : "0",
    padding: needsBox ? (simpleRounding === "pill" ? "7px 18px" : "8px 14px") : "0",
  };
  const styleMap: Record<DisplayStyle, React.CSSProperties> = {
    simple: simpleStyle,
    card:   { background: "linear-gradient(180deg, #1c2440 0%, #141a30 100%)", border: "1px solid rgba(139,125,255,0.28)", borderRadius: "14px", padding: "18px 20px", color: "#e7e9f5", boxShadow: "0 4px 18px rgba(8,12,28,0.35)", fontWeight: 700, fontSize: "18px" },
  };

  const tabs = [
    { id: "design",   content: "Design" },
    { id: "products", content: "Products" },
    { id: "delivery", content: "Delivery" },
  ];

  return (
    <>
      <SaveBar id="badge-save-bar">
        <button variant="primary" onClick={handleSave} loading={isSaving ? "" : undefined}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>

      <Page
        title={isNew ? "Create delivery badge" : `Edit: ${badge?.name}`}
        backAction={
          isNew && templateApplied
            ? { content: "Templates", onAction: () => { initialSnapshot.current = null; setTemplateApplied(false); } }
            : { content: "Delivery Badges", url: "/app/badges" }
        }
      >
        {/* ── Template picker ── */}
        {showTemplates && !templateApplied && (
          <div style={{ marginBottom: "20px" }}>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Start from a template</Text>
                <Text variant="bodySm" as="p" tone="subdued">Pick a starting point for your delivery badge.</Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "10px", padding: "4px 0" }}>
                  {BADGE_TEMPLATES.map((t) => {
                    const { start: s, end: e } = getExampleDates();
                    const preview = t.messageTemplate.replace("{date_start}", s).replace("{date_end}", e).replace("{date_range}", `${s} - ${e}`);
                    const tSimple = t as any;
                    const stylePreview: React.CSSProperties = t.displayStyle === "simple" ? {
                      backgroundColor: tSimple.simpleBgTransparent ? "transparent" : t.accentColor,
                      border: tSimple.simpleBorderColor ? `1.5px solid ${tSimple.simpleBorderColor}` : "none",
                      borderRadius: tSimple.simpleRounding === "pill" ? "999px" : tSimple.simpleRounding === "none" ? "0" : "6px",
                      padding: tSimple.simpleRounding === "pill" ? "4px 10px" : "4px 8px",
                      color: tSimple.simpleBgTransparent ? t.accentColor : "#fff",
                    } : { border: `1.5px solid ${t.accentColor}`, borderRadius: "6px", padding: "4px 8px", color: t.accentColor };
                    // extract last date for card preview
                    const cardDateText = (() => {
                      const m = preview.match(/([A-Z][a-z]{2} \d{1,2})(?!.*[A-Z][a-z]{2} \d{1,2})/);
                      return m ? m[1] : e;
                    })();
                    const cardParts = preview.split(cardDateText);
                    return (
                      <button
                        key={t.label}
                        onClick={() => applyTemplate(t)}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "14px 8px", border: "1px solid #e1e3e5", borderRadius: "8px", backgroundColor: "white", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#005bd3"; e.currentTarget.style.boxShadow = "0 0 0 1px #005bd3"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e1e3e5"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        {(t as any).blank ? (
                          <div style={{ width: "36px", height: "36px", borderRadius: "50%", border: "2px dashed #c4cdd5", display: "flex", alignItems: "center", justifyContent: "center", color: "#8c9196", fontSize: "20px" }}>+</div>
                        ) : t.displayStyle === "card" ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                              padding: "10px 11px",
                              background: "linear-gradient(180deg, #1c2440 0%, #141a30 100%)",
                              border: `1px solid ${t.accentColor}47`,
                              borderRadius: "9px",
                              boxShadow: "0 2px 8px rgba(8,12,28,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
                              color: "#e7e9f5",
                              width: "100%",
                              boxSizing: "border-box",
                              textAlign: "left",
                            }}
                          >
                            <span
                              style={{
                                alignSelf: "flex-start",
                                fontSize: "7px",
                                fontWeight: 800,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                background: t.accentColor,
                                color: "#0f1228",
                                padding: "2px 5px",
                                borderRadius: "3px",
                              }}
                            >
                              DELIVERY
                            </span>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#ffffff", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {cardParts[0]}
                              <span style={{ color: t.accentColor }}>{cardDateText}</span>
                              {cardParts[1] || ""}
                            </span>
                          </div>
                        ) : (
                          <div style={{ fontSize: "10px", fontWeight: 500, maxWidth: "80px", textAlign: "center", overflow: "hidden", ...stylePreview }}>
                            {t.icon ? `${t.icon} ` : ""}{preview.length > 20 ? preview.slice(0, 20) + "…" : preview}
                          </div>
                        )}
                        <span style={{ fontSize: "11px", color: "#6d7175" }}>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </div>
        )}

        {/* ── Editor + Preview ── */}
        {(!showTemplates || templateApplied) && (
          <Layout>
            {/* Left: tabs */}
            <Layout.Section variant="oneHalf">
              <BlockStack gap="300">
                <TextField
                  label="Badge name (internal)"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  helpText="Only visible to you — not shown to shoppers"
                />

                <Card>
                  <BlockStack gap="400">
                    {/* Next/Save button overlay */}
                    <div style={{ position: "relative" }}>
                      <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
                        {selectedTab < 2 ? (
                          <Button variant="primary" size="slim" onClick={() => setSelectedTab(selectedTab + 1)}>
                            {selectedTab === 0 ? "Next: Products →" : "Next: Delivery →"}
                          </Button>
                        ) : (
                          <Button variant="primary" size="slim" onClick={handleSave} loading={isSaving}>
                            Save badge
                          </Button>
                        )}
                      </div>
                      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                        {/* ── Design tab ── */}
                        {selectedTab === 0 && (
                          <Box paddingBlockStart="400">
                            <BlockStack gap="400">

                              {/* Display style */}
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="medium">Style</Text>
                                <InlineGrid columns={2} gap="200">
                                  {DISPLAY_STYLES.map((s) => {
                                    const sel = displayStyle === s.value;
                                    return (
                                      <button
                                        key={s.value}
                                        onClick={() => {
                                          setDisplayStyle(s.value);
                                          if (s.value === "card" && !subMessage) {
                                            setSubMessage("Or get it by {express_end} with Express");
                                            setSubMessageOpen(true);
                                          } else if (s.value === "simple" && subMessage) {
                                            setSubMessage("");
                                            setSubMessageOpen(false);
                                          }
                                        }}
                                        style={{ cursor: "pointer", textAlign: "left", width: "100%", padding: "12px", borderRadius: "8px", border: sel ? "2px solid #005bd3" : "1px solid #e1e3e5", background: sel ? "#f0f5ff" : "white" }}
                                      >
                                        <BlockStack gap="050">
                                          <Text as="p" variant="bodyMd" fontWeight="semibold">{s.label}</Text>
                                          <Text as="p" variant="bodySm" tone="subdued">{s.desc}</Text>
                                        </BlockStack>
                                      </button>
                                    );
                                  })}
                                </InlineGrid>
                              </BlockStack>

                              {/* Colours — Text / Background / Accent */}
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="medium">Colours</Text>
                                <InlineStack gap="400" wrap>
                                  {([
                                    { key: "text", label: "Text", value: textColor, setValue: setTextColor, open: textColorPickerOpen, setOpen: setTextColorPickerOpen },
                                    { key: "background", label: "Background", value: backgroundColor, setValue: setBackgroundColor, open: bgColorPickerOpen, setOpen: setBgColorPickerOpen },
                                    { key: "accent", label: "Accent", value: accentColor, setValue: (v: string) => { setAccentColor(v); setAccentHsb(hexToHsb(v)); }, open: colorPickerOpen, setOpen: setColorPickerOpen },
                                  ] as const).map((field) => {
                                    const isTextShape = displayStyle === "simple" && simpleBgTransparent;
                                    const disabled = field.key === "background" && isTextShape;
                                    return (
                                    <BlockStack key={field.key} gap="100">
                                      <Text as="p" variant="bodySm" tone="subdued">{field.label}</Text>
                                      <div style={disabled ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
                                      <InlineStack gap="200" blockAlign="center">
                                        <Popover
                                          active={field.open}
                                          activator={
                                            <div
                                              onClick={() => field.setOpen((o: boolean) => !o)}
                                              title={`${field.label} colour`}
                                              style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: field.value, cursor: disabled ? "default" : "pointer", border: "2px solid #c9cccf", boxSizing: "border-box", boxShadow: field.open ? "0 0 0 3px #005bd340" : undefined }}
                                            />
                                          }
                                          onClose={() => { field.setOpen(false); addToRecent(field.value); }}
                                        >
                                          <Box padding="400" minWidth="260px">
                                            <BlockStack gap="300">
                                              <Text as="p" variant="bodySm" fontWeight="medium">{field.label} colour</Text>
                                              <ColorPicker
                                                color={hexToHsb(field.value)}
                                                onChange={(c) => field.setValue(hsbToHex(c))}
                                                allowAlpha={false}
                                              />
                                              <TextField
                                                label="Hex"
                                                labelHidden
                                                value={field.value}
                                                onChange={(v) => { if (/^#[0-9a-fA-F]{0,7}$/.test(v)) field.setValue(v); }}
                                                autoComplete="off"
                                                monospaced
                                              />
                                              <BlockStack gap="150">
                                                <Text variant="bodySm" as="p" tone="subdued">Swatches</Text>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4 }}>
                                                  {ACCENT_COLORS.map((c) => (
                                                    <div key={c} onClick={() => field.setValue(c)} title={c} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, cursor: "pointer", border: field.value.toUpperCase() === c.toUpperCase() ? "2px solid #005bd3" : "1px solid #c9cccf" }} />
                                                  ))}
                                                </div>
                                              </BlockStack>
                                              {recentColors.length > 0 && (
                                                <BlockStack gap="150">
                                                  <Text variant="bodySm" as="p" tone="subdued">Recently used</Text>
                                                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                                    {recentColors.map((c) => (
                                                      <div key={c} onClick={() => field.setValue(c)} title={c} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, cursor: "pointer", border: field.value.toUpperCase() === c.toUpperCase() ? "2px solid #005bd3" : "1px solid #c9cccf" }} />
                                                    ))}
                                                  </div>
                                                </BlockStack>
                                              )}
                                            </BlockStack>
                                          </Box>
                                        </Popover>
                                        <div style={{ width: 90 }}>
                                          <TextField
                                            label=""
                                            labelHidden
                                            value={field.value}
                                            onChange={(v) => { if (/^#[0-9a-fA-F]{0,7}$/.test(v)) field.setValue(v); }}
                                            autoComplete="off"
                                            maxLength={7}
                                            monospaced
                                          />
                                        </div>
                                      </InlineStack>
                                      </div>
                                    </BlockStack>
                                    );
                                  })}
                                </InlineStack>
                              </BlockStack>

                              {/* Simple style sub-options */}
                              {displayStyle === "simple" && (
                                <BlockStack gap="300">
                                  {/* Shape substyle */}
                                  <BlockStack gap="100">
                                    <Text as="p" variant="bodySm">Shape</Text>
                                    <InlineStack gap="200">
                                      {([
                                        { value: "text",      label: "Text",              radius: "0" },
                                        { value: "none",      label: "Rectangle",         radius: "2px" },
                                        { value: "rounded",   label: "Rounded Rectangle", radius: "6px" },
                                        { value: "pill",      label: "Pill",              radius: "999px" },
                                      ] as const).map((s) => {
                                        const isText = s.value === "text";
                                        const sel = isText ? simpleBgTransparent : (!simpleBgTransparent && simpleRounding === s.value);
                                        return (
                                          <button
                                            key={s.value}
                                            onClick={() => {
                                              if (isText) {
                                                setSimpleBgTransparent(true);
                                                setSimpleBorderColor("");
                                                setSimpleRounding("rounded");
                                              } else {
                                                setSimpleBgTransparent(false);
                                                setSimpleBorderColor((prev) => prev || accentColor || "#2C6ECB");
                                                setSimpleRounding(s.value as any);
                                              }
                                            }}
                                            style={{
                                              padding: "6px 14px", fontSize: "12px", cursor: "pointer",
                                              borderRadius: isText ? "6px" : s.radius,
                                              border: sel ? "1.5px solid #005bd3" : "1px solid #e1e3e5",
                                              backgroundColor: sel ? "#f0f5ff" : "white",
                                              color: sel ? "#005bd3" : "#1a1a1a",
                                            }}
                                          >
                                            {s.label}
                                          </button>
                                        );
                                      })}
                                    </InlineStack>
                                  </BlockStack>

                                  {/* Outline option — only for non-text shapes */}
                                  {!simpleBgTransparent && (
                                    <InlineStack gap="200" blockAlign="center">
                                      <Text as="p" variant="bodySm">Border</Text>
                                      <label style={{ position: "relative", display: "inline-block", width: 36, height: 20, cursor: "pointer" }}>
                                        <input
                                          type="checkbox"
                                          checked={!!simpleBorderColor}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSimpleBorderColor(accentColor || "#2C6ECB");
                                            } else {
                                              setSimpleBorderColor("");
                                            }
                                          }}
                                          style={{ opacity: 0, width: 0, height: 0 }}
                                        />
                                        <span style={{
                                          position: "absolute", inset: 0, borderRadius: 10,
                                          backgroundColor: simpleBorderColor ? "#005bd3" : "#c9cccf",
                                          transition: "background-color 0.15s",
                                        }}>
                                          <span style={{
                                            position: "absolute", top: 2, left: simpleBorderColor ? 18 : 2,
                                            width: 16, height: 16, borderRadius: "50%", backgroundColor: "#fff",
                                            transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                          }} />
                                        </span>
                                      </label>
                                      {simpleBorderColor && (
                                        <Popover
                                          active={simpleBorderPickerOpen}
                                          activator={
                                            <div
                                              onClick={() => setSimpleBorderPickerOpen((o) => !o)}
                                              title="Border colour"
                                              style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: simpleBorderColor, cursor: "pointer", border: "2px solid #c9cccf", boxSizing: "border-box" }}
                                            />
                                          }
                                          onClose={() => { setSimpleBorderPickerOpen(false); addToRecent(simpleBorderColor); }}
                                        >
                                          <Box padding="400" minWidth="240px">
                                            <BlockStack gap="300">
                                              <Text as="p" variant="bodySm" fontWeight="medium">Border colour</Text>
                                                <ColorPicker
                                                  color={hexToHsb(simpleBorderColor || "#2C6ECB")}
                                                  onChange={(c) => setSimpleBorderColor(hsbToHex(c))}
                                                  allowAlpha={false}
                                                />
                                                <TextField
                                                  label="Hex"
                                                  labelHidden
                                                  value={simpleBorderColor}
                                                  onChange={(v) => { if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSimpleBorderColor(v); }}
                                                  autoComplete="off"
                                                  prefix="#"
                                                />
                                                {recentColors.length > 0 && (
                                                  <BlockStack gap="150">
                                                    <Text variant="bodySm" as="p" tone="subdued">Recently used</Text>
                                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                                      {recentColors.map((c) => (
                                                        <div key={c} onClick={() => setSimpleBorderColor(c)} title={c} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, cursor: "pointer", border: simpleBorderColor.toUpperCase() === c.toUpperCase() ? "2px solid #005bd3" : "1px solid #c9cccf" }} />
                                                      ))}
                                                    </div>
                                                  </BlockStack>
                                                )}
                                              </BlockStack>
                                            </Box>
                                          </Popover>
                                        )}
                                    </InlineStack>
                                  )}
                                </BlockStack>
                              )}

                              <Divider />

                              {/* Message + Sub-message */}
                              <BlockStack gap="400">
                                {displayStyle === "card" && (
                                  <TextField
                                    label="Badge text"
                                    value={badgeText}
                                    onChange={(v) => setBadgeText(v.slice(0, 20))}
                                    maxLength={20}
                                    showCharacterCount
                                    autoComplete="off"
                                  />
                                )}

                                {/* ── Main message ── */}
                                <BlockStack gap="100">
                                  <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
                                    <div style={{ width: "40px", flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}><Text as="p" variant="bodySm" fontWeight="medium">Message</Text></div>
                                    <div style={{ width: "40px", textAlign: "center", flexShrink: 0 }}><Text as="p" variant="bodySm" tone="subdued">Size</Text></div>
                                  </div>
                                  <div style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
                                    <Popover
                                      active={iconPickerOpen === "message"}
                                      activator={
                                        <button
                                          type="button"
                                          onClick={() => setIconPickerOpen(iconPickerOpen === "message" ? null : "message")}
                                          style={{
                                            width: "40px", height: "32px", flexShrink: 0,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            border: "1px solid #c9cccf", borderRadius: "8px",
                                            backgroundColor: "white", cursor: "pointer", alignSelf: "center",
                                          }}
                                          title={icon ? ICONS.find(i => i.value === icon)?.label || "Icon" : "No icon"}
                                        >
                                          {icon ? <BadgeIcon name={icon} size={16} color="#333" /> : <span style={{ color: "#b5b5b5", fontSize: "18px", lineHeight: 1 }}>&times;</span>}
                                        </button>
                                      }
                                      onClose={() => setIconPickerOpen(null)}
                                    >
                                      <div style={{ padding: "8px", display: "flex", gap: "4px", flexWrap: "wrap", width: "176px" }}>
                                        {ICONS.map((opt) => (
                                          <button
                                            key={opt.value || "none"}
                                            onClick={() => { setIcon(opt.value); setIconColor(textColor); setIconPickerOpen(null); }}
                                            title={opt.label}
                                            style={{
                                              width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
                                              border: icon === opt.value ? "2px solid #005bd3" : "1px solid #e1e3e5",
                                              borderRadius: "6px", backgroundColor: icon === opt.value ? "#f0f5ff" : "white", cursor: "pointer",
                                            }}
                                          >
                                            {opt.value ? <BadgeIcon name={opt.value} size={15} color="#333" /> : <span style={{ color: "#b5b5b5", fontSize: "16px" }}>&times;</span>}
                                          </button>
                                        ))}
                                      </div>
                                    </Popover>
                                    <div style={{ flex: 1 }}>
                                      <TextField
                                        label="Message text"
                                        labelHidden
                                        value={messageTemplate}
                                        onChange={(v) => setMessageTemplate(v.slice(0, 60))}
                                        maxLength={60}
                                        showCharacterCount
                                        autoComplete="off"
                                        suffix={
                                          <Popover
                                            active={iconPickerOpen === "msg-vars"}
                                            activator={
                                              <button
                                                type="button"
                                                onClick={() => setIconPickerOpen(iconPickerOpen === "msg-vars" ? null : "msg-vars")}
                                                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "#202223", display: "flex", alignItems: "center", borderRadius: "4px" }}
                                                title="Insert dynamic date"
                                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f1f2f4"; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                              >
                                                <span style={{ fontSize: "13px", fontWeight: 400, fontFamily: "monospace" }}>&lt;/&gt;</span>
                                              </button>
                                            }
                                            onClose={() => setIconPickerOpen(null)}
                                          >
                                            <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px", minWidth: "150px" }}>
                                              {[
                                                { label: "Start date", token: "{date_start}" },
                                                { label: "End date", token: "{date_end}" },
                                                { label: "Date range", token: "{date_range}" },
                                              ].map((v) => (
                                                <button
                                                  key={v.token}
                                                  type="button"
                                                  onClick={() => { setMessageTemplate((m) => m + " " + v.token); setIconPickerOpen(null); }}
                                                  style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 8px", fontSize: "13px", textAlign: "left", borderRadius: "4px", color: "#202223" }}
                                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f1f2f4"; }}
                                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                                >
                                                  {v.label} <span style={{ color: "#8c9196", fontSize: "11px" }}>{v.token}</span>
                                                </button>
                                              ))}
                                            </div>
                                          </Popover>
                                        }
                                      />
                                    </div>
                                    <Popover
                                      active={iconPickerOpen === "msg-size"}
                                      activator={
                                        <button
                                          type="button"
                                          onClick={() => setIconPickerOpen(iconPickerOpen === "msg-size" ? null : "msg-size")}
                                          style={{
                                            width: "40px", height: "32px", flexShrink: 0,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            border: "1px solid #c9cccf", borderRadius: "8px",
                                            backgroundColor: "white", cursor: "pointer", alignSelf: "center",
                                            fontSize: "13px", color: "#202223",
                                          }}
                                          title="Font size"
                                        >
                                          {messageFontSize}
                                        </button>
                                      }
                                      onClose={() => setIconPickerOpen(null)}
                                    >
                                      <div style={{ padding: "6px", display: "flex", gap: "4px", flexWrap: "wrap", width: "140px" }}>
                                        {[8, 10, 12, 14, 16, 18].map((sz) => (
                                          <button
                                            key={sz}
                                            type="button"
                                            onClick={() => { setMessageFontSize(sz); setIconPickerOpen(null); }}
                                            style={{
                                              width: "36px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
                                              border: messageFontSize === sz ? "2px solid #005bd3" : "1px solid #e1e3e5",
                                              borderRadius: "6px", backgroundColor: messageFontSize === sz ? "#f0f5ff" : "white",
                                              cursor: "pointer", fontSize: "12px", color: "#202223", fontWeight: messageFontSize === sz ? 600 : 400,
                                            }}
                                          >
                                            {sz}
                                          </button>
                                        ))}
                                      </div>
                                    </Popover>
                                  </div>
                                </BlockStack>

                                {/* ── Sub-message (collapsible) ── */}
                                {!subMessage && !subMessageOpen ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSubMessageOpen(true);
                                      if (!subMessage) setSubMessage("Or get it by {express_end} with Express");
                                    }}
                                    style={{
                                      background: "none", border: "none", padding: 0,
                                      color: "#005bd3", fontSize: "13px", cursor: "pointer",
                                      textAlign: "left", textDecoration: "none",
                                    }}
                                  >
                                    + Add sub-message (e.g. express delivery)
                                  </button>
                                ) : (
                                  <BlockStack gap="100">
                                    <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
                                      <div style={{ width: "40px", flexShrink: 0 }} />
                                      <div style={{ flex: 1 }}>
                                        <InlineStack align="space-between" blockAlign="center">
                                          <Text as="p" variant="bodySm" fontWeight="medium">Sub-message</Text>
                                          <button
                                            type="button"
                                            onClick={() => { setSubMessage(""); setSubMessageIcon("bolt"); setSubMessageOpen(false); }}
                                            style={{
                                              background: "none", border: "none", padding: 0,
                                              color: "#8c9196", fontSize: "12px", cursor: "pointer",
                                            }}
                                          >
                                            Remove
                                          </button>
                                        </InlineStack>
                                      </div>
                                      <div style={{ width: "40px", flexShrink: 0 }} />
                                    </div>
                                    <div style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
                                      <Popover
                                        active={iconPickerOpen === "sub"}
                                        activator={
                                          <button
                                            type="button"
                                            onClick={() => setIconPickerOpen(iconPickerOpen === "sub" ? null : "sub")}
                                            style={{
                                              width: "40px", height: "32px", flexShrink: 0,
                                              display: "flex", alignItems: "center", justifyContent: "center",
                                              border: "1px solid #c9cccf", borderRadius: "8px",
                                              backgroundColor: "white", cursor: "pointer",
                                            }}
                                            title={subMessageIcon ? ICONS.find(i => i.value === subMessageIcon)?.label || "Icon" : "No icon"}
                                          >
                                            {subMessageIcon ? <BadgeIcon name={subMessageIcon} size={16} color="#333" /> : <span style={{ color: "#b5b5b5", fontSize: "18px", lineHeight: 1 }}>&times;</span>}
                                          </button>
                                        }
                                        onClose={() => setIconPickerOpen(null)}
                                      >
                                        <div style={{ padding: "8px", display: "flex", gap: "4px", flexWrap: "wrap", width: "176px" }}>
                                          {ICONS.map((opt) => (
                                            <button
                                              key={opt.value || "none"}
                                              onClick={() => { setSubMessageIcon(opt.value); setIconPickerOpen(null); }}
                                              title={opt.label}
                                              style={{
                                                width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
                                                border: subMessageIcon === opt.value ? "2px solid #005bd3" : "1px solid #e1e3e5",
                                                borderRadius: "6px", backgroundColor: subMessageIcon === opt.value ? "#f0f5ff" : "white", cursor: "pointer",
                                              }}
                                            >
                                              {opt.value ? <BadgeIcon name={opt.value} size={15} color="#333" /> : <span style={{ color: "#b5b5b5", fontSize: "16px" }}>&times;</span>}
                                            </button>
                                          ))}
                                        </div>
                                      </Popover>
                                      <div style={{ flex: 1 }}>
                                        <TextField
                                          label="Sub-message text"
                                          labelHidden
                                          value={subMessage}
                                          onChange={(v) => setSubMessage(v.slice(0, 80))}
                                          maxLength={80}
                                          showCharacterCount
                                          autoComplete="off"
                                          suffix={
                                            <Popover
                                              active={iconPickerOpen === "sub-vars"}
                                              activator={
                                                <button
                                                  type="button"
                                                  onClick={() => setIconPickerOpen(iconPickerOpen === "sub-vars" ? null : "sub-vars")}
                                                  style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "#202223", display: "flex", alignItems: "center", borderRadius: "4px" }}
                                                  title="Insert dynamic date"
                                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f1f2f4"; }}
                                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                                >
                                                  <span style={{ fontSize: "13px", fontWeight: 400, fontFamily: "monospace" }}>&lt;/&gt;</span>
                                                </button>
                                              }
                                              onClose={() => setIconPickerOpen(null)}
                                            >
                                              <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px", minWidth: "160px" }}>
                                                {[
                                                  { label: "Express start", token: "{express_start}" },
                                                  { label: "Express end", token: "{express_end}" },
                                                ].map((v) => (
                                                  <button
                                                    key={v.token}
                                                    type="button"
                                                    onClick={() => { setSubMessage((m) => m + " " + v.token); setIconPickerOpen(null); }}
                                                    style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 8px", fontSize: "13px", textAlign: "left", borderRadius: "4px", color: "#202223" }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f1f2f4"; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                                  >
                                                    {v.label} <span style={{ color: "#8c9196", fontSize: "11px" }}>{v.token}</span>
                                                  </button>
                                                ))}
                                              </div>
                                            </Popover>
                                          }
                                        />
                                      </div>
                                      <Popover
                                        active={iconPickerOpen === "sub-size"}
                                        activator={
                                          <button
                                            type="button"
                                            onClick={() => setIconPickerOpen(iconPickerOpen === "sub-size" ? null : "sub-size")}
                                            style={{
                                              width: "40px", height: "32px", flexShrink: 0,
                                              display: "flex", alignItems: "center", justifyContent: "center",
                                              border: "1px solid #c9cccf", borderRadius: "8px",
                                              backgroundColor: "white", cursor: "pointer", alignSelf: "center",
                                              fontSize: "13px", color: "#202223",
                                            }}
                                            title="Font size"
                                          >
                                            {subMessageFontSize}
                                          </button>
                                        }
                                        onClose={() => setIconPickerOpen(null)}
                                      >
                                        <div style={{ padding: "6px", display: "flex", gap: "4px", flexWrap: "wrap", width: "140px" }}>
                                          {[8, 10, 12, 14, 16, 18].map((sz) => (
                                            <button
                                              key={sz}
                                              type="button"
                                              onClick={() => { setSubMessageFontSize(sz); setIconPickerOpen(null); }}
                                              style={{
                                                width: "36px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
                                                border: subMessageFontSize === sz ? "2px solid #005bd3" : "1px solid #e1e3e5",
                                                borderRadius: "6px", backgroundColor: subMessageFontSize === sz ? "#f0f5ff" : "white",
                                                cursor: "pointer", fontSize: "12px", color: "#202223", fontWeight: subMessageFontSize === sz ? 600 : 400,
                                              }}
                                            >
                                              {sz}
                                            </button>
                                          ))}
                                        </div>
                                      </Popover>
                                    </div>
                                  </BlockStack>
                                )}
                              </BlockStack>


                            </BlockStack>
                          </Box>
                        )}

                        {/* ── Products tab ── */}
                        {selectedTab === 1 && (
                          <Box paddingBlockStart="400">
                            <BlockStack gap="400">
                              <Select
                                label="Show badge on"
                                options={[
                                  { label: "All products", value: "all" },
                                  { label: "Specific products", value: "specific" },
                                  { label: "Products in a collection", value: "collection" },
                                  { label: "Products with a tag", value: "tag" },
                                ]}
                                value={targetType}
                                onChange={(v) => setTargetType(v as DeliveryBadge["targetType"])}
                              />

                              {targetType === "specific" && (
                                <BlockStack gap="300">
                                  <Button onClick={openProductPicker} variant="secondary">
                                    {productIds.length > 0 ? "Edit selection" : "Select products"}
                                  </Button>
                                  {productIds.length > 0 && (
                                    <BlockStack gap="200">
                                      {productIds.map((p) => (
                                        <div key={p.id} style={{ padding: "10px 12px", background: "#f6f6f7", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
                                          <InlineStack align="space-between" blockAlign="center">
                                            <Text as="span" variant="bodyMd" fontWeight="semibold">{p.title}</Text>
                                            <Button variant="plain" tone="critical" onClick={() => setProductIds((prev) => prev.filter((x) => x.id !== p.id))}>Remove</Button>
                                          </InlineStack>
                                        </div>
                                      ))}
                                    </BlockStack>
                                  )}
                                  {productIds.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No products selected. Badge will not show until you select at least one.</Text>}
                                </BlockStack>
                              )}

                              {targetType === "collection" && (
                                <BlockStack gap="300">
                                  <Button onClick={openCollectionPicker} variant="secondary">
                                    {collectionIds.length > 0 ? "Edit selection" : "Select collections"}
                                  </Button>
                                  {collectionIds.length > 0 && (
                                    <BlockStack gap="200">
                                      {collectionIds.map((c) => (
                                        <InlineStack key={c.id} align="space-between" blockAlign="center">
                                          <Text as="span" variant="bodyMd">{c.title}</Text>
                                          <Button variant="plain" tone="critical" onClick={() => setCollectionIds((prev) => prev.filter((x) => x.id !== c.id))}>Remove</Button>
                                        </InlineStack>
                                      ))}
                                    </BlockStack>
                                  )}
                                  {collectionIds.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No collections selected. Badge will not show until you select at least one.</Text>}
                                </BlockStack>
                              )}

                              {targetType === "tag" && (
                                <BlockStack gap="300">
                                  <InlineStack gap="200" blockAlign="end">
                                    <div style={{ flex: 1 }}>
                                      <TextField label="Add a tag" value={tagInput} onChange={setTagInput} autoComplete="off" placeholder="e.g. free-shipping" />
                                    </div>
                                    <div style={{ paddingTop: "22px" }}>
                                      <Button onClick={addTag} variant="secondary">Add</Button>
                                    </div>
                                  </InlineStack>
                                  {tags.length > 0 && (
                                    <InlineStack gap="200" wrap>
                                      {tags.map((tag) => (
                                        <div key={tag} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", background: "#f0f0f0", borderRadius: "999px", fontSize: "13px", fontWeight: 500 }}>
                                          {tag}
                                          <span onClick={() => setTags((prev) => prev.filter((t) => t !== tag))} style={{ cursor: "pointer", color: "#999", fontWeight: 700, lineHeight: 1 }}>×</span>
                                        </div>
                                      ))}
                                    </InlineStack>
                                  )}
                                  {tags.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No tags added. Badge will not show until you add at least one tag.</Text>}
                                  <Text as="p" variant="bodySm" tone="subdued">Tag names are case-sensitive.</Text>
                                </BlockStack>
                              )}
                            </BlockStack>
                          </Box>
                        )}

                        {/* ── Delivery tab ── */}
                        {selectedTab === 2 && (
                          <Box paddingBlockStart="400">
                            <BlockStack gap="500">

                              {/* Shipping zones selector */}
                              <BlockStack gap="300">
                                <Banner>
                                  <Text as="p" variant="bodySm">
                                    Delivery dates are calculated based on shipping zones. You can review and edit them after creating your badge.
                                  </Text>
                                </Banner>

                                <BlockStack gap="200">
                                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                                    <input
                                      type="radio"
                                      name="zone-mode"
                                      value="all"
                                      checked={zoneSelectionMode === "all"}
                                      onChange={(e) => {
                                        setZoneSelectionMode(e.target.value as "all" | "specific");
                                        setSelectedZoneIds([]);
                                      }}
                                      style={{ cursor: "pointer" }}
                                    />
                                    <Text as="span" variant="bodyMd">All active zones</Text>
                                  </label>
                                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                                    <input
                                      type="radio"
                                      name="zone-mode"
                                      value="specific"
                                      checked={zoneSelectionMode === "specific"}
                                      onChange={(e) => setZoneSelectionMode(e.target.value as "all" | "specific")}
                                      style={{ cursor: "pointer" }}
                                    />
                                    <Text as="span" variant="bodyMd">Specific zones</Text>
                                  </label>
                                </BlockStack>

                                {zoneSelectionMode === "specific" && (
                                  <BlockStack gap="200">
                                    {savedZones.filter((z) => z.enabled).map((zone) => (
                                      <label key={zone.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                                        <input
                                          type="checkbox"
                                          checked={selectedZoneIds.includes(zone.id)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedZoneIds((prev) => [...prev, zone.id]);
                                            } else {
                                              setSelectedZoneIds((prev) => prev.filter((id) => id !== zone.id));
                                            }
                                          }}
                                          style={{ cursor: "pointer" }}
                                        />
                                        <BlockStack gap="050">
                                          <Text as="span" variant="bodyMd">{zone.name}</Text>
                                          <Text as="span" variant="bodySm" tone="subdued">{zone.geoSummary}</Text>
                                        </BlockStack>
                                      </label>
                                    ))}
                                  </BlockStack>
                                )}
                              </BlockStack>

                            </BlockStack>
                          </Box>
                        )}
                      </Tabs>
                    </div>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>

            {/* Right: sticky preview */}
            <Layout.Section variant="oneHalf">
              <div style={{ position: "sticky", top: "16px" }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">Preview</Text>
                      <div style={{ minWidth: "150px" }}>
                        <Select
                          label="Preview region"
                          labelHidden
                          options={
                            savedZones.length > 0
                              ? [
                                  ...savedZones.filter((z) => z.id !== "fallback").map((z) => ({ label: z.name, value: z.id })),
                                  { label: "All other customers", value: "fallback" },
                                ]
                              : [{ label: "Default", value: "fallback" }]
                          }
                          value={previewZoneId}
                          onChange={setPreviewZoneId}
                        />
                      </div>
                    </InlineStack>

                    {/* Product card mockup */}
                    <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid #e1e3e5", background: "#fff", maxWidth: "320px", margin: "0 auto" }}>
                      {/* Product image area */}
                      <div style={{ position: "relative", width: "100%", aspectRatio: "1", backgroundColor: "#f0f0f0", overflow: "hidden" }}>
                        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%" }}>
                          <rect width="200" height="200" fill="#f0f0f0"/>
                          <path d="M58,178 Q28,175 32,150 Q36,125 58,138" stroke="#c8c8c8" strokeWidth="11" fill="none" strokeLinecap="round"/>
                          <ellipse cx="105" cy="155" rx="46" ry="42" fill="#d2d2d2"/>
                          <polygon points="72,72 62,44 86,60" fill="#c8c8c8"/>
                          <polygon points="128,72 138,44 114,60" fill="#c8c8c8"/>
                          <polygon points="74,68 67,50 84,62" fill="#bcacac"/>
                          <polygon points="126,68 133,50 116,62" fill="#bcacac"/>
                          <circle cx="100" cy="88" r="36" fill="#d2d2d2"/>
                          <ellipse cx="87" cy="84" rx="7" ry="8" fill="#555"/>
                          <ellipse cx="113" cy="84" rx="7" ry="8" fill="#555"/>
                          <ellipse cx="87" cy="85" rx="3.5" ry="6" fill="#222"/>
                          <ellipse cx="113" cy="85" rx="3.5" ry="6" fill="#222"/>
                          <circle cx="89" cy="81" r="2" fill="white"/>
                          <circle cx="115" cy="81" r="2" fill="white"/>
                          <polygon points="100,97 96,103 104,103" fill="#b08888"/>
                          <path d="M96,103 Q100,108 104,103" stroke="#999" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                          <line x1="56" y1="96" x2="91" y2="100" stroke="#bbb" strokeWidth="1.2"/>
                          <line x1="56" y1="103" x2="91" y2="103" stroke="#bbb" strokeWidth="1.2"/>
                          <line x1="58" y1="110" x2="91" y2="106" stroke="#bbb" strokeWidth="1.2"/>
                          <line x1="109" y1="100" x2="144" y2="96" stroke="#bbb" strokeWidth="1.2"/>
                          <line x1="109" y1="103" x2="144" y2="103" stroke="#bbb" strokeWidth="1.2"/>
                          <line x1="109" y1="106" x2="142" y2="110" stroke="#bbb" strokeWidth="1.2"/>
                          <ellipse cx="84" cy="193" rx="20" ry="11" fill="#c8c8c8"/>
                          <ellipse cx="118" cy="193" rx="20" ry="11" fill="#c8c8c8"/>
                          <ellipse cx="73" cy="196" rx="5" ry="4" fill="#bbb"/>
                          <ellipse cx="84" cy="199" rx="5" ry="4" fill="#bbb"/>
                          <ellipse cx="95" cy="196" rx="5" ry="4" fill="#bbb"/>
                          <ellipse cx="107" cy="196" rx="5" ry="4" fill="#bbb"/>
                          <ellipse cx="118" cy="199" rx="5" ry="4" fill="#bbb"/>
                          <ellipse cx="129" cy="196" rx="5" ry="4" fill="#bbb"/>
                        </svg>
                      </div>

                      {/* Product info + delivery badge */}
                      <div style={{ padding: "14px 16px 18px", background: "#fff" }}>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "#1a1a1a", marginBottom: "4px" }}>Product name</div>
                        <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "12px" }}>$49 USD</div>
                        {/* Delivery badge */}
                        {displayStyle === "card" ? (
                          (() => {
                            // Find the last date pattern (e.g. "Apr 27") to highlight it in accent color.
                            // If no date found, render the full text as-is without highlight.
                            const m = previewText.match(/([A-Z][a-z]{2} \d{1,2})(?!.*[A-Z][a-z]{2} \d{1,2})/);
                            const dateStr = m ? m[0] : "";
                            const before = m ? previewText.slice(0, m.index) : previewText;
                            const after = m ? previewText.slice((m.index ?? 0) + dateStr.length) : "";
                            return (
                              <div style={{
                                display: "flex", flexDirection: "column",
                                padding: "18px 20px",
                                minHeight: "110px",
                                background: backgroundColor,
                                border: backgroundColor.toUpperCase() === "#FFFFFF" || backgroundColor.toUpperCase() === "#FFF"
                                  ? "1px solid #e1e5ee"
                                  : `1px solid ${accentColor}47`,
                                borderRadius: "14px",
                                boxShadow: backgroundColor.toUpperCase() === "#FFFFFF" || backgroundColor.toUpperCase() === "#FFF"
                                  ? "0 2px 8px rgba(0,0,0,0.06)"
                                  : "0 4px 18px rgba(8,12,28,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
                                color: textColor,
                                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                              }}>
                                {/* Label pill - sits above everything */}
                                <span style={{
                                  display: "inline-block", alignSelf: "flex-start",
                                  fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em",
                                  textTransform: "uppercase", color: "#FFFFFF",
                                  background: accentColor, padding: "3px 9px",
                                  borderRadius: "5px", marginBottom: "12px", lineHeight: 1.4,
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                                }}>{badgeText || "Delivery"}</span>
                                {/* Icon + message row */}
                                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                                  {icon && (
                                    <div style={{
                                      flex: "0 0 auto", width: "42px", height: "42px",
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      background: `${accentColor}1a`,
                                      border: `1px solid ${accentColor}2e`,
                                      borderRadius: "10px", lineHeight: 1,
                                    }}>
                                      <BadgeIcon name={icon} size={22} color={iconColor} />
                                    </div>
                                  )}
                                  <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontSize: `${messageFontSize}px`, fontWeight: 700, color: textColor, lineHeight: 1.25, letterSpacing: "-0.01em", whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "break-word" }}>
                                      {before}
                                      <span style={{ color: textColor, fontWeight: 700 }}>{dateStr}</span>
                                      {after}
                                    </span>
                                    {previewSubText && (
                                      <span style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "5px", fontSize: `${subMessageFontSize}px`, color: `${textColor}99`, fontWeight: 400, lineHeight: 1.4 }}>
                                        {subMessageIcon && <BadgeIcon name={subMessageIcon} size={subMessageFontSize} color={`${textColor}99`} />}
                                        {previewSubText}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div style={{ textAlign: displayStyle === "simple" ? simpleAlign : "left" }}>
                            <div style={{ display: "inline-flex", flexDirection: "column", gap: "2px", fontSize: `${messageFontSize}px`, fontFamily: "sans-serif", fontWeight: 500, ...styleMap[displayStyle] }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap", whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "break-word" }}>
                                {icon && <BadgeIcon name={icon} size={messageFontSize} color={iconColor} />}
                                <span>{previewText}</span>
                              </div>
                              {previewSubText && (
                                <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: `${subMessageFontSize}px`, opacity: 0.7, fontWeight: 400 }}>
                                  {subMessageIcon && <BadgeIcon name={subMessageIcon} size={subMessageFontSize} color={iconColor} />}
                                  <span>{previewSubText}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <Text variant="bodySm" tone="subdued" as="p">
                      Preview uses example dates based on your delivery window settings.
                    </Text>
                  </BlockStack>
                </Card>
              </div>
            </Layout.Section>
          </Layout>
        )}
      </Page>
    </>
  );
}
