import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  List,
  InlineStack,
  Badge,
  Divider,
  Box,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Check metafields config
  const configResponse = await admin.graphql(`
    query {
      currentAppInstallation {
        metafields(first: 10, namespace: "$app") {
          nodes { key value }
        }
      }
    }
  `);

  const configData = await configResponse.json();
  const nodes = configData.data?.currentAppInstallation?.metafields?.nodes ?? [];
  const configField = nodes.find((m: { key: string }) => m.key === "config");
  const config = configField ? JSON.parse(configField.value) : null;

  // Check if app embed is enabled in the main theme
  // Default false — safer to show "off" than a false "on"
  let embedEnabled = false;
  try {
    const themeResponse = await admin.graphql(`
      query {
        themes(first: 10) {
          nodes { id legacyResourceId role }
        }
      }
    `);
    const themeData = await themeResponse.json();
    const themes: Array<{ id: string; legacyResourceId: string; role: string }> =
      themeData.data?.themes?.nodes ?? [];

    // Shopify may return role as "MAIN" or "main" depending on API version
    const mainTheme =
      themes.find((t) => t.role?.toUpperCase() === "MAIN") ?? themes[0];
    const themeId = mainTheme?.legacyResourceId;

    if (themeId && session.accessToken) {
      const assetResponse = await fetch(
        `https://${session.shop}/admin/api/2026-04/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
        {
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
          },
        }
      );

      if (assetResponse.ok) {
        const assetData = await assetResponse.json();
        const settingsJson = JSON.parse(assetData.asset?.value ?? "{}");

        // settings_data.json structure: { current: { blocks: {...} } }
        // or legacy: { current: "PresetName", presets: { PresetName: { blocks: {...} } } }
        let blocks: Record<string, unknown> = {};
        if (typeof settingsJson.current === "object" && settingsJson.current !== null) {
          blocks = (settingsJson.current as Record<string, unknown>).blocks as Record<string, unknown> ?? {};
        } else if (typeof settingsJson.current === "string") {
          const presetName = settingsJson.current;
          const preset = (settingsJson.presets ?? {})[presetName] ?? {};
          blocks = (preset as Record<string, unknown>).blocks as Record<string, unknown> ?? {};
        }

        // Check both block keys (shopify://apps/[handle]/blocks/...) and block type values
        // An embed is "on" if it exists in blocks AND is not explicitly disabled
        embedEnabled = Object.entries(blocks).some(([key, block]) => {
          const keyMatch = key.toLowerCase().includes("arrively");
          const b = block as Record<string, unknown> | null;
          const typeMatch =
            typeof b?.type === "string" &&
            b.type.toLowerCase().includes("arrively");
          const isMatch = keyMatch || typeMatch;
          return isMatch && b?.disabled !== true;
        });
      }
    }
  } catch (_e) {
    // If the check throws, leave embedEnabled as false
    embedEnabled = false;
  }

  return json({ isConfigured: !!config, embedEnabled });
};

export default function Dashboard() {
  const { isConfigured, embedEnabled } = useLoaderData<typeof loader>();
  const { revalidate, state: revalidateState } = useRevalidator();
  const isChecking = revalidateState === "loading";

  // Re-check embed status whenever the merchant returns to this tab
  // (e.g. after toggling the embed in Theme Editor)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    const handleFocus = () => revalidate();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [revalidate]);

  const allComplete = isConfigured && embedEnabled;

  return (
    <Page>
      <TitleBar title="Arrively — Estimated Delivery Date" />
      <Layout>
        {!isConfigured && (
          <Layout.Section>
            <Banner
              title="2 steps to get delivery dates showing on your store"
              tone="info"
            >
              <Text as="p" variant="bodyMd">
                Takes about 2 minutes. No theme code required.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Setup
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  {isChecking && <Spinner size="small" />}
                  {allComplete ? (
                    <Badge tone="success">Complete</Badge>
                  ) : (
                    <Badge tone="attention">
                      {[!isConfigured, !embedEnabled].filter(Boolean).length}{" "}
                      step
                      {[!isConfigured, !embedEnabled].filter(Boolean).length > 1
                        ? "s"
                        : ""}{" "}
                      remaining
                    </Badge>
                  )}
                </InlineStack>
              </InlineStack>

              <Divider />

              {/* Step 1 — Settings configured */}
              <InlineStack gap="400" blockAlign="start" wrap={false}>
                <Box
                  background={
                    isConfigured ? "bg-fill-success" : "bg-fill-brand"
                  }
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight="bold"
                    tone="text-inverse"
                    alignment="center"
                  >
                    {isConfigured ? "✓" : "1"}
                  </Text>
                </Box>
                <BlockStack gap="150">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Configure your delivery window
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Set processing time, shipping days, cut-off time, and
                    business day exclusions.
                  </Text>
                  <Button
                    url="/app/settings"
                    variant={isConfigured ? "plain" : "primary"}
                    size="slim"
                  >
                    {isConfigured ? "Edit settings" : "Configure settings →"}
                  </Button>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Step 2 — App embed enabled (live indicator) */}
              <InlineStack gap="400" blockAlign="start" wrap={false}>
                <Box
                  background={
                    embedEnabled ? "bg-fill-success" : "bg-fill-caution"
                  }
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight="bold"
                    tone={embedEnabled ? "text-inverse" : undefined}
                    alignment="center"
                  >
                    {embedEnabled ? "✓" : "2"}
                  </Text>
                </Box>
                <BlockStack gap="150">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Enable Arrively in App Embeds
                    </Text>
                    {embedEnabled ? (
                      <Badge tone="success">On</Badge>
                    ) : (
                      <Badge tone="warning">Off</Badge>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {embedEnabled
                      ? "Arrively is active and showing delivery dates on your product pages."
                      : "In the theme editor, go to App Embeds and toggle Arrively — Delivery Date on. This page updates automatically."}
                  </Text>
                  <Button
                    url="shopify://admin/themes/current/editor?context=apps"
                    variant={embedEnabled ? "plain" : "primary"}
                    size="slim"
                    target="_top"
                  >
                    {embedEnabled
                      ? "Manage App Embeds →"
                      : "Open Theme Editor →"}
                  </Button>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Your plan
                </Text>
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Free
                  </Text>
                  <Badge tone="success">Active</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Unlimited delivery date views — no visitor caps, ever.
                </Text>
                <List type="bullet">
                  <List.Item>Unlimited products &amp; views</List.Item>
                  <List.Item>Per-variant delivery rules</List.Item>
                  <List.Item>Collection &amp; tag-based rules</List.Item>
                </List>
                <Button url="/app/settings" variant="plain" size="slim">
                  Upgrade to Pro — $6.99/mo →
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Need help?
                </Text>
                <Divider />
                <Text as="p" variant="bodySm">
                  We respond to every support request within 24 hours.
                </Text>
                <Button
                  url="mailto:support@wwapps.io"
                  variant="plain"
                  size="slim"
                >
                  Contact support →
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
