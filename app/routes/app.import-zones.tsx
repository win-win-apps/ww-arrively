/**
 * Shipping Zones Import
 *
 * Queries the merchant's Shopify delivery profiles, extracts shipping zones
 * with their geographic coverage, and lets the merchant assign transit-day
 * estimates per zone. Saving creates geo-targeted Arrively badges automatically.
 */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Badge,
  Banner,
  Box,
  Divider,
  InlineGrid,
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import type { DeliveryBadge } from "./app.badges._index";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShopifyCountry = {
  name: string;
  code: { countryCode: string };
  provinces: Array<{ name: string; code: string }>;
  includeAllProvinces: boolean;
};

type ParsedZone = {
  id: string;          // zone id
  name: string;        // zone name, e.g. "Domestic", "International"
  countries: ShopifyCountry[];
  // Geo codes we'll use for badge geoTargets
  geoCodes: string[];  // ["US", "CA"] or ["US-CA", "US-NY"] etc.
  geoSummary: string;  // human-readable, e.g. "United States, Canada"
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const resp = await admin.graphql(`
    query GetDeliveryZones {
      deliveryProfiles(first: 5) {
        nodes {
          name
          default
          profileLocationGroups {
            locationGroupZones(first: 30) {
              nodes {
                zone {
                  id
                  name
                  countries {
                    name
                    code { countryCode }
                    provinces { name code }
                    includeAllProvinces
                  }
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await resp.json();
  const profiles = data?.data?.deliveryProfiles?.nodes ?? [];

  // Collect unique zones (by id) across all profiles
  const seenIds = new Set<string>();
  const zones: ParsedZone[] = [];

  for (const profile of profiles) {
    for (const group of profile.profileLocationGroups ?? []) {
      for (const node of group.locationGroupZones?.nodes ?? []) {
        const zone = node.zone;
        if (!zone || seenIds.has(zone.id)) continue;
        seenIds.add(zone.id);

        const countries: ShopifyCountry[] = zone.countries ?? [];
        const geoCodes: string[] = [];
        const countryNames: string[] = [];

        for (const country of countries) {
          const cc = country.code?.countryCode;
          if (!cc) continue;
          countryNames.push(country.name);

          if (country.includeAllProvinces || country.provinces.length === 0) {
            // Country-level targeting
            geoCodes.push(cc);
          } else {
            // Province-level targeting
            for (const prov of country.provinces) {
              geoCodes.push(`${cc}-${prov.code}`);
            }
          }
        }

        const geoSummary =
          countryNames.length === 0
            ? "All countries"
            : countryNames.length <= 4
            ? countryNames.join(", ")
            : `${countryNames.slice(0, 3).join(", ")} +${countryNames.length - 3} more`;

        zones.push({
          id: zone.id,
          name: zone.name,
          countries,
          geoCodes,
          geoSummary,
        });
      }
    }
  }

  return json({ zones });
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const zonesJson = formData.get("zones") as string;
  const zoneConfigs: Array<{
    zoneId: string;
    zoneName: string;
    geoCodes: string[];
    processingDays: string;
    shippingDaysMin: string;
    shippingDaysMax: string;
    enabled: boolean;
  }> = JSON.parse(zonesJson);

  // Read existing badges
  const instResp = await admin.graphql(`
    query {
      currentAppInstallation {
        id
        metafield(namespace: "$app", key: "badges") { value }
      }
    }
  `);
  const instData = await instResp.json();
  const installId = instData.data.currentAppInstallation.id;
  const raw = instData.data.currentAppInstallation.metafield?.value;
  let badges: DeliveryBadge[] = [];
  try { badges = JSON.parse(raw || "[]"); } catch { badges = []; }

  // Generate id helper
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Create one badge per enabled zone
  const enabledZones = zoneConfigs.filter((z) => z.enabled);
  for (let i = 0; i < enabledZones.length; i++) {
    const z = enabledZones[i];
    const newBadge: DeliveryBadge = {
      id: genId(),
      name: z.zoneName,
      isActive: true,
      priority: badges.length + i,
      targetType: "all",
      productIds: [],
      tags: [],
      collectionIds: [],
      geoTargetType: "specific",
      geoTargets: z.geoCodes,
      displayStyle: "outlined",
      icon: "🚚",
      messageTemplate: "Estimated delivery: {date_start} – {date_end}",
      accentColor: "#2C6ECB",
      processingDays: z.processingDays || "1",
      shippingDaysMin: z.shippingDaysMin || "3",
      shippingDaysMax: z.shippingDaysMax || "7",
    };
    badges.push(newBadge);
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

  return redirect("/app/badges");
};

// ─── Component ───────────────────────────────────────────────────────────────

type ZoneConfig = {
  zoneId: string;
  zoneName: string;
  geoCodes: string[];
  geoSummary: string;
  processingDays: string;
  shippingDaysMin: string;
  shippingDaysMax: string;
  enabled: boolean;
};

export default function ImportZones() {
  const { zones } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSaving = navigation.state === "submitting";

  const [configs, setConfigs] = useState<ZoneConfig[]>(() =>
    zones.map((z) => ({
      zoneId: z.id,
      zoneName: z.name,
      geoCodes: z.geoCodes,
      geoSummary: z.geoSummary,
      processingDays: "1",
      shippingDaysMin: "3",
      shippingDaysMax: "7",
      enabled: true,
    }))
  );

  const update = (zoneId: string, field: keyof ZoneConfig, value: string | boolean) => {
    setConfigs((prev) =>
      prev.map((c) => (c.zoneId === zoneId ? { ...c, [field]: value } : c))
    );
  };

  const handleImport = () => {
    const fd = new FormData();
    fd.append("zones", JSON.stringify(configs));
    submit(fd, { method: "post" });
  };

  const enabledCount = configs.filter((c) => c.enabled).length;

  if (zones.length === 0) {
    return (
      <Page
        title="Import from Shipping Zones"
        backAction={{ content: "Delivery Badges", url: "/app/badges" }}
      >
        <Layout>
          <Layout.Section>
            <Banner tone="warning">
              <Text as="p" variant="bodyMd">
                No shipping zones found. Make sure you have shipping profiles set up in your Shopify
                admin under{" "}
                <strong>Settings → Shipping and delivery</strong>.
              </Text>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Import from Shipping Zones"
      subtitle={`${zones.length} zone${zones.length !== 1 ? "s" : ""} found in your shipping profiles`}
      backAction={{ content: "Delivery Badges", url: "/app/badges" }}
      primaryAction={
        <Button
          variant="primary"
          onClick={handleImport}
          loading={isSaving}
          disabled={enabledCount === 0}
        >
          Create {enabledCount} badge{enabledCount !== 1 ? "s" : ""}
        </Button>
      }
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              Each enabled zone will become a geo-targeted delivery badge. Set the estimated transit
              time for each zone, then click <strong>Create badges</strong>. You can edit or
              customize any badge afterwards.
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            {configs.map((config) => (
              <Card key={config.zoneId}>
                <BlockStack gap="400">
                  {/* Zone header */}
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          {config.zoneName}
                        </Text>
                        {config.enabled ? (
                          <Badge tone="success">Will import</Badge>
                        ) : (
                          <Badge tone="enabled">Skipped</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        🌍 {config.geoSummary}
                      </Text>
                      {config.geoCodes.length > 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {config.geoCodes.length} region{config.geoCodes.length !== 1 ? "s" : ""}{" "}
                          targeted
                        </Text>
                      )}
                    </BlockStack>
                    <Button
                      size="slim"
                      tone={config.enabled ? "critical" : undefined}
                      variant="plain"
                      onClick={() => update(config.zoneId, "enabled", !config.enabled)}
                    >
                      {config.enabled ? "Skip this zone" : "Include"}
                    </Button>
                  </InlineStack>

                  {config.enabled && (
                    <>
                      <Divider />
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          Transit time estimate
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          How long does shipping take for orders in this zone?
                        </Text>
                        <InlineGrid columns={3} gap="300">
                          <TextField
                            label="Processing days"
                            type="number"
                            value={config.processingDays}
                            onChange={(v) => update(config.zoneId, "processingDays", v)}
                            autoComplete="off"
                            min="0"
                            helpText="Days to pack & ship"
                          />
                          <TextField
                            label="Min shipping days"
                            type="number"
                            value={config.shippingDaysMin}
                            onChange={(v) => update(config.zoneId, "shippingDaysMin", v)}
                            autoComplete="off"
                            min="1"
                            helpText="Fastest delivery"
                          />
                          <TextField
                            label="Max shipping days"
                            type="number"
                            value={config.shippingDaysMax}
                            onChange={(v) => update(config.zoneId, "shippingDaysMax", v)}
                            autoComplete="off"
                            min="1"
                            helpText="Slowest delivery"
                          />
                        </InlineGrid>
                      </BlockStack>
                    </>
                  )}
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlockEnd="600">
            <InlineStack align="end" gap="300">
              <Button onClick={() => navigate("/app/badges")}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleImport}
                loading={isSaving}
                disabled={enabledCount === 0}
              >
                Create {enabledCount} badge{enabledCount !== 1 ? "s" : ""}
              </Button>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
