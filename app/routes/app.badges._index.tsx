import { useState, useEffect, useRef, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
  EmptyState,
  Badge as PolarisBadge,
  Text,
  BlockStack,
  InlineStack,
  Spinner,
  Box,
  DataTable,
  Banner,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ZoneConfig = {
  zoneId: string;
  zoneName: string;
  countryCodes: string[]; // ISO country codes in this zone
  standardMethodId: string | null;
  standardMethodName: string;
  standardMin: string;
  standardMax: string;
  fastestMethodId: string | null;
  fastestMethodName: string; // e.g. "Express"
  fastestMin: string;
  fastestMax: string;
};

export type DeliveryBadge = {
  id: string;
  name: string;
  isActive: boolean;
  priority: number;
  // Product targeting
  targetType: "all" | "specific" | "tag" | "collection";
  productIds: Array<{ id: string; title: string }>;
  tags: string[];
  collectionIds: Array<{ id: string; title: string }>;
  // Geo targeting — country/province codes like "US-CA", "CA-ON", "AU" (legacy)
  geoTargetType?: "all" | "specific";
  geoTargets?: string[];
  // Display
  displayStyle: "card" | "simple" | "outlined" | "filled" | "minimal" | "pill";
  // Simple style customisation (only used when displayStyle === "simple")
  simpleBgTransparent?: boolean;
  simpleBorderColor?: string;    // "" = no border
  simpleRounding?: "none" | "rounded" | "pill";
  simpleAlign?: "left" | "center" | "right";
  icon: string;
  iconColor?: string;
  badgeText?: string;
  messageTemplate: string;
  subMessage?: string;
  subMessageIcon?: string;
  messageFontSize?: number;
  subMessageFontSize?: number;
  accentColor: string;
  textColor?: string;
  backgroundColor?: string;
  // Delivery window — legacy flat fields (fallback for unknown-location shoppers)
  processingDays: string | null;
  shippingDaysMin: string | null;
  shippingDaysMax: string | null;
  // New: cutoff time (24h "HH:MM" in shop timezone). If set, orders placed
  // before this time ship the same day; after it, start counting tomorrow.
  cutoffTime?: string | null;
  // New: zone-based delivery configs pulled from the shop's delivery profile
  zoneConfigs?: ZoneConfig[];
  // New: which zones this badge applies to (empty array = all zones)
  selectedZoneIds?: string[];
};

// ─── Loader ──────────────────────────────────────────────────────────────────

const EMBED_HANDLE = "delivery-date";
const APP_API_KEY = process.env.SHOPIFY_API_KEY || "50d24c28388da4712f8c9e5618af4095";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;

  const response = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafields(first: 10, namespace: "$app") {
          nodes { key value }
        }
      }
    }
  `);

  const data = await response.json();
  const nodes = data.data?.currentAppInstallation?.metafields?.nodes ?? [];
  const badgesField = nodes.find((m: { key: string }) => m.key === "badges");
  const badges: DeliveryBadge[] = badgesField
    ? JSON.parse(badgesField.value)
    : [];
  const installId = data.data?.currentAppInstallation?.id;

  // Deep-link URL for theme editor app embeds panel
  let themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${APP_API_KEY}/${EMBED_HANDLE}`;

  // Check if embed is active
  let embedEnabled: boolean | null = null;
  try {
    const themesRes = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      // @ts-ignore — accessToken is always defined at this point
      headers: { "X-Shopify-Access-Token": session.accessToken },
    });
    const themesJson = await themesRes.json();
    const mainTheme = (themesJson.themes || []).find((t: any) => t.role === "main");
    if (mainTheme) {
      themeEditorUrl = `https://${shop}/admin/themes/${mainTheme.id}/editor?context=apps&template=product&activateAppId=${APP_API_KEY}/${EMBED_HANDLE}`;
      const assetRes = await fetch(
        `https://${shop}/admin/api/2025-01/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
        // @ts-ignore
        { headers: { "X-Shopify-Access-Token": session.accessToken } }
      );
      const assetJson = await assetRes.json();
      if (assetJson.asset?.value) {
        const settings = JSON.parse(assetJson.asset.value);
        const blocks = settings.current?.blocks || {};
        embedEnabled = Object.values(blocks).some((b: any) => {
          if (!b || typeof b !== "object") return false;
          if (b.disabled === true) return false;
          if (typeof b.handle === "string" && b.handle === EMBED_HANDLE) return true;
          if (typeof b.type === "string" && b.type.includes(EMBED_HANDLE)) return true;
          return false;
        });
      } else {
        embedEnabled = false;
      }
    }
  } catch { /* silent */ }

  return json({ badges, installId, embedEnabled, themeEditorUrl });
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  // Re-fetch current badges and installId
  const installResp = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafields(first: 10, namespace: "$app") {
          nodes { key value }
        }
      }
    }
  `);
  const installData = await installResp.json();
  const installId = installData.data?.currentAppInstallation?.id;
  const nodes =
    installData.data?.currentAppInstallation?.metafields?.nodes ?? [];
  const badgesField = nodes.find((m: { key: string }) => m.key === "badges");
  let badges: DeliveryBadge[] = badgesField
    ? JSON.parse(badgesField.value)
    : [];

  if (intent === "toggle") {
    const badgeId = String(formData.get("badgeId"));
    badges = badges.map((b) =>
      b.id === badgeId ? { ...b, isActive: !b.isActive } : b
    );
  } else if (intent === "delete") {
    const badgeId = String(formData.get("badgeId"));
    badges = badges.filter((b) => b.id !== badgeId);
  } else if (intent === "reorder") {
    const orderedIds = JSON.parse(
      String(formData.get("orderedIds"))
    ) as string[];
    const reordered = orderedIds
      .map((id, idx) => {
        const badge = badges.find((b) => b.id === id);
        return badge ? { ...badge, priority: idx } : null;
      })
      .filter(Boolean) as DeliveryBadge[];
    // Keep any badges not in orderedIds at the end
    const remaining = badges.filter((b) => !orderedIds.includes(b.id));
    badges = [...reordered, ...remaining];
  }

  await admin.graphql(
    `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
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

  return json({ ok: true });
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const targetTypeLabel: Record<string, string> = {
  all: "All products",
  specific: "Specific products",
  tag: "Tag-based",
  collection: "Collection",
};

function ShownOnCell({ badge }: { badge: DeliveryBadge }) {
  const [dropOpen, setDropOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{
    top: number;
    left: number;
    flipUp: boolean;
  }>({ top: 0, left: 0, flipUp: false });
  const btnRef = useRef<HTMLButtonElement>(null);

  const targetType = badge.targetType || "all";

  let items: string[] = [];
  if (targetType === "specific") {
    items = badge.productIds.map((p) => p.title || p.id);
  } else if (targetType === "tag") {
    items = badge.tags;
  } else if (targetType === "collection") {
    items = badge.collectionIds.map((c) => c.title || c.id);
  }

  const openDrop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const dropH = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < dropH + 8 && rect.top > dropH + 8;
    setDropPos({
      top: flipUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      flipUp,
    });
    setDropOpen((o) => !o);
  }, []);

  if (targetType === "all") {
    return (
      <Text variant="bodySm" as="span" tone="subdued">
        All products
      </Text>
    );
  }

  const count = items.length;
  const dotColor =
    targetType === "specific"
      ? "#007ace"
      : targetType === "tag"
        ? "#9c6ade"
        : "#36b37e";
  const itemLabel =
    targetType === "tag"
      ? `${count} tag${count !== 1 ? "s" : ""}`
      : targetType === "collection"
        ? `${count} collection${count !== 1 ? "s" : ""}`
        : `${count} product${count !== 1 ? "s" : ""}`;

  return (
    <div style={{ display: "inline-block" }}>
      <button
        ref={btnRef}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={openDrop}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          padding: "3px 8px",
          border: "1px solid #c9cccf",
          borderRadius: "20px",
          backgroundColor: "white",
          cursor: "pointer",
          fontSize: "12px",
          fontWeight: 500,
          color: "#202223",
          lineHeight: "1.6",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: dotColor,
            flexShrink: 0,
          }}
        />
        {itemLabel}
        <span style={{ fontSize: "9px", color: "#6d7175", marginLeft: "1px" }}>
          ▾
        </span>
      </button>

      {dropOpen && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onMouseDown={() => setDropOpen(false)}
          />
          <div
            style={{
              position: "fixed",
              top: dropPos.flipUp ? undefined : dropPos.top,
              bottom: dropPos.flipUp
                ? window.innerHeight - dropPos.top
                : undefined,
              left: dropPos.left,
              zIndex: 1000,
              backgroundColor: "white",
              border: "1px solid #c9cccf",
              borderRadius: "8px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
              minWidth: "160px",
              maxWidth: "260px",
              maxHeight: "220px",
              overflowY: "auto",
            }}
          >
            {items.length === 0 ? (
              <div
                style={{ padding: "10px 14px", fontSize: "13px", color: "#6d7175" }}
              >
                No items
              </div>
            ) : (
              items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: "7px 14px",
                    fontSize: "13px",
                    color: "#202223",
                    borderBottom:
                      i < items.length - 1 ? "1px solid #f1f2f3" : "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

const LIST_ICON_PATHS: Record<string, JSX.Element> = {
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

function ListIcon({ name, color }: { name: string; color: string }) {
  const path = LIST_ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" style={{ color, flexShrink: 0 }} aria-hidden="true">
      {path}
    </svg>
  );
}

function WidgetPreview({ badge }: { badge: DeliveryBadge }) {
  const accent = badge.accentColor || "#2C6ECB";
  const textCol = badge.textColor || "#1a1a1a";
  const bgCol = badge.backgroundColor || "#FFFFFF";
  const today = new Date();
  const min = new Date(today);
  min.setDate(today.getDate() + 4);
  const max = new Date(today);
  max.setDate(today.getDate() + 7);
  const expEnd = new Date(today);
  expEnd.setDate(today.getDate() + 3);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const text = (badge.messageTemplate || "Get it {date_range}")
    .replace("{date_start}", fmt(min))
    .replace("{date_end}", fmt(max))
    .replace("{date_range}", `${fmt(min)} - ${fmt(max)}`);

  const subText = badge.subMessage
    ? badge.subMessage
        .replace("{express_end}", fmt(expEnd))
        .replace("{date_start}", fmt(min))
        .replace("{date_end}", fmt(max))
        .replace("{date_range}", `${fmt(min)} - ${fmt(max)}`)
    : "";

  const style = badge.displayStyle || "simple";

  /* ── Card style ──────────────────────────────────────────────── */
  if (style === "card") {
    const labelText = badge.badgeText || "Delivery";
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "10px 12px",
          background: bgCol,
          border: "1px solid #e1e5ee",
          borderRadius: "10px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          color: textCol,
          maxWidth: "220px",
          fontSize: "11px",
          fontFamily: "inherit",
          lineHeight: "1.35",
        }}
      >
        {/* Label pill */}
        <span
          style={{
            alignSelf: "flex-start",
            fontSize: "7px",
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            color: "#fff",
            background: accent,
            padding: "2px 6px",
            borderRadius: "4px",
            marginBottom: "7px",
            lineHeight: "1.4",
          }}
        >
          {labelText}
        </span>
        {/* Icon + message row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {badge.icon && (
            <span
              style={{
                flex: "0 0 auto",
                width: "26px",
                height: "26px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: `${accent}1a`,
                border: `1px solid ${accent}2e`,
                borderRadius: "6px",
              }}
            >
              <ListIcon name={badge.icon} color={accent} />
            </span>
          )}
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "12px", fontWeight: 700, color: textCol }}>
              {text}
            </span>
            {subText && (
              <span style={{ display: "flex", alignItems: "center", gap: "2px", marginTop: "2px", fontSize: "9px", color: "#6b7280", fontWeight: 400 }}>
                {badge.subMessageIcon && <ListIcon name={badge.subMessageIcon} color="#6b7280" />}
                {subText}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Simple / legacy styles ──────────────────────────────────── */

  // Base — matches .arrively-inner
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    fontFamily: "inherit",
    fontWeight: 500,
    maxWidth: "220px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    lineHeight: "1.4",
  };

  // Simple style — computed from badge customisation fields
  const simpleRounding = badge.simpleRounding === "pill" ? "999px" : badge.simpleRounding === "none" ? "0" : "6px";
  const simplePreview: React.CSSProperties = {
    color: badge.textColor || accent,
    backgroundColor: badge.simpleBgTransparent ? "transparent" : (badge.backgroundColor || accent),
    border: badge.simpleBorderColor ? `1.5px solid ${badge.simpleBorderColor}` : "none",
    borderRadius: simpleRounding,
    padding: badge.simpleRounding === "pill" ? "5px 14px" : "6px 12px",
  };

  // Per-style overrides — legacy + new
  const styleMap: Record<string, React.CSSProperties> = {
    simple: simplePreview,
    outlined: {
      border: `1.5px solid ${accent}`,
      borderRadius: "6px",
      padding: "6px 12px",
      color: accent,
      backgroundColor: "transparent",
    },
    filled: {
      backgroundColor: accent,
      borderRadius: "6px",
      padding: "6px 12px",
      color: "#ffffff",
    },
    minimal: {
      color: accent,
      padding: "4px 0",
      backgroundColor: "transparent",
    },
    pill: {
      backgroundColor: accent,
      borderRadius: "999px",
      padding: "5px 14px",
      color: "#ffffff",
    },
  };

  return (
    <div style={{ ...base, ...styleMap[style] }}>
      {badge.icon && <ListIcon name={badge.icon} color={badge.iconColor ?? badge.accentColor} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {text}
      </span>
    </div>
  );
}

const styleLabel: Record<string, string> = {
  outlined: "Outlined",
  filled: "Filled",
  minimal: "Minimal",
  pill: "Pill",
};


// ─── Embed Warning Card ───────────────────────────────────────────────────────

function EmbedWarningCard({ themeEditorUrl }: { themeEditorUrl: string }) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <Banner
        title="Delivery badges aren't showing on your store"
        tone="warning"
        action={{ content: "Enable in Theme", onAction: () => setShowConfirm(true) }}
      >
        <p>The Arrively embed needs to be enabled in your theme before delivery dates will appear on product pages.</p>
      </Banner>

      {showConfirm && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999, backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => setShowConfirm(false)}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)", zIndex: 1000,
            backgroundColor: "white", borderRadius: "12px", padding: "28px",
            maxWidth: "440px", width: "calc(100% - 40px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          }}>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Enable delivery dates on your store</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  We'll open your Theme Editor with the embed already turned on. Just two quick steps:
                </Text>
                <div style={{ paddingLeft: "8px" }}>
                  {[
                    'Click "Save" in the top-right corner of the Theme Editor',
                    "Come back to this page - your status will update automatically",
                  ].map((step, i) => (
                    <div key={i} style={{ display: "flex", gap: "10px", marginBottom: "6px", alignItems: "flex-start" }}>
                      <div style={{
                        width: "20px", height: "20px", borderRadius: "50%",
                        backgroundColor: "#005bd3", color: "white",
                        fontSize: "11px", fontWeight: 600,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, marginTop: "1px",
                      }}>
                        {i + 1}
                      </div>
                      <Text variant="bodySm" as="p">{step}</Text>
                    </div>
                  ))}
                </div>
              </BlockStack>
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={() => { window.open(themeEditorUrl, "_blank"); setShowConfirm(false); }}
                >
                  Open Theme Editor
                </Button>
                <Button variant="plain" onClick={() => setShowConfirm(false)}>Cancel</Button>
              </InlineStack>
            </BlockStack>
          </div>
        </>
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BadgesIndex() {
  const { badges, embedEnabled, themeEditorUrl } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const activeBadges = badges
    .filter((b) => b.isActive)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  const inactiveBadges = badges.filter((b) => !b.isActive);

  const [localActive, setLocalActive] = useState(activeBadges);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    setLocalActive(activeBadges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges]);

  const handleToggle = (id: string) => {
    submit({ intent: "toggle", badgeId: id }, { method: "post" });
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this delivery badge? This can't be undone.")) {
      submit({ intent: "delete", badgeId: id }, { method: "post" });
    }
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const newOrder = [...localActive];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    setLocalActive(newOrder);
    setDragIdx(null);
    setDragOverIdx(null);
    submit(
      {
        intent: "reorder",
        orderedIds: JSON.stringify(newOrder.map((b) => b.id)),
      },
      { method: "post" }
    );
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  if (badges.length === 0) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <EmptyState
              heading="Create your first delivery badge"
              action={{
                content: "Create badge",
                onAction: () => navigate("/app/badges/new"),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <Text as="p" variant="bodyMd">
                Add estimated delivery dates to your product pages. Target
                all products, specific collections, tags, or individual products.
              </Text>
            </EmptyState>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Delivery Badges"
      primaryAction={{
        content: "Create badge",
        onAction: () => navigate("/app/badges/new"),
      }}
    >
      {isLoading && (
        <Box paddingBlockEnd="400">
          <InlineStack align="center">
            <Spinner size="small" />
          </InlineStack>
        </Box>
      )}
      <Layout>
        {/* Embed status indicator */}
        {embedEnabled !== true && (
          <Layout.Section>
            <EmbedWarningCard themeEditorUrl={themeEditorUrl} />
          </Layout.Section>
        )}
        {embedEnabled === true && (
          <Layout.Section>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              backgroundColor: "#f1faf5",
              borderRadius: 8,
              border: "1px solid #c3e6d4",
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", backgroundColor: "#008060", flexShrink: 0,
              }} />
              <Text variant="bodySm" as="span" tone="subdued">
                Embed active — delivery dates are showing on your storefront
              </Text>
            </div>
          </Layout.Section>
        )}
        {localActive.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Active ({localActive.length})
                  </Text>
                </InlineStack>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    border: "1px solid #e1e3e5",
                    borderRadius: "8px",
                    overflow: "hidden",
                    tableLayout: "auto",
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5" }}>
                      <th style={{ padding: "10px 12px", width: "36px" }} />
                      <th style={{ padding: "10px 4px", textAlign: "left", fontSize: "13px", fontWeight: 400, color: "#6d7175", width: "30px" }}>#</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "13px", fontWeight: 400, color: "#6d7175" }}>Preview</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "13px", fontWeight: 400, color: "#6d7175" }}>Name</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "13px", fontWeight: 400, color: "#6d7175" }}>Applies to</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "13px", fontWeight: 400, color: "#6d7175" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localActive.map((badge, idx) => (
                      <tr
                        key={badge.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                        onDragEnd={handleDragEnd}
                        style={{
                          borderBottom: idx < localActive.length - 1 ? "1px solid #e1e3e5" : "none",
                          cursor: "grab",
                          backgroundColor: dragOverIdx === idx && dragIdx !== idx ? "#f0f7ff" : "white",
                          opacity: dragIdx === idx ? 0.4 : 1,
                          borderTop: dragOverIdx === idx && dragIdx !== null && dragIdx > idx ? "2px solid #005bd3" : "none",
                          transition: "background-color 0.1s, opacity 0.1s",
                          userSelect: "none",
                        }}
                      >
                        <td style={{ padding: "12px 12px", textAlign: "center", verticalAlign: "middle", width: "36px" }}>
                          <span style={{ color: "#8c9196", fontSize: "18px", lineHeight: "1", cursor: "grab" }}>⠿</span>
                        </td>
                        <td style={{ padding: "12px 4px", verticalAlign: "middle", width: "30px" }}>
                          <Text variant="bodySm" as="span" tone="subdued">{idx + 1}</Text>
                        </td>
                        <td style={{ padding: "12px 12px", verticalAlign: "middle" }}>
                          <WidgetPreview badge={badge} />
                        </td>
                        <td style={{ padding: "12px 12px", verticalAlign: "middle" }}>
                          <Text variant="bodyMd" as="span">{badge.name}</Text>
                        </td>
                        <td style={{ padding: "12px 12px", verticalAlign: "middle" }}>
                          <ShownOnCell badge={badge} />
                        </td>
                        <td style={{ padding: "12px 12px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                          <InlineStack gap="200" blockAlign="center">
                            <Button size="slim" onClick={() => navigate(`/app/badges/${badge.id}`)}>Edit</Button>
                            <Button size="slim" tone="critical" onClick={() => handleToggle(badge.id)}>Deactivate</Button>
                            <button
                              onClick={() => handleDelete(badge.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", display: "inline-flex", alignItems: "center", color: "#d82c0d" }}
                              title="Delete badge"
                            >
                              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                                <path d="M8 3.5V4H5V5.5H15V4H12V3.5C12 2.948 11.552 2.5 11 2.5H9C8.448 2.5 8 2.948 8 3.5ZM6 7V16C6 16.552 6.448 17 7 17H13C13.552 17 14 16.552 14 16V7H6ZM9 9V15H8V9H9ZM12 9V15H11V9H12Z" fill="currentColor"/>
                              </svg>
                            </button>
                          </InlineStack>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {localActive.length > 1 && (
                  <Text variant="bodySm" as="p" tone="subdued">
                    ⠿ Drag to reorder. When a product matches multiple badges,
                    the highest-priority one wins.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {inactiveBadges.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Inactive ({inactiveBadges.length})
                </Text>
                <div className="arrively-inactive-table" style={{ opacity: 0.7 }}>
                <style>{`.arrively-inactive-table .Polaris-DataTable__TableRow { background-color: #f6f6f7 !important; }`}</style>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Preview", "Name", "Applies to", "Actions"]}
                  rows={inactiveBadges.map((badge) => [
                    <WidgetPreview key={badge.id} badge={badge} />,
                    badge.name,
                    <ShownOnCell key={badge.id} badge={badge} />,
                    <InlineStack key={badge.id} gap="200" blockAlign="center">
                      <Button size="slim" onClick={() => navigate(`/app/badges/${badge.id}`)}>Edit</Button>
                      <Button size="slim" onClick={() => handleToggle(badge.id)}>Activate</Button>
                      <button
                        onClick={() => handleDelete(badge.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", display: "inline-flex", alignItems: "center", color: "#d82c0d" }}
                        title="Delete badge"
                      >
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                          <path d="M8 3.5V4H5V5.5H15V4H12V3.5C12 2.948 11.552 2.5 11 2.5H9C8.448 2.5 8 2.948 8 3.5ZM6 7V16C6 16.552 6.448 17 7 17H13C13.552 17 14 16.552 14 16V7H6ZM9 9V15H8V9H9ZM12 9V15H11V9H12Z" fill="currentColor"/>
                        </svg>
                      </button>
                    </InlineStack>,
                  ])}
                />
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
