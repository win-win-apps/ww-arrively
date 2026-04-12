import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";

// ─── Constants ────────────────────────────────────────────────────────────────

const EMBED_HANDLE = "delivery-date";
const API_KEY = process.env.SHOPIFY_API_KEY || "50d24c28388da4712f8c9e5618af4095";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;

  // Badge count from metafield
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
  const nodes = metaData.data?.currentAppInstallation?.metafields?.nodes ?? [];
  const badgesField = nodes.find((m: { key: string }) => m.key === "badges");
  const badges: Array<{ isActive: boolean }> = badgesField
    ? JSON.parse(badgesField.value)
    : [];
  const activeBadges = badges.filter((b) => b.isActive).length;

  // Embed status + theme editor deep-link
  let embedEnabled: boolean | null = null;
  let themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${API_KEY}/${EMBED_HANDLE}`;

  try {
    const themesRes = await fetch(`https://${shop}/admin/api/2025-01/themes.json`, {
      headers: { "X-Shopify-Access-Token": session.accessToken },
    });
    const themesJson = await themesRes.json();
    const mainTheme = (themesJson.themes || []).find((t: any) => t.role === "main");
    if (mainTheme) {
      themeEditorUrl = `https://${shop}/admin/themes/${mainTheme.id}/editor?context=apps&template=product&activateAppId=${API_KEY}/${EMBED_HANDLE}`;
      const assetRes = await fetch(
        `https://${shop}/admin/api/2025-01/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
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
  } catch { /* silent — embedEnabled stays null */ }

  return json({
    totalBadges: badges.length,
    activeBadges,
    hasAnyBadge: badges.length > 0,
    embedEnabled,
    themeEditorUrl,
  });
};

// ─── Embed status pill (shown when embed is ON) ───────────────────────────────

function EmbedPill({ embedEnabled }: { embedEnabled: boolean | null }) {
  if (embedEnabled !== true) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#008060", flexShrink: 0 }} />
      <Text variant="bodySm" as="span" tone="subdued">
        Embed active — delivery dates are live on your storefront
      </Text>
    </div>
  );
}

// ─── Enable-embed popup ───────────────────────────────────────────────────────

function EnableEmbedPopup({ themeEditorUrl, onClose }: { themeEditorUrl: string; onClose: () => void }) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 999, backgroundColor: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)", zIndex: 1000,
        backgroundColor: "white", borderRadius: "12px", padding: "28px",
        maxWidth: "440px", width: "calc(100% - 40px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }}>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Enable Arrively in your theme</Text>
          <BlockStack gap="200">
            <Text variant="bodyMd" as="p">
              We'll open your Theme Editor in a new tab. Here's what to do:
            </Text>
            <div style={{ paddingLeft: "8px" }}>
              {[
                "The App Embeds panel will open automatically",
                'Find "Arrively — Delivery Date" and toggle it on',
                "Click Save in the top-right corner",
                "Return to this page — your embed status will update",
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
              onClick={() => { window.open(themeEditorUrl, "_blank"); onClose(); }}
            >
              Open Theme Editor
            </Button>
            <Button variant="plain" onClick={onClose}>Cancel</Button>
          </InlineStack>
        </BlockStack>
      </div>
    </>
  );
}

// ─── Review widget (sticky sidebar) ──────────────────────────────────────────

const REVIEW_DISMISSED_KEY = "arrively-review-dismissed";

function ReviewWidget() {
  const [rating, setRating] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [awaitingReview, setAwaitingReview] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return !!localStorage.getItem(REVIEW_DISMISSED_KEY); } catch { return false; }
  });

  const persistDismiss = () => {
    try { localStorage.setItem(REVIEW_DISMISSED_KEY, "1"); } catch {}
    setDismissed(true);
  };

  const handleSubmit = useCallback(async () => {
    if (rating && rating >= 5) {
      shopify.reviews.request();
      setAwaitingReview(true);
    } else {
      setSubmitted(true);
      setTimeout(() => {
        try { localStorage.setItem(REVIEW_DISMISSED_KEY, "1"); } catch {}
        setDismissed(true);
      }, 10000);
    }
  }, [rating]);

  const handleReviewDone = () => {
    setAwaitingReview(false);
    setSubmitted(true);
    setTimeout(() => {
      try { localStorage.setItem(REVIEW_DISMISSED_KEY, "1"); } catch {}
      setDismissed(true);
    }, 10000);
  };

  if (dismissed) return null;

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingSm" as="h2">How are we doing?</Text>
          <Button variant="plain" onClick={persistDismiss}>Dismiss</Button>
        </InlineStack>
        {submitted ? (
          <Text variant="bodySm" as="p" tone="subdued">Thanks for your feedback! 🙏</Text>
        ) : awaitingReview ? (
          <BlockStack gap="200">
            <Text variant="bodySm" as="p" tone="subdued">
              Complete your review in the popup, then click below.
            </Text>
            <InlineStack gap="200">
              <Button size="slim" variant="primary" onClick={handleReviewDone}>Done — I left my review</Button>
              <Button size="slim" variant="plain" onClick={() => setAwaitingReview(false)}>Maybe later</Button>
            </InlineStack>
          </BlockStack>
        ) : (
          <>
            <Text variant="bodySm" as="p" tone="subdued">Rate your experience:</Text>
            <div style={{ display: "flex", gap: "4px" }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "24px", padding: "1px",
                    color: rating && star <= rating ? "#f5a623" : "#c4cdd5",
                    transition: "color 0.15s",
                  }}
                  aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                >★</button>
              ))}
            </div>
            {rating !== null && rating < 5 && (
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What could be better?"
                style={{
                  width: "100%", minHeight: "60px", padding: "8px 10px",
                  border: "1px solid #c4cdd5", borderRadius: "6px",
                  fontSize: "13px", fontFamily: "inherit", resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            )}
            {rating !== null && (
              <Button size="slim" onClick={handleSubmit}>
                {rating >= 5 ? "Next →" : "Send feedback"}
              </Button>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Onboarding card (no badges yet) ─────────────────────────────────────────

function OnboardingCard({
  embedEnabled,
  themeEditorUrl,
  navigate,
}: {
  embedEnabled: boolean | null;
  themeEditorUrl: string;
  navigate: (path: string) => void;
}) {
  const [showEmbed, setShowEmbed] = useState(false);

  const badgeDone = false;
  const embedDone = embedEnabled !== false;
  const completed = (badgeDone ? 1 : 0) + (embedDone ? 1 : 0);

  const steps = [
    {
      done: badgeDone,
      title: "Create your first delivery badge",
      desc: "Set up a delivery estimate for your products — try targeting all products to start.",
      cta: <Button size="slim" variant="primary" onClick={() => navigate("/app/badges/new")}>Create badge</Button>,
    },
    {
      done: embedDone,
      title: "Enable Arrively in your theme",
      desc: "Activate the app embed so delivery dates appear on your product pages.",
      cta: embedDone ? null : (
        <Button size="slim" onClick={() => setShowEmbed(true)}>Enable in Theme</Button>
      ),
    },
  ];

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">Get started with Arrively</Text>
            <Text variant="bodySm" as="p" tone="subdued">
              Complete these two steps to start showing delivery dates on your products.
            </Text>
          </BlockStack>

          {/* Progress bar */}
          <div>
            <div style={{ height: 6, backgroundColor: "#e4e5e7", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(completed / 2) * 100}%`,
                backgroundColor: "#008060",
                borderRadius: 3,
                transition: "width 0.4s ease",
              }} />
            </div>
            <Text variant="bodySm" as="p" tone="subdued" alignment="end">
              {completed} / 2 complete
            </Text>
          </div>

          {/* Steps */}
          {steps.map((step, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                paddingTop: i > 0 ? 16 : 0,
                borderTop: i > 0 ? "1px solid #e4e5e7" : "none",
              }}
            >
              {/* Check circle */}
              <div style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                backgroundColor: step.done ? "#008060" : "transparent",
                border: step.done ? "2px solid #008060" : "2px solid #c4cdd5",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {step.done && (
                  <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                    <path d="M1 5l3.5 3.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <Text variant="bodyMd" as="p" fontWeight="semibold" tone={step.done ? "subdued" : undefined}>
                  {step.title}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">{step.desc}</Text>
                {!step.done && step.cta && (
                  <div style={{ marginTop: 8 }}>{step.cta}</div>
                )}
              </div>
            </div>
          ))}
        </BlockStack>
      </Card>

      {showEmbed && <EnableEmbedPopup themeEditorUrl={themeEditorUrl} onClose={() => setShowEmbed(false)} />}
    </>
  );
}

// ─── Badges dashboard card (returning user) ───────────────────────────────────

function BadgesCard({
  activeBadges,
  totalBadges,
  embedEnabled,
  themeEditorUrl,
  navigate,
}: {
  activeBadges: number;
  totalBadges: number;
  embedEnabled: boolean | null;
  themeEditorUrl: string;
  navigate: (path: string) => void;
}) {
  const [showEmbed, setShowEmbed] = useState(false);

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <div>
            <Text variant="heading2xl" as="p">{activeBadges}</Text>
            <Text variant="bodySm" as="p" tone="subdued">
              active delivery badge{activeBadges !== 1 ? "s" : ""}
              {totalBadges > activeBadges ? ` · ${totalBadges - activeBadges} inactive` : ""}
            </Text>
          </div>
          <BlockStack gap="100">
            <Text variant="headingMd" as="h3">Your Delivery Badges</Text>
            <Text variant="bodySm" as="p" tone="subdued">
              Create, edit, and reorder delivery badges for your product pages.
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button variant="primary" onClick={() => navigate("/app/badges/new")}>+ Create badge</Button>
            <Button onClick={() => navigate("/app/badges")}>View all</Button>
          </InlineStack>

          {/* Embed nudge — only when definitively OFF */}
          {embedEnabled === false && (
            <div style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              backgroundColor: "#fff9ee",
              borderRadius: 8,
              border: "1px solid #f5c57a",
              padding: 14,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                backgroundColor: "#f59e0b",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ color: "white", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>!</span>
              </div>
              <div style={{ flex: 1 }}>
                <Text variant="bodyMd" as="p" fontWeight="semibold">Enable Arrively in your theme</Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Activate the app embed so delivery dates appear on your product pages.
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Button size="slim" onClick={() => setShowEmbed(true)}>Enable in Theme</Button>
                </div>
              </div>
            </div>
          )}
        </BlockStack>
      </Card>
      {showEmbed && <EnableEmbedPopup themeEditorUrl={themeEditorUrl} onClose={() => setShowEmbed(false)} />}
    </>
  );
}

// ─── Home page ────────────────────────────────────────────────────────────────

export default function Home() {
  const { totalBadges, activeBadges, hasAnyBadge, embedEnabled, themeEditorUrl } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  // Re-check embed status when merchant returns to this tab
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [revalidate]);

  return (
    <Page>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

        {/* ── Main content column ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <BlockStack gap="400">

            {/* Embed active pill — shown above the card when live */}
            <EmbedPill embedEnabled={embedEnabled} />

            {!hasAnyBadge ? (
              <OnboardingCard
                embedEnabled={embedEnabled}
                themeEditorUrl={themeEditorUrl}
                navigate={navigate}
              />
            ) : (
              <BadgesCard
                activeBadges={activeBadges}
                totalBadges={totalBadges}
                embedEnabled={embedEnabled}
                themeEditorUrl={themeEditorUrl}
                navigate={navigate}
              />
            )}

          </BlockStack>
        </div>

        {/* ── Sticky right sidebar ── */}
        <div style={{ width: 260, flexShrink: 0, position: "sticky", top: 16 }}>
          <ReviewWidget />
        </div>

      </div>
    </Page>
  );
}
