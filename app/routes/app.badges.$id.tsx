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
} from "@shopify/polaris";
import { useState, useCallback, useEffect, useRef } from "react";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import type { DeliveryBadge } from "./app.badges._index";
import { GEO_REGIONS, COUNTRY_ONLY } from "../lib/geo-regions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getExampleDates() {
  const now = new Date();
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { start: fmt(addDays(now, 4)), end: fmt(addDays(now, 7)) };
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

const BADGE_TEMPLATES = [
  {
    label: "Make my own",
    nameBase: "My Delivery Badge",
    displayStyle: "outlined" as const,
    icon: "🚚",
    messageTemplate: "Estimated delivery: {date_start} – {date_end}",
    accentColor: "#2C6ECB",
    blank: true,
  },
  {
    label: "Standard",
    nameBase: "Standard Delivery",
    displayStyle: "outlined" as const,
    icon: "🚚",
    messageTemplate: "Estimated delivery: {date_start} – {date_end}",
    accentColor: "#2C6ECB",
  },
  {
    label: "Free ship",
    nameBase: "Free Shipping",
    displayStyle: "filled" as const,
    icon: "🚚",
    messageTemplate: "Free delivery by {date_end}",
    accentColor: "#008060",
  },
  {
    label: "Express",
    nameBase: "Express Delivery",
    displayStyle: "pill" as const,
    icon: "⚡",
    messageTemplate: "Express: arrives {date_start} – {date_end}",
    accentColor: "#E53935",
  },
  {
    label: "Minimal",
    nameBase: "Minimal Badge",
    displayStyle: "minimal" as const,
    icon: "📦",
    messageTemplate: "Ships {date_start} – {date_end}",
    accentColor: "#6D7175",
  },
];

// ─── Loader ──────────────────────────────────────────────────────────────────

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

  const { id } = params;
  if (id === "new") {
    return json({ badge: null, isNew: true, appInstallationId: data.data.currentAppInstallation.id });
  }

  const badge = badges.find((b) => b.id === id) || null;
  if (!badge) return redirect("/app/badges");
  return json({ badge, isNew: false, appInstallationId: data.data.currentAppInstallation.id, badges });
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
    return redirect("/app/badges");
  }

  return json({ ok: true });
}

// ─── Display style options ────────────────────────────────────────────────────

const DISPLAY_STYLES = [
  { value: "outlined", label: "Outlined", desc: "Border + text, transparent bg" },
  { value: "filled",   label: "Filled",   desc: "Solid color background" },
  { value: "minimal",  label: "Minimal",  desc: "Text only, no border" },
  { value: "pill",     label: "Pill",     desc: "Rounded pill with fill" },
] as const;
type DisplayStyle = (typeof DISPLAY_STYLES)[number]["value"];

const ICONS = [
  { value: "🚚", label: "Truck" },
  { value: "📦", label: "Box" },
  { value: "⏱️", label: "Timer" },
  { value: "✅", label: "Check" },
  { value: "🗓️", label: "Calendar" },
  { value: "⚡", label: "Express" },
  { value: "",   label: "None" },
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
  const { badge, isNew } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const shopify = useAppBridge();

  // ── Template state ──
  const [templateApplied, setTemplateApplied] = useState(!isNew);
  const showTemplates = isNew;

  // ── Form state ──
  const [selectedTab, setSelectedTab] = useState(0);
  const [name, setName] = useState(badge?.name ?? "New delivery badge");
  const [targetType, setTargetType] = useState<DeliveryBadge["targetType"]>(badge?.targetType ?? "all");
  const [productIds, setProductIds] = useState<Array<{ id: string; title: string }>>(badge?.productIds ?? []);
  const [collectionIds, setCollectionIds] = useState<Array<{ id: string; title: string }>>(badge?.collectionIds ?? []);
  const [tags, setTags] = useState<string[]>(badge?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [displayStyle, setDisplayStyle] = useState<DisplayStyle>(badge?.displayStyle ?? "outlined");
  const [icon, setIcon] = useState(badge?.icon ?? "🚚");
  const [messageTemplate, setMessageTemplate] = useState(badge?.messageTemplate ?? "Estimated delivery: {date_start} – {date_end}");
  const [accentColor, setAccentColor] = useState(badge?.accentColor ?? "#2C6ECB");
  const [processingDays, setProcessingDays] = useState(badge?.processingDays ?? "1");
  const [shippingDaysMin, setShippingDaysMin] = useState(badge?.shippingDaysMin ?? "3");
  const [shippingDaysMax, setShippingDaysMax] = useState(badge?.shippingDaysMax ?? "7");
  const [geoTargetType, setGeoTargetType] = useState<"all" | "specific">(badge?.geoTargetType ?? "all");
  const [geoTargets, setGeoTargets] = useState<string[]>(badge?.geoTargets ?? []);

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
    setMessageTemplate(t.messageTemplate);
    setAccentColor(t.accentColor);
    setAccentHsb(hexToHsb(t.accentColor));
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
    initialSnapshot.current = { name, targetType, displayStyle, icon, messageTemplate, accentColor, processingDays, shippingDaysMin, shippingDaysMax, geoTargetType, productIds: JSON.stringify(productIds), collectionIds: JSON.stringify(collectionIds), tags: JSON.stringify(tags), geoTargets: JSON.stringify(geoTargets) };
  }
  const snap = initialSnapshot.current;

  const isDirty = isNew
    ? snap !== null && (
        name !== snap.name || targetType !== snap.targetType || displayStyle !== snap.displayStyle ||
        icon !== snap.icon || messageTemplate !== snap.messageTemplate || accentColor !== snap.accentColor ||
        processingDays !== snap.processingDays || shippingDaysMin !== snap.shippingDaysMin || shippingDaysMax !== snap.shippingDaysMax ||
        geoTargetType !== snap.geoTargetType || JSON.stringify(productIds) !== snap.productIds ||
        JSON.stringify(collectionIds) !== snap.collectionIds || JSON.stringify(tags) !== snap.tags ||
        JSON.stringify(geoTargets) !== snap.geoTargets
      )
    : (
        name !== (badge?.name ?? "New delivery badge") || targetType !== (badge?.targetType ?? "all") ||
        displayStyle !== (badge?.displayStyle ?? "outlined") || icon !== (badge?.icon ?? "🚚") ||
        messageTemplate !== (badge?.messageTemplate ?? "Estimated delivery: {date_start} – {date_end}") ||
        accentColor !== (badge?.accentColor ?? "#2C6ECB") ||
        processingDays !== (badge?.processingDays ?? "1") || shippingDaysMin !== (badge?.shippingDaysMin ?? "3") ||
        shippingDaysMax !== (badge?.shippingDaysMax ?? "7") || geoTargetType !== (badge?.geoTargetType ?? "all") ||
        JSON.stringify(productIds) !== JSON.stringify(badge?.productIds ?? []) ||
        JSON.stringify(collectionIds) !== JSON.stringify(badge?.collectionIds ?? []) ||
        JSON.stringify(tags) !== JSON.stringify(badge?.tags ?? []) ||
        JSON.stringify(geoTargets) !== JSON.stringify(badge?.geoTargets ?? [])
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
      messageTemplate,
      accentColor,
      processingDays: processingDays || null,
      shippingDaysMin: shippingDaysMin || null,
      shippingDaysMax: shippingDaysMax || null,
    };
    const fd = new FormData();
    fd.append("intent", "save");
    fd.append("badge", JSON.stringify(badgeData));
    submit(fd, { method: "post" });
  }

  // ── Discard ──
  function handleDiscard() {
    shopify.saveBar.hide("badge-save-bar");
    if (isNew) { navigate("/app/badges"); return; }
    setName(badge?.name ?? "New delivery badge");
    setTargetType(badge?.targetType ?? "all");
    setProductIds(badge?.productIds ?? []);
    setCollectionIds(badge?.collectionIds ?? []);
    setTags(badge?.tags ?? []);
    setDisplayStyle(badge?.displayStyle ?? "outlined");
    setIcon(badge?.icon ?? "🚚");
    setMessageTemplate(badge?.messageTemplate ?? "Estimated delivery: {date_start} – {date_end}");
    setAccentColor(badge?.accentColor ?? "#2C6ECB");
    setAccentHsb(hexToHsb(badge?.accentColor ?? "#2C6ECB"));
    setProcessingDays(badge?.processingDays ?? "1");
    setShippingDaysMin(badge?.shippingDaysMin ?? "3");
    setShippingDaysMax(badge?.shippingDaysMax ?? "7");
    setGeoTargetType(badge?.geoTargetType ?? "all");
    setGeoTargets(badge?.geoTargets ?? []);
  }

  // ── Preview ──
  const { start, end } = getExampleDates();
  const previewText = messageTemplate
    .replace("{date_range}", `${start}–${end}`)
    .replace("{date_start}", start)
    .replace("{date_end}", end);

  const styleMap: Record<DisplayStyle, React.CSSProperties> = {
    outlined: { border: `1.5px solid ${accentColor}`, borderRadius: "6px", padding: "8px 14px", color: accentColor, backgroundColor: "transparent" },
    filled:   { backgroundColor: accentColor, borderRadius: "6px", padding: "8px 14px", color: "#fff" },
    minimal:  { color: accentColor, padding: "6px 0" },
    pill:     { backgroundColor: accentColor, borderRadius: "999px", padding: "7px 18px", color: "#fff" },
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
                    const preview = t.messageTemplate.replace("{date_start}", s).replace("{date_end}", e).replace("{date_range}", `${s}–${e}`);
                    const stylePreview: React.CSSProperties =
                      t.displayStyle === "filled"   ? { backgroundColor: t.accentColor, borderRadius: "6px", padding: "4px 8px", color: "#fff" } :
                      t.displayStyle === "pill"     ? { backgroundColor: t.accentColor, borderRadius: "999px", padding: "4px 10px", color: "#fff" } :
                      t.displayStyle === "minimal"  ? { color: t.accentColor } :
                      { border: `1.5px solid ${t.accentColor}`, borderRadius: "6px", padding: "4px 8px", color: t.accentColor };
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
                        ) : (
                          <div style={{ fontSize: "10px", fontWeight: 500, maxWidth: "80px", textAlign: "center", overflow: "hidden", ...stylePreview }}>
                            {t.icon} {preview.length > 20 ? preview.slice(0, 20) + "…" : preview}
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
                                        onClick={() => setDisplayStyle(s.value)}
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

                              <Divider />

                              {/* Icon */}
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="medium">Icon</Text>
                                <InlineStack gap="200" wrap>
                                  {ICONS.map((opt) => {
                                    const sel = icon === opt.value;
                                    return (
                                      <button
                                        key={opt.value || "none"}
                                        onClick={() => setIcon(opt.value)}
                                        title={opt.label}
                                        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "8px 10px", border: sel ? "2px solid #005bd3" : "1px solid #e1e3e5", borderRadius: "8px", backgroundColor: sel ? "#f0f5ff" : "white", cursor: "pointer", minWidth: "44px" }}
                                      >
                                        <span style={{ fontSize: "18px", lineHeight: 1 }}>{opt.value || "—"}</span>
                                        <span style={{ fontSize: "10px", color: "#6d7175" }}>{opt.label}</span>
                                      </button>
                                    );
                                  })}
                                </InlineStack>
                              </BlockStack>

                              <Divider />

                              {/* Message template */}
                              <BlockStack gap="200">
                                <TextField
                                  label="Message"
                                  value={messageTemplate}
                                  onChange={setMessageTemplate}
                                  helpText="Use {date_start}, {date_end}, or {date_range} as placeholders."
                                  autoComplete="off"
                                />
                                <InlineStack gap="200" wrap>
                                  {[
                                    { label: "Start date", value: "{date_start}" },
                                    { label: "End date",   value: "{date_end}" },
                                    { label: "Date range", value: "{date_range}" },
                                  ].map((v) => (
                                    <Button key={v.value} size="micro" onClick={() => setMessageTemplate((m) => m + v.value)}>
                                      + {v.label}
                                    </Button>
                                  ))}
                                </InlineStack>
                              </BlockStack>

                              <Divider />

                              {/* Accent color */}
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="medium">Accent color</Text>
                                <InlineStack gap="300" blockAlign="center">
                                  <Popover
                                    active={colorPickerOpen}
                                    activator={
                                      <div
                                        onClick={() => setColorPickerOpen((o) => !o)}
                                        title="Accent color"
                                        style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: accentColor, cursor: "pointer", border: "2px solid #c9cccf", boxSizing: "border-box", boxShadow: colorPickerOpen ? "0 0 0 3px #005bd340" : undefined }}
                                      />
                                    }
                                    onClose={() => { setColorPickerOpen(false); addToRecent(accentColor); }}
                                  >
                                    <Box padding="400" minWidth="260px">
                                      <BlockStack gap="300">
                                        <ColorPicker
                                          onChange={(c) => { setAccentHsb(c); setAccentColor(hsbToHex(c)); }}
                                          color={accentHsb}
                                          allowAlpha={false}
                                        />
                                        <TextField
                                          label="Hex"
                                          value={accentColor}
                                          onChange={(v) => { setAccentColor(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) setAccentHsb(hexToHsb(v)); }}
                                          autoComplete="off"
                                          monospaced
                                        />
                                        <BlockStack gap="150">
                                          <Text variant="bodySm" as="p" tone="subdued">Swatches</Text>
                                          <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4 }}>
                                            {ACCENT_COLORS.map((c) => (
                                              <div key={c} onClick={() => { setAccentColor(c); setAccentHsb(hexToHsb(c)); }} title={c} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, cursor: "pointer", border: accentColor.toUpperCase() === c.toUpperCase() ? "2px solid #005bd3" : "1px solid #c9cccf" }} />
                                            ))}
                                          </div>
                                        </BlockStack>
                                        {recentColors.length > 0 && (
                                          <BlockStack gap="150">
                                            <Text variant="bodySm" as="p" tone="subdued">Recently used</Text>
                                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                              {recentColors.map((c) => (
                                                <div key={c} onClick={() => { setAccentColor(c); setAccentHsb(hexToHsb(c)); }} title={c} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, cursor: "pointer", border: accentColor.toUpperCase() === c.toUpperCase() ? "2px solid #005bd3" : "1px solid #c9cccf" }} />
                                              ))}
                                            </div>
                                          </BlockStack>
                                        )}
                                      </BlockStack>
                                    </Box>
                                  </Popover>
                                  <TextField
                                    label=""
                                    labelHidden
                                    value={accentColor}
                                    onChange={(v) => { setAccentColor(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) setAccentHsb(hexToHsb(v)); }}
                                    placeholder="#2C6ECB"
                                    autoComplete="off"
                                    maxLength={7}
                                    monospaced
                                  />
                                </InlineStack>
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

                              {/* Delivery window */}
                              <BlockStack gap="300">
                                <BlockStack gap="050">
                                  <Text as="h3" variant="headingSm">Delivery window</Text>
                                  <Text as="p" variant="bodySm" tone="subdued">Set the processing and shipping time for this badge. These override app-level defaults.</Text>
                                </BlockStack>
                                <InlineGrid columns={3} gap="300">
                                  <TextField label="Processing days" type="number" value={String(processingDays ?? "")} onChange={setProcessingDays} autoComplete="off" min="0" helpText="Handling time" />
                                  <TextField label="Min shipping days" type="number" value={String(shippingDaysMin ?? "")} onChange={setShippingDaysMin} autoComplete="off" min="1" helpText="Earliest arrival" />
                                  <TextField label="Max shipping days" type="number" value={String(shippingDaysMax ?? "")} onChange={setShippingDaysMax} autoComplete="off" min="1" helpText="Latest arrival" />
                                </InlineGrid>
                              </BlockStack>

                              <Divider />

                              {/* Geo targeting */}
                              <BlockStack gap="300">
                                <BlockStack gap="050">
                                  <Text as="h3" variant="headingSm">Shipping regions</Text>
                                  <Text as="p" variant="bodySm" tone="subdued">Show this badge only to customers in specific regions. When location is unknown, the badge always shows.</Text>
                                </BlockStack>
                                <Select
                                  label="Regions"
                                  labelHidden
                                  options={[
                                    { label: "All regions", value: "all" },
                                    { label: "Specific states, provinces, or countries", value: "specific" },
                                  ]}
                                  value={geoTargetType}
                                  onChange={(v) => setGeoTargetType(v as "all" | "specific")}
                                />
                                {geoTargetType === "specific" && (
                                  <GeoTargetPicker selected={geoTargets} onChange={setGeoTargets} />
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
                    <Text variant="headingMd" as="h2">Preview</Text>

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
                      <div style={{ padding: "14px 16px 16px", background: "#fff" }}>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "#1a1a1a", marginBottom: "4px" }}>Product name</div>
                        <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "10px" }}>$49 USD</div>
                        {/* Delivery badge */}
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", fontFamily: "sans-serif", fontWeight: 500, ...styleMap[displayStyle] }}>
                          {icon && <span>{icon}</span>}
                          <span>{previewText}</span>
                        </div>
                      </div>
                    </div>

                    <Text variant="bodySm" tone="subdued" as="p">
                      Preview uses example dates based on your delivery window settings.
                    </Text>

                    <Divider />
                    <Button variant="primary" onClick={handleSave} loading={isSaving} fullWidth>Save badge</Button>
                    <Button url="/app/badges" fullWidth>Cancel</Button>
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
