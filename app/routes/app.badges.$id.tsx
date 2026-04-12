import { useState, useCallback, useEffect } from "react";
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
  InlineStack,
  BlockStack,
  Text,
  Box,
  Badge,
  Divider,
  RadioButton,
  Tag,
  Banner,
  Spinner,
  InlineGrid,
  Tooltip,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import type { DeliveryBadge } from "./app.badges._index";
import { GEO_REGIONS, COUNTRY_ONLY } from "../lib/geo-regions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getExampleDates(): { start: string; end: string } {
  const now = new Date();
  const addDays = (d: Date, n: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { start: fmt(addDays(now, 4)), end: fmt(addDays(now, 7)) };
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  // Read existing badges from metafield
  const res = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafield(namespace: "$app", key: "badges") {
          value
        }
      }
    }
  `);
  const data = await res.json();
  const raw = data?.data?.currentAppInstallation?.metafield?.value;
  let badges: DeliveryBadge[] = [];
  try {
    badges = JSON.parse(raw || "[]");
  } catch {
    badges = [];
  }

  const { id } = params;
  if (id === "new") {
    return json({ badge: null, appInstallationId: data.data.currentAppInstallation.id });
  }

  const badge = badges.find((b) => b.id === id) || null;
  if (!badge) {
    return redirect("/app/badges");
  }
  return json({ badge, appInstallationId: data.data.currentAppInstallation.id, badges });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Read current badges
  const res = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafield(namespace: "$app", key: "badges") {
          value
        }
      }
    }
  `);
  const data = await res.json();
  const raw = data?.data?.currentAppInstallation?.metafield?.value;
  let badges: DeliveryBadge[] = [];
  try {
    badges = JSON.parse(raw || "[]");
  } catch {
    badges = [];
  }
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
      if (idx !== -1) {
        badges[idx] = { ...badges[idx], ...incoming };
      } else {
        badges.push(incoming);
      }
    }

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
              key: "badges",
              value: JSON.stringify(badges),
              type: "json",
            },
          ],
        },
      }
    );

    return redirect("/app/badges");
  }

  return json({ ok: true });
}

// ─── Icon options ─────────────────────────────────────────────────────────────

const ICONS = [
  { value: "🚚", label: "🚚 Truck" },
  { value: "📦", label: "📦 Box" },
  { value: "⏱️", label: "⏱️ Timer" },
  { value: "✅", label: "✅ Check" },
  { value: "🗓️", label: "🗓️ Calendar" },
  { value: "", label: "None" },
];

const DISPLAY_STYLES = [
  {
    value: "outlined",
    label: "Outlined",
    desc: "Border + text, transparent background",
  },
  {
    value: "filled",
    label: "Filled",
    desc: "Solid color background",
  },
  {
    value: "minimal",
    label: "Minimal",
    desc: "Text only, no border or background",
  },
  {
    value: "pill",
    label: "Pill",
    desc: "Rounded pill shape with fill",
  },
] as const;

type DisplayStyle = (typeof DISPLAY_STYLES)[number]["value"];

// ─── Preview component ────────────────────────────────────────────────────────

function LivePreview({
  style,
  icon,
  template,
  color,
}: {
  style: DisplayStyle;
  icon: string;
  template: string;
  color: string;
}) {
  const { start, end } = getExampleDates();
  const message = template
    .replace("{date_range}", `${start}–${end}`)
    .replace("{date_start}", start)
    .replace("{date_end}", end);

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "14px",
    fontFamily: "sans-serif",
    "--arrively-accent": color,
  } as React.CSSProperties;

  const styleMap: Record<DisplayStyle, React.CSSProperties> = {
    outlined: {
      border: `1.5px solid ${color}`,
      borderRadius: "6px",
      padding: "6px 12px",
      color: color,
    },
    filled: {
      background: color,
      borderRadius: "6px",
      padding: "6px 12px",
      color: "#fff",
    },
    minimal: {
      color: color,
      padding: "4px 0",
    },
    pill: {
      background: color,
      borderRadius: "999px",
      padding: "5px 14px",
      color: "#fff",
    },
  };

  return (
    <Box
      background="bg-surface-secondary"
      padding="400"
      borderRadius="200"
    >
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd" tone="subdued">
          Preview
        </Text>
        <Box padding="300">
          <span style={{ ...baseStyle, ...styleMap[style] }}>
            {icon && <span>{icon}</span>}
            <span>{message}</span>
          </span>
        </Box>
      </BlockStack>
    </Box>
  );
}

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput("");
  }

  return (
    <BlockStack gap="200">
      <InlineStack gap="200" wrap>
        {tags.map((t) => (
          <Tag key={t} onRemove={() => onChange(tags.filter((x) => x !== t))}>
            {t}
          </Tag>
        ))}
      </InlineStack>
      <InlineStack gap="200" blockAlign="center">
        <div style={{ flex: 1 }}>
          <TextField
            label=""
            labelHidden
            placeholder="Add a tag, then press Enter"
            value={input}
            onChange={setInput}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            autoComplete="off"
          />
        </div>
        <Button onClick={addTag} disabled={!input.trim()}>
          Add
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

// ─── Geo target picker ────────────────────────────────────────────────────────

function GeoTargetPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(
    () => new Set(selected.map((c) => c.split("-")[0]))
  );

  const toggle = (code: string) => {
    onChange(
      selected.includes(code)
        ? selected.filter((c) => c !== code)
        : [...selected, code]
    );
  };

  const toggleCountry = (countryCode: string, allCodes: string[]) => {
    const allSelected = allCodes.every((c) => selected.includes(c));
    if (allSelected) {
      onChange(selected.filter((c) => !allCodes.includes(c) && c !== countryCode));
    } else {
      onChange([...new Set([...selected, ...allCodes])]);
    }
  };

  const toggleExpand = (countryCode: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      next.has(countryCode) ? next.delete(countryCode) : next.add(countryCode);
      return next;
    });
  };

  const q = search.toLowerCase();

  const filteredRegions = GEO_REGIONS.map((country) => ({
    ...country,
    provinces: country.provinces.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        country.countryName.toLowerCase().includes(q)
    ),
  })).filter(
    (c) =>
      !q ||
      c.countryName.toLowerCase().includes(q) ||
      c.provinces.length > 0
  );

  const filteredCountryOnly = COUNTRY_ONLY.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q)
  );

  const totalSelected = selected.length;

  return (
    <BlockStack gap="300">
      {totalSelected > 0 && (
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {totalSelected} region{totalSelected !== 1 ? "s" : ""} selected
          </Text>
          <Button
            size="slim"
            variant="plain"
            tone="critical"
            onClick={() => onChange([])}
          >
            Clear all
          </Button>
        </InlineStack>
      )}

      {/* Search */}
      <TextField
        label=""
        labelHidden
        placeholder="Search countries and regions…"
        value={search}
        onChange={setSearch}
        autoComplete="off"
        clearButton
        onClearButtonClick={() => setSearch("")}
      />

      {/* Region list */}
      <div
        style={{
          border: "1px solid #e1e3e5",
          borderRadius: "8px",
          maxHeight: "380px",
          overflowY: "auto",
        }}
      >
        {filteredRegions.map((country, ci) => {
          const allCodes = country.provinces.map((p) => p.code);
          const selectedCount = allCodes.filter((c) => selected.includes(c)).length;
          const allChecked = allCodes.length > 0 && selectedCount === allCodes.length;
          const someChecked = selectedCount > 0 && selectedCount < allCodes.length;
          const isExpanded = expandedCountries.has(country.countryCode);

          return (
            <div
              key={country.countryCode}
              style={{
                borderBottom:
                  ci < filteredRegions.length - 1 || filteredCountryOnly.length > 0
                    ? "1px solid #e1e3e5"
                    : "none",
              }}
            >
              {/* Country header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 14px",
                  backgroundColor: "#f6f6f7",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={() => toggleCountry(country.countryCode, allCodes)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span
                  style={{ flex: 1, fontWeight: 600, fontSize: "13px" }}
                  onClick={() => toggleExpand(country.countryCode)}
                >
                  {country.flag} {country.countryName}
                  {selectedCount > 0 && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: "11px",
                        color: "#005bd3",
                        fontWeight: 500,
                      }}
                    >
                      ({selectedCount}/{allCodes.length})
                    </span>
                  )}
                </span>
                <span
                  style={{ color: "#8c9196", fontSize: "11px" }}
                  onClick={() => toggleExpand(country.countryCode)}
                >
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>

              {/* Province grid */}
              {isExpanded && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "2px",
                    padding: "8px 14px 12px",
                    backgroundColor: "white",
                  }}
                >
                  {country.provinces
                    .filter(
                      (p) =>
                        !q ||
                        p.name.toLowerCase().includes(q) ||
                        country.countryName.toLowerCase().includes(q)
                    )
                    .map((province) => (
                      <label
                        key={province.code}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 0",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(province.code)}
                          onChange={() => toggle(province.code)}
                          style={{ cursor: "pointer", flexShrink: 0 }}
                        />
                        {province.name}
                      </label>
                    ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Country-only section */}
        {filteredCountryOnly.length > 0 && (
          <div>
            <div
              style={{
                padding: "8px 14px",
                backgroundColor: "#f6f6f7",
                fontSize: "11px",
                fontWeight: 600,
                color: "#6d7175",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              Other countries
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "2px",
                padding: "8px 14px 12px",
              }}
            >
              {filteredCountryOnly.map((country) => (
                <label
                  key={country.code}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 0",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(country.code)}
                    onChange={() => toggle(country.code)}
                    style={{ cursor: "pointer", flexShrink: 0 }}
                  />
                  {country.flag} {country.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {filteredRegions.length === 0 && filteredCountryOnly.length === 0 && (
          <div
            style={{ padding: "20px", textAlign: "center", color: "#6d7175", fontSize: "13px" }}
          >
            No regions match "{search}"
          </div>
        )}
      </div>
    </BlockStack>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BadgeEditor() {
  const { badge } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const isNew = !badge;

  // Form state
  const [name, setName] = useState(badge?.name ?? "New delivery badge");
  const [targetType, setTargetType] = useState<DeliveryBadge["targetType"]>(
    badge?.targetType ?? "all"
  );
  const [productIds, setProductIds] = useState<Array<{ id: string; title: string }>>(
    badge?.productIds ?? []
  );
  const [collectionIds, setCollectionIds] = useState<
    Array<{ id: string; title: string }>
  >(badge?.collectionIds ?? []);
  const [tags, setTags] = useState<string[]>(badge?.tags ?? []);

  const [displayStyle, setDisplayStyle] = useState<DisplayStyle>(
    badge?.displayStyle ?? "outlined"
  );
  const [icon, setIcon] = useState(badge?.icon ?? "🚚");
  const [messageTemplate, setMessageTemplate] = useState(
    badge?.messageTemplate ?? "Estimated delivery: {date_start} – {date_end}"
  );
  const [accentColor, setAccentColor] = useState(badge?.accentColor ?? "#2C6ECB");

  const [overrideWindow, setOverrideWindow] = useState(
    !!(badge?.processingDays || badge?.shippingDaysMin || badge?.shippingDaysMax)
  );

  // Geo targeting state
  const [geoTargetType, setGeoTargetType] = useState<"all" | "specific">(
    badge?.geoTargetType ?? "all"
  );
  const [geoTargets, setGeoTargets] = useState<string[]>(
    badge?.geoTargets ?? []
  );
  const [processingDays, setProcessingDays] = useState(badge?.processingDays ?? "1");
  const [shippingDaysMin, setShippingDaysMin] = useState(badge?.shippingDaysMin ?? "3");
  const [shippingDaysMax, setShippingDaysMax] = useState(badge?.shippingDaysMax ?? "7");

  // Resource picker for products
  async function openProductPicker() {
    try {
      // @ts-ignore — shopify is injected by App Bridge
      const selected = await shopify.resourcePicker({ type: "product", multiple: true });
      if (selected) {
        setProductIds(selected.map((p: any) => ({ id: p.id, title: p.title })));
      }
    } catch {
      // user closed picker
    }
  }

  // Resource picker for collections
  async function openCollectionPicker() {
    try {
      // @ts-ignore
      const selected = await shopify.resourcePicker({ type: "collection", multiple: true });
      if (selected) {
        setCollectionIds(selected.map((c: any) => ({ id: c.id, title: c.title })));
      }
    } catch {
      // user closed picker
    }
  }

  function handleSave() {
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
      processingDays: overrideWindow ? processingDays : null,
      shippingDaysMin: overrideWindow ? shippingDaysMin : null,
      shippingDaysMax: overrideWindow ? shippingDaysMax : null,
    };

    const fd = new FormData();
    fd.append("intent", "save");
    fd.append("badge", JSON.stringify(badgeData));
    submit(fd, { method: "post" });
  }

  return (
    <Page
      title={isNew ? "New delivery badge" : `Edit: ${badge.name}`}
      backAction={{ content: "Delivery Badges", url: "/app/badges" }}
      primaryAction={
        <Button variant="primary" onClick={handleSave} loading={isSaving}>
          Save badge
        </Button>
      }
    >
      <Layout>
        {/* Left column: config */}
        <Layout.Section>
          <BlockStack gap="500">
            {/* Name */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Badge name
                </Text>
                <TextField
                  label="Name"
                  labelHidden
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Standard shipping"
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            {/* Targeting */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Applies to
                </Text>

                <BlockStack gap="300">
                  <RadioButton
                    label="All products"
                    checked={targetType === "all"}
                    id="target-all"
                    name="targetType"
                    onChange={() => setTargetType("all")}
                  />
                  <RadioButton
                    label="Specific products"
                    checked={targetType === "specific"}
                    id="target-specific"
                    name="targetType"
                    onChange={() => setTargetType("specific")}
                  />
                  <RadioButton
                    label="Products with a tag"
                    checked={targetType === "tag"}
                    id="target-tag"
                    name="targetType"
                    onChange={() => setTargetType("tag")}
                  />
                  <RadioButton
                    label="Products in a collection"
                    checked={targetType === "collection"}
                    id="target-collection"
                    name="targetType"
                    onChange={() => setTargetType("collection")}
                  />
                </BlockStack>

                {targetType === "specific" && (
                  <Box paddingBlockStart="200">
                    <BlockStack gap="200">
                      <Button onClick={openProductPicker}>
                        {productIds.length > 0
                          ? `${productIds.length} product${productIds.length > 1 ? "s" : ""} selected`
                          : "Select products"}
                      </Button>
                      {productIds.length > 0 && (
                        <InlineStack gap="200" wrap>
                          {productIds.map((p) => (
                            <Tag
                              key={p.id}
                              onRemove={() =>
                                setProductIds((prev) =>
                                  prev.filter((x) => x.id !== p.id)
                                )
                              }
                            >
                              {p.title}
                            </Tag>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Box>
                )}

                {targetType === "tag" && (
                  <Box paddingBlockStart="200">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Add product tags. Badge applies to any product with at least one of
                        these tags.
                      </Text>
                      <TagInput tags={tags} onChange={setTags} />
                    </BlockStack>
                  </Box>
                )}

                {targetType === "collection" && (
                  <Box paddingBlockStart="200">
                    <BlockStack gap="200">
                      <Button onClick={openCollectionPicker}>
                        {collectionIds.length > 0
                          ? `${collectionIds.length} collection${collectionIds.length > 1 ? "s" : ""} selected`
                          : "Select collections"}
                      </Button>
                      {collectionIds.length > 0 && (
                        <InlineStack gap="200" wrap>
                          {collectionIds.map((c) => (
                            <Tag
                              key={c.id}
                              onRemove={() =>
                                setCollectionIds((prev) =>
                                  prev.filter((x) => x.id !== c.id)
                                )
                              }
                            >
                              {c.title}
                            </Tag>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* Shipping regions */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Shipping regions
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Show this badge only to customers shipping to specific regions.
                    When a customer's location is unknown, the badge always shows.
                  </Text>
                </BlockStack>

                <BlockStack gap="300">
                  <RadioButton
                    label="All regions"
                    checked={geoTargetType === "all"}
                    id="geo-all"
                    name="geoTargetType"
                    onChange={() => setGeoTargetType("all")}
                  />
                  <RadioButton
                    label="Specific states, provinces, or countries"
                    checked={geoTargetType === "specific"}
                    id="geo-specific"
                    name="geoTargetType"
                    onChange={() => setGeoTargetType("specific")}
                  />
                </BlockStack>

                {geoTargetType === "specific" && (
                  <Box paddingBlockStart="100">
                    <GeoTargetPicker
                      selected={geoTargets}
                      onChange={setGeoTargets}
                    />
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* Display */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Display style
                </Text>

                {/* Style picker */}
                <InlineGrid columns={2} gap="300">
                  {DISPLAY_STYLES.map((s) => {
                    const isSelected = displayStyle === s.value;
                    return (
                      <Box
                        key={s.value}
                        as="button"
                        onClick={() => setDisplayStyle(s.value)}
                        padding="300"
                        borderRadius="200"
                        borderWidth="025"
                        borderColor={isSelected ? "border-focus" : "border"}
                        background={isSelected ? "bg-surface-selected" : "bg-surface"}
                        style={{ cursor: "pointer", textAlign: "left", width: "100%" }}
                      >
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {s.label}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {s.desc}
                          </Text>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </InlineGrid>

                <Divider />

                {/* Icon picker */}
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Icon
                  </Text>
                  <InlineStack gap="200">
                    {ICONS.map((opt) => (
                      <Box
                        key={opt.value || "none"}
                        as="button"
                        onClick={() => setIcon(opt.value)}
                        padding="200"
                        borderRadius="200"
                        borderWidth="025"
                        borderColor={icon === opt.value ? "border-focus" : "border"}
                        background={
                          icon === opt.value ? "bg-surface-selected" : "bg-surface"
                        }
                        style={{ cursor: "pointer", minWidth: "44px", textAlign: "center" }}
                      >
                        <Text as="span" variant="bodyMd">
                          {opt.value || "—"}
                        </Text>
                      </Box>
                    ))}
                  </InlineStack>
                </BlockStack>

                <Divider />

                {/* Message template */}
                <BlockStack gap="200">
                  <TextField
                    label="Message template"
                    value={messageTemplate}
                    onChange={setMessageTemplate}
                    helpText="Use {date_start}, {date_end}, or {date_range} as placeholders."
                    autoComplete="off"
                  />
                </BlockStack>

                <Divider />

                {/* Accent color */}
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Accent color
                  </Text>
                  <InlineStack gap="300" blockAlign="center">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      style={{
                        width: 40,
                        height: 40,
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        padding: 2,
                        background: "none",
                      }}
                    />
                    <TextField
                      label=""
                      labelHidden
                      value={accentColor}
                      onChange={setAccentColor}
                      placeholder="#2C6ECB"
                      autoComplete="off"
                      maxLength={7}
                    />
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Delivery window override */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Delivery window
                  </Text>
                  <Badge tone={overrideWindow ? "info" : undefined}>
                    {overrideWindow ? "Custom" : "Using global settings"}
                  </Badge>
                </InlineStack>

                <RadioButton
                  label="Use global settings"
                  helpText="Falls back to the values in your Settings page."
                  checked={!overrideWindow}
                  id="window-global"
                  name="windowMode"
                  onChange={() => setOverrideWindow(false)}
                />
                <RadioButton
                  label="Override for this badge"
                  checked={overrideWindow}
                  id="window-custom"
                  name="windowMode"
                  onChange={() => setOverrideWindow(true)}
                />

                {overrideWindow && (
                  <InlineGrid columns={3} gap="300">
                    <TextField
                      label="Processing days"
                      type="number"
                      value={processingDays}
                      onChange={setProcessingDays}
                      autoComplete="off"
                      min="0"
                    />
                    <TextField
                      label="Min shipping days"
                      type="number"
                      value={shippingDaysMin}
                      onChange={setShippingDaysMin}
                      autoComplete="off"
                      min="1"
                    />
                    <TextField
                      label="Max shipping days"
                      type="number"
                      value={shippingDaysMax}
                      onChange={setShippingDaysMax}
                      autoComplete="off"
                      min="1"
                    />
                  </InlineGrid>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Right column: live preview + sticky save */}
        <Layout.Section variant="oneThird">
          <div style={{ position: "sticky", top: "16px" }}>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Live preview
                </Text>
                <LivePreview
                  style={displayStyle}
                  icon={icon}
                  template={messageTemplate}
                  color={accentColor}
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  Showing example dates. Actual dates are calculated at page load based on
                  your delivery window settings.
                </Text>
                <Divider />
                <Button variant="primary" onClick={handleSave} loading={isSaving} fullWidth>
                  Save badge
                </Button>
                <Button url="/app/badges" fullWidth>
                  Cancel
                </Button>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>

    </Page>
  );
}
