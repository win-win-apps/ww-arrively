import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  Button,
  BlockStack,
  InlineStack,
  TextField,
  Text,
  Banner,
  Icon,
  Collapsible,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { authenticate } from "../shopify.server";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SavedZone = {
  id: string;
  name: string;
  geoCodes: string[];
  geoSummary: string;
  processingDays: string;
  shippingDaysMin: string;
  shippingDaysMax: string;
  expressEnabled: boolean;
  expressDaysMin: string;
  expressDaysMax: string;
  enabled: boolean;
};

export type ShippingMethod = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: number;
  isCalculated: boolean;
  parsedMin: number | null;
  parsedMax: number | null;
};

export type ShippingZone = {
  id: string;
  name: string;
  countryCodes: string[];
  methods: ShippingMethod[];
};

// ─── Loader ──────────────────────────────────────────────────────────────────

function parseDaysFromString(s: string | null | undefined): { min: number | null; max: number | null } {
  if (!s) return { min: null, max: null };
  const range = s.match(/(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})\s*(?:business|working|biz)?\s*days?/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = s.match(/(\d{1,3})\s*(?:business|working|biz)?\s*days?/i);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return { min: null, max: null };
}

// Convert seconds to business days (Shopify stores transit time in seconds)
function secondsToDays(s: number | null | undefined): number | null {
  if (s == null || s <= 0) return null;
  return Math.round(s / 86400);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let shippingZones: ShippingZone[] = [];

  // ── Try unstable API first (has minTransitTime/maxTransitTime) ──
  let gotTransitTime = false;
  try {
    const unstableRes = await fetch(
      `https://${session.shop}/admin/api/unstable/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken!,
        },
        body: JSON.stringify({
          query: `{
            deliveryProfiles(first: 10) {
              nodes {
                id
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
                          rateGroups(first: 10) {
                            nodes {
                              rateProviders(first: 10) {
                                nodes {
                                  ... on DeliveryRateDefinition {
                                    id
                                    price { amount }
                                    minTransitTime
                                    maxTransitTime
                                  }
                                  ... on DeliveryParticipant {
                                    id
                                    carrierService { name }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`,
        }),
      }
    );

    const ud = await unstableRes.json();
    const profiles = ud?.data?.deliveryProfiles?.nodes ?? [];
    const seen = new Set<string>();

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
          const methods: ShippingMethod[] = [];

          for (const m of methodNodes) {
            if (m?.active === false) continue;
            const rateGroups = m?.rateGroups?.nodes ?? [];
            // Collect all rate providers from all rate groups
            let bestMin: number | null = null;
            let bestMax: number | null = null;
            let price = 0;
            let isCalculated = false;

            for (const rg of rateGroups) {
              const providers = rg?.rateProviders?.nodes ?? [];
              for (const rp of providers) {
                if (rp?.__typename === "DeliveryParticipant") {
                  isCalculated = true;
                } else if (rp?.__typename === "DeliveryRateDefinition") {
                  price = Number(rp?.price?.amount ?? 0);
                  const minD = secondsToDays(rp?.minTransitTime);
                  const maxD = secondsToDays(rp?.maxTransitTime);
                  // Take the widest range across all rate definitions
                  if (minD !== null && (bestMin === null || minD < bestMin)) bestMin = minD;
                  if (maxD !== null && (bestMax === null || maxD > bestMax)) bestMax = maxD;
                }
              }
            }

            // Also try parsing from name/description as fallback
            if (bestMin === null || bestMax === null) {
              const parsed = parseDaysFromString(`${m?.name ?? ""} ${m?.description ?? ""}`);
              if (bestMin === null) bestMin = parsed.min;
              if (bestMax === null) bestMax = parsed.max;
            }

            methods.push({
              id: m.id,
              name: m.name || "Shipping",
              description: m.description ?? null,
              priceAmount: isCalculated ? -1 : price,
              isCalculated,
              parsedMin: bestMin,
              parsedMax: bestMax,
            });
          }

          shippingZones.push({
            id: z.id,
            name: z.name,
            countryCodes,
            methods,
          });
        }
      }
    }

    if (shippingZones.length > 0) gotTransitTime = true;
  } catch {
    // Unstable API failed, fall through to stable
  }

  // ── Fallback: stable API (no transit time, uses name/description parsing) ──
  if (!gotTransitTime) {
    try {
      const zonesRes = await admin.graphql(`
        query {
          deliveryProfiles(first: 10) {
            nodes {
              id
              name
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
                const priceAmount = isCalculated ? -1 : Number(rp?.price?.amount ?? 0);
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
    } catch {
      shippingZones = [];
    }
  }

  // Fetch saved zones + config from metafields
  let savedZones: SavedZone[] = [];
  let cutoffTime = "11:00";
  let excludeWeekends = true;
  try {
    const metaRes = await admin.graphql(`
      query {
        currentAppInstallation {
          metafields(first: 10, namespace: "$app") {
            nodes { key value }
          }
        }
      }
    `);
    const metaData = await metaRes.json();
    const nodes = metaData?.data?.currentAppInstallation?.metafields?.nodes ?? [];
    const zonesField = nodes.find((m: any) => m.key === "zones");
    if (zonesField?.value) {
      savedZones = JSON.parse(zonesField.value);
    }
    const configField = nodes.find((m: any) => m.key === "config");
    if (configField?.value) {
      const cfg = JSON.parse(configField.value);
      if (cfg.cutoffTime) cutoffTime = cfg.cutoffTime;
      else if (cfg.cutoffHour) cutoffTime = `${cfg.cutoffHour.padStart(2, "0")}:00`;
      if (cfg.excludeWeekends !== undefined) excludeWeekends = cfg.excludeWeekends;
    }
  } catch {
    savedZones = [];
  }

  return json({ shippingZones, savedZones, cutoffTime, excludeWeekends });
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false });

  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const zonesJson = formData.get("zones") as string;
  const zones: SavedZone[] = JSON.parse(zonesJson);
  const cutoffTime = formData.get("cutoffTime") as string || "";
  const excludeWeekends = formData.get("excludeWeekends") === "true";

  const installRes = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafield(namespace: "$app", key: "config") { value }
      }
    }
  `);
  const installData = await installRes.json();
  const installId = installData?.data?.currentAppInstallation?.id;
  const existingConfig = (() => {
    try { return JSON.parse(installData?.data?.currentAppInstallation?.metafield?.value || "{}"); } catch { return {}; }
  })();

  // Merge cutoff into existing config
  const updatedConfig = { ...existingConfig, cutoffTime, excludeWeekends };

  if (installId) {
    await admin.graphql(
      `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: installId,
              namespace: "$app",
              key: "zones",
              value: JSON.stringify(zones),
              type: "json",
            },
            {
              ownerId: installId,
              namespace: "$app",
              key: "config",
              value: JSON.stringify(updatedConfig),
              type: "json",
            },
          ],
        },
      }
    );
  }

  return json({ ok: true });
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickStandardAndExpress(methods: ShippingMethod[]): {
  standardMin: number; standardMax: number;
  expressMin: number | null; expressMax: number | null;
} {
  // Methods with parsed day ranges
  const withDays = methods.filter((m) => m.parsedMin !== null && m.parsedMax !== null);

  if (withDays.length === 0) {
    return { standardMin: 3, standardMax: 7, expressMin: null, expressMax: null };
  }

  // Standard = slowest (highest max days)
  const standard = withDays.reduce((a, b) => ((b.parsedMax ?? 0) > (a.parsedMax ?? 0) ? b : a));
  // Express = fastest (lowest max days), only if different from standard
  const express = withDays.reduce((a, b) => ((b.parsedMax ?? 99) < (a.parsedMax ?? 99) ? b : a));

  const hasExpress = express.id !== standard.id && (express.parsedMax ?? 99) < (standard.parsedMax ?? 0);

  return {
    standardMin: standard.parsedMin ?? 3,
    standardMax: standard.parsedMax ?? 7,
    expressMin: hasExpress ? (express.parsedMin ?? 1) : null,
    expressMax: hasExpress ? (express.parsedMax ?? 2) : null,
  };
}

function buildZoneFromShopify(zone: ShippingZone): SavedZone {
  const countrySummary = zone.countryCodes.slice(0, 4).join(", ")
    + (zone.countryCodes.length > 4 ? ` +${zone.countryCodes.length - 4}` : "");

  const { standardMin, standardMax, expressMin, expressMax } = pickStandardAndExpress(zone.methods);

  return {
    id: zone.id,
    name: zone.name,
    geoCodes: zone.countryCodes,
    geoSummary: countrySummary || "All regions",
    processingDays: "1",
    shippingDaysMin: String(standardMin),
    shippingDaysMax: String(standardMax),
    expressEnabled: true,
    expressDaysMin: expressMin !== null ? String(expressMin) : "1",
    expressDaysMax: expressMax !== null ? String(expressMax) : "2",
    enabled: true,
  };
}

function buildFallback(zones: SavedZone[]): SavedZone {
  const enabled = zones.filter((z) => z.enabled && z.id !== "fallback");
  let maxShip = "7";
  let maxProc = "1";
  if (enabled.length > 0) {
    maxShip = String(Math.max(...enabled.map((z) => Number(z.shippingDaysMax) || 7)));
    maxProc = String(Math.max(...enabled.map((z) => Number(z.processingDays) || 0)));
  }
  return {
    id: "fallback",
    name: "All other customers",
    geoCodes: [],
    geoSummary: "Worldwide fallback",
    processingDays: maxProc,
    shippingDaysMin: "3",
    shippingDaysMax: maxShip,
    expressEnabled: false,
    expressDaysMin: "",
    expressDaysMax: "",
    enabled: true,
  };
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ZonesPage() {
  const { shippingZones, savedZones: initialZones, cutoffTime: initialCutoff, excludeWeekends: initialExcludeWeekends } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const didAutoImport = useRef(false);

  const initialRegular = initialZones.filter((z) => z.id !== "fallback");
  const initialFallback = initialZones.find((z) => z.id === "fallback");

  const [zones, setZones] = useState<SavedZone[]>(initialRegular);
  const [fallbackZone, setFallbackZone] = useState<SavedZone>(
    initialFallback || buildFallback(initialRegular)
  );
  const [cutoffTime, setCutoffTime] = useState(initialCutoff || "11:00");
  const [excludeWeekends, setExcludeWeekends] = useState(initialExcludeWeekends ?? true);
  const [moreOpen, setMoreOpen] = useState(false);

  // Snapshot for dirty checking (set after auto-import or from initial data)
  const snapshot = useRef<string>("");

  // Auto-import on first visit if nothing saved — auto-save immediately
  useEffect(() => {
    if (didAutoImport.current) return;
    didAutoImport.current = true;
    if (initialRegular.length === 0 && shippingZones.length > 0) {
      const imported = shippingZones.map(buildZoneFromShopify);
      const fb = buildFallback(imported);
      setZones(imported);
      setFallbackZone(fb);
      // Auto-save so zones persist to metafields immediately
      const allZones = [...imported, fb];
      const formData = new FormData();
      formData.append("zones", JSON.stringify(allZones));
      formData.append("cutoffTime", initialCutoff || "11:00");
      formData.append("excludeWeekends", String(initialExcludeWeekends ?? true));
      submit(formData, { method: "POST" });
      const snap = JSON.stringify({ zones: imported, fallback: fb, cutoffTime: initialCutoff || "11:00", excludeWeekends: initialExcludeWeekends ?? true });
      snapshot.current = snap;
    } else {
      snapshot.current = JSON.stringify({ zones: initialRegular, fallback: initialFallback || buildFallback(initialRegular), cutoffTime: initialCutoff || "11:00", excludeWeekends: initialExcludeWeekends ?? true });
    }
  }, []);

  // Keep fallback synced
  useEffect(() => {
    setFallbackZone((prev) => {
      const updated = buildFallback(zones);
      return { ...prev, shippingDaysMax: updated.shippingDaysMax, processingDays: updated.processingDays };
    });
  }, [zones]);

  // ── Validation ──
  const validateZone = useCallback((z: SavedZone): Record<string, boolean> => {
    if (!z.enabled) return {};
    const errs: Record<string, boolean> = {};
    const proc = z.processingDays.trim();
    const sMin = z.shippingDaysMin.trim();
    const sMax = z.shippingDaysMax.trim();
    // Processing: required, whole number >= 0
    if (!proc || !/^\d+$/.test(proc)) errs.processingDays = true;
    // Min days: required, whole number >= 0
    if (!sMin || !/^\d+$/.test(sMin)) errs.shippingDaysMin = true;
    // Max days: required, whole number >= 0
    if (!sMax || !/^\d+$/.test(sMax)) errs.shippingDaysMax = true;
    // Max must be >= min (only if both are valid numbers)
    if (!errs.shippingDaysMin && !errs.shippingDaysMax && Number(sMax) < Number(sMin)) {
      errs.shippingDaysMax = true;
    }
    // Express fields (only if express enabled)
    if (z.expressEnabled) {
      const eMin = z.expressDaysMin.trim();
      const eMax = z.expressDaysMax.trim();
      if (!eMin || !/^\d+$/.test(eMin)) errs.expressDaysMin = true;
      if (!eMax || !/^\d+$/.test(eMax)) errs.expressDaysMax = true;
      if (!errs.expressDaysMin && !errs.expressDaysMax && Number(eMax) < Number(eMin)) {
        errs.expressDaysMax = true;
      }
    }
    return errs;
  }, []);

  const zoneErrors = useMemo(() => zones.map(validateZone), [zones, validateZone]);
  const fallbackErrors = useMemo(() => {
    const errs: Record<string, boolean> = {};
    const proc = fallbackZone.processingDays.trim();
    const sMin = fallbackZone.shippingDaysMin.trim();
    const sMax = fallbackZone.shippingDaysMax.trim();
    if (!proc || !/^\d+$/.test(proc)) errs.processingDays = true;
    if (!sMin || !/^\d+$/.test(sMin)) errs.shippingDaysMin = true;
    if (!sMax || !/^\d+$/.test(sMax)) errs.shippingDaysMax = true;
    if (!errs.shippingDaysMin && !errs.shippingDaysMax && Number(sMax) < Number(sMin)) {
      errs.shippingDaysMax = true;
    }
    return errs;
  }, [fallbackZone]);

  const hasErrors = useMemo(() =>
    zoneErrors.some((e) => Object.keys(e).length > 0) || Object.keys(fallbackErrors).length > 0,
    [zoneErrors, fallbackErrors]
  );

  // Dirty tracking
  const currentState = useMemo(() =>
    JSON.stringify({ zones, fallback: fallbackZone, cutoffTime, excludeWeekends }),
    [zones, fallbackZone, cutoffTime, excludeWeekends]
  );
  const isDirty = snapshot.current !== "" && currentState !== snapshot.current;

  // Show/hide native SaveBar
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isDirty) {
      timer = setTimeout(() => shopify.saveBar.show("zones-save-bar"), 0);
    } else {
      shopify.saveBar.hide("zones-save-bar");
    }
    return () => { clearTimeout(timer); shopify.saveBar.hide("zones-save-bar"); };
  }, [isDirty]);

  const handleSave = useCallback(() => {
    if (hasErrors) {
      shopify.toast.show("Fix the highlighted fields before saving", { isError: true });
      return;
    }
    shopify.saveBar.hide("zones-save-bar");
    const allZones = [...zones, fallbackZone];
    const formData = new FormData();
    formData.append("zones", JSON.stringify(allZones));
    formData.append("cutoffTime", cutoffTime);
    formData.append("excludeWeekends", String(excludeWeekends));
    submit(formData, { method: "POST" });
    // Update snapshot after save
    snapshot.current = currentState;
  }, [zones, fallbackZone, cutoffTime, excludeWeekends, submit, currentState, hasErrors]);

  const handleDiscard = useCallback(() => {
    shopify.saveBar.hide("zones-save-bar");
    if (!snapshot.current) return;
    try {
      const snap = JSON.parse(snapshot.current);
      setZones(snap.zones);
      setFallbackZone(snap.fallback);
      setCutoffTime(snap.cutoffTime);
      setExcludeWeekends(snap.excludeWeekends);
    } catch { /* ignore */ }
  }, []);

  const updateZone = useCallback((idx: number, field: string, value: string | boolean) => {
    setZones((prev) => {
      const next = [...prev];
      // Strip decimals from numeric fields
      let cleanVal = value;
      if (typeof value === "string" && ["processingDays", "shippingDaysMin", "shippingDaysMax", "expressDaysMin", "expressDaysMax"].includes(field)) {
        cleanVal = value.replace(/[^0-9]/g, "");
      }
      const zone = { ...next[idx], [field]: cleanVal };
      next[idx] = zone;
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    // Full refresh: rebuild all zones from Shopify data including transit times
    const freshFromShopify = shippingZones.map(buildZoneFromShopify);
    const existingById = new Map(zones.map((z) => [z.id, z]));

    const merged = freshFromShopify.map((fresh) => {
      const existing = existingById.get(fresh.id);
      if (existing) {
        // Overwrite everything from Shopify, but keep enabled/expressEnabled toggles
        return {
          ...fresh,
          enabled: existing.enabled,
          expressEnabled: existing.expressEnabled,
        };
      }
      return fresh;
    });

    // Keep any manually added zones that aren't in Shopify
    const freshIds = new Set(freshFromShopify.map((z) => z.id));
    const manualZones = zones.filter((z) => !freshIds.has(z.id) && z.id !== "fallback");

    setZones([...merged, ...manualZones]);
    shopify.toast.show("Zones refreshed from Shopify");
  }, [zones, shippingZones]);

  // ─── Styles ─────────────────────────────────────────────────────────────

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
  };
  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 10px",
    fontWeight: 600,
    color: "#6d7175",
    fontSize: "12px",
    borderBottom: "2px solid #e1e3e5",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 10px",
    borderBottom: "1px solid #f1f2f4",
    verticalAlign: "middle",
  };
  const inputStyle: React.CSSProperties = {
    width: "54px",
    padding: "6px 8px",
    border: "1px solid #c9cccf",
    borderRadius: "6px",
    fontSize: "13px",
    textAlign: "center",
    outline: "none",
  };
  const errorInputStyle: React.CSSProperties = {
    ...inputStyle,
    border: "1.5px solid #d72c0d",
    backgroundColor: "#fff4f4",
  };
  const expressRowStyle: React.CSSProperties = {
    ...tdStyle,
    paddingTop: "4px",
    paddingBottom: "10px",
    borderBottom: "1px solid #f1f2f4",
  };
  const toggleStyle = (on: boolean): React.CSSProperties => ({
    width: 32,
    height: 18,
    borderRadius: 9,
    border: "none",
    backgroundColor: on ? "#008060" : "#c4cdd5",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    padding: "2px",
    transition: "background-color 0.2s",
    flexShrink: 0,
  });
  const toggleDotStyle = (on: boolean): React.CSSProperties => ({
    width: 14,
    height: 14,
    borderRadius: "50%",
    backgroundColor: "white",
    marginLeft: on ? "auto" : 0,
    transition: "margin 0.15s",
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      <SaveBar id="zones-save-bar">
        <button variant="primary" onClick={handleSave} loading={isSaving ? "" : undefined}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>

      <Page title="Shipping Zones">
        <div style={{ maxWidth: "600px" }}>
          <BlockStack gap="400">

            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" tone="subdued">
                Delivery windows are pulled from your Shopify shipping profiles. Adjust the days below and they'll be used in your delivery badges.
              </Text>
              {shippingZones.length === 0 && zones.length === 0 && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    No zones found in your Shopify shipping profiles. Set up shipping rates in Settings → Shipping and delivery first.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>

          {/* ── Zones table ── */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm">Your zones</Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Button onClick={handleRefresh} variant="plain" size="slim">
                      Refresh from Shopify
                    </Button>
                    {isDirty && (
                      <Button variant="primary" size="slim" onClick={handleSave} loading={isSaving}>
                        Save
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>

              {zones.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, width: "36px" }}></th>
                        <th style={thStyle}>Zone</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>Processing</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>Min days</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>Max days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zones.map((zone, idx) => (
                        <>
                          {/* Zone divider */}
                          {idx > 0 && (
                            <tr key={`${zone.id}-divider`}>
                              <td colSpan={5} style={{ padding: 0, borderBottom: "none" }}>
                                <div style={{ borderTop: "1px solid #e1e3e5", margin: "0" }} />
                              </td>
                            </tr>
                          )}
                          {/* Standard row */}
                          <tr key={zone.id} style={{ opacity: zone.enabled ? 1 : 0.45 }}>
                            <td style={{ ...tdStyle, borderBottom: "none", textAlign: "center" }}>
                              <button
                                type="button"
                                onClick={() => updateZone(idx, "enabled", !zone.enabled)}
                                style={toggleStyle(zone.enabled)}
                                title={zone.enabled ? "Disable zone" : "Enable zone"}
                              >
                                <div style={toggleDotStyle(zone.enabled)} />
                              </button>
                            </td>
                            <td style={{ ...tdStyle, borderBottom: "none" }}>
                              <div style={{ lineHeight: 1.3 }}>
                                <strong>{zone.name}</strong>
                                <div style={{ fontSize: "11px", color: "#8c9196", marginTop: "2px" }}>{zone.geoSummary}</div>
                              </div>
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center", borderBottom: "none" }}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={zone.processingDays}
                                onChange={(e) => updateZone(idx, "processingDays", e.target.value)}
                                style={{ ...(zoneErrors[idx]?.processingDays ? errorInputStyle : inputStyle), ...(zone.enabled ? {} : { pointerEvents: "none" }) }}
                                disabled={!zone.enabled}
                              />
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center", borderBottom: "none" }}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={zone.shippingDaysMin}
                                onChange={(e) => updateZone(idx, "shippingDaysMin", e.target.value)}
                                style={{ ...(zoneErrors[idx]?.shippingDaysMin ? errorInputStyle : inputStyle), ...(zone.enabled ? {} : { pointerEvents: "none" }) }}
                                disabled={!zone.enabled}
                              />
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center", borderBottom: "none" }}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={zone.shippingDaysMax}
                                onChange={(e) => updateZone(idx, "shippingDaysMax", e.target.value)}
                                style={{ ...(zoneErrors[idx]?.shippingDaysMax ? errorInputStyle : inputStyle), ...(zone.enabled ? {} : { pointerEvents: "none" }) }}
                                disabled={!zone.enabled}
                              />
                            </td>
                          </tr>

                          {/* Express sub-row */}
                          <tr key={`${zone.id}-express`} style={{ opacity: zone.enabled && zone.expressEnabled ? 1 : 0.45 }}>
                            <td style={{ ...expressRowStyle, textAlign: "center" }}>
                              {zone.enabled && (
                                <button
                                  type="button"
                                  onClick={() => updateZone(idx, "expressEnabled", !zone.expressEnabled)}
                                  style={toggleStyle(zone.expressEnabled)}
                                  title={zone.expressEnabled ? "Disable express" : "Enable express"}
                                >
                                  <div style={toggleDotStyle(zone.expressEnabled)} />
                                </button>
                              )}
                            </td>
                            <td style={expressRowStyle}>
                              <div style={{ paddingLeft: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ color: "#8c9196", fontSize: "13px" }}>↳</span>
                                <span style={{ fontSize: "12px", color: "#202223", fontWeight: 500 }}>
                                  Express
                                </span>
                              </div>
                            </td>
                            <td style={{ ...expressRowStyle, textAlign: "center" }}>
                              <input
                                type="number"
                                min="0"
                                value={zone.processingDays}
                                disabled
                                style={{ ...inputStyle, opacity: 0.4 }}
                                title="Same as standard"
                              />
                            </td>
                            <td style={{ ...expressRowStyle, textAlign: "center" }}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={zone.expressDaysMin}
                                onChange={(e) => updateZone(idx, "expressDaysMin", e.target.value)}
                                style={{ ...(zoneErrors[idx]?.expressDaysMin ? errorInputStyle : inputStyle), ...(zone.enabled && zone.expressEnabled ? {} : { pointerEvents: "none" }) }}
                                disabled={!zone.enabled || !zone.expressEnabled}
                                placeholder="1"
                              />
                            </td>
                            <td style={{ ...expressRowStyle, textAlign: "center" }}>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={zone.expressDaysMax}
                                onChange={(e) => updateZone(idx, "expressDaysMax", e.target.value)}
                                style={{ ...(zoneErrors[idx]?.expressDaysMax ? errorInputStyle : inputStyle), ...(zone.enabled && zone.expressEnabled ? {} : { pointerEvents: "none" }) }}
                                disabled={!zone.enabled || !zone.expressEnabled}
                                placeholder="2"
                              />
                            </td>
                          </tr>
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {zones.length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  No zones yet. Click "Refresh from Shopify" to pull your shipping zones, or they'll be imported automatically on your next visit.
                </Text>
              )}
              </BlockStack>
            </Card>

          {/* ── Fallback zone ── */}
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingSm">Fallback zone</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Used when a customer's location can't be detected. Defaults to the slowest zone's window.
                </Text>
              </BlockStack>

              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Zone</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Processing</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Min days</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Max days</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={tdStyle}>
                        <div style={{ lineHeight: 1.3 }}>
                          <strong>All other customers</strong>
                          <div style={{ fontSize: "11px", color: "#8c9196", marginTop: "2px" }}>Worldwide fallback</div>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={fallbackZone.processingDays}
                          onChange={(e) => setFallbackZone({ ...fallbackZone, processingDays: e.target.value.replace(/[^0-9]/g, "") })}
                          style={fallbackErrors.processingDays ? errorInputStyle : inputStyle}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={fallbackZone.shippingDaysMin}
                          onChange={(e) => setFallbackZone({ ...fallbackZone, shippingDaysMin: e.target.value.replace(/[^0-9]/g, "") })}
                          style={fallbackErrors.shippingDaysMin ? errorInputStyle : inputStyle}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={fallbackZone.shippingDaysMax}
                          onChange={(e) => setFallbackZone({ ...fallbackZone, shippingDaysMax: e.target.value.replace(/[^0-9]/g, "") })}
                          style={fallbackErrors.shippingDaysMax ? errorInputStyle : inputStyle}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </BlockStack>
          </Card>

          {/* ── More options (collapsible) ── */}
          <div>
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                color: "#6d7175",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              <Icon source={moreOpen ? ChevronUpIcon : ChevronDownIcon} />
              More options
            </button>
            <Collapsible open={moreOpen} id="more-options">
              <div style={{ paddingTop: "12px" }}>
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">Same-day cutoff</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Orders placed before this time ship today. After the cutoff, today is skipped and the clock starts tomorrow.
                      </Text>
                    </BlockStack>
                    <div style={{ maxWidth: "180px" }}>
                      <TextField
                        label="Cutoff time"
                        labelHidden
                        type="time"
                        value={cutoffTime}
                        onChange={setCutoffTime}
                        autoComplete="off"
                        helpText={cutoffTime ? `Orders after ${cutoffTime} ship tomorrow.` : "No cutoff set."}
                      />
                    </div>

                    <div style={{ borderTop: "1px solid #f1f2f4", paddingTop: "12px" }}>
                      <InlineStack blockAlign="center" gap="200">
                        <button
                          type="button"
                          onClick={() => setExcludeWeekends(!excludeWeekends)}
                          style={{
                            width: 32,
                            height: 18,
                            borderRadius: 9,
                            border: "none",
                            backgroundColor: excludeWeekends ? "#008060" : "#c4cdd5",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px",
                            transition: "background-color 0.2s",
                            flexShrink: 0,
                          }}
                        >
                          <div style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            backgroundColor: "white",
                            marginLeft: excludeWeekends ? "auto" : 0,
                            transition: "margin 0.15s",
                          }} />
                        </button>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" fontWeight="medium">Skip weekends</Text>
                          <Text as="span" variant="bodySm" tone="subdued">Don't count Saturday/Sunday as shipping days.</Text>
                        </BlockStack>
                      </InlineStack>
                    </div>
                  </BlockStack>
                </Card>
              </div>
            </Collapsible>
          </div>

          <div style={{ paddingBottom: "24px" }} />

        </BlockStack>
      </div>
    </Page>
    </>
  );
}
