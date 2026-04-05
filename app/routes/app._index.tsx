import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      currentAppInstallation {
        metafields(first: 10, namespace: "$app") {
          nodes { key value }
        }
      }
    }
  `);

  const data = await response.json();
  const nodes = data.data?.currentAppInstallation?.metafields?.nodes ?? [];
  const configField = nodes.find((m: { key: string }) => m.key === "config");
  const config = configField ? JSON.parse(configField.value) : null;

  return json({ isConfigured: !!config });
};

export default function Dashboard() {
  const { isConfigured } = useLoaderData<typeof loader>();

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
                {isConfigured ? (
                  <Badge tone="success">Complete</Badge>
                ) : (
                  <Badge tone="attention">2 steps remaining</Badge>
                )}
              </InlineStack>

              <Divider />

              {/* Step 1 */}
              <InlineStack gap="400" blockAlign="start" wrap={false}>
                <Box
                  background={isConfigured ? "bg-fill-success" : "bg-fill-brand"}
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text as="span" variant="bodySm" fontWeight="bold" tone="text-inverse" alignment="center">
                    {isConfigured ? "✓" : "1"}
                  </Text>
                </Box>
                <BlockStack gap="150">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Configure your delivery window
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Set processing time, shipping days, cut-off time, and business day exclusions.
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

              {/* Step 2 */}
              <InlineStack gap="400" blockAlign="start" wrap={false}>
                <Box
                  background="bg-fill-secondary"
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">
                    2
                  </Text>
                </Box>
                <BlockStack gap="150">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Add the block to your product pages
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    In the theme editor, open a product template and drag the{" "}
                    <strong>Arrively — Delivery Date</strong> block where you want delivery dates to appear.
                  </Text>
                  <Button
                    url="shopify://admin/themes/current/editor?template=product"
                    variant="plain"
                    size="slim"
                    target="_top"
                  >
                    Open theme editor →
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
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Free</Text>
                  <Badge tone="success">Active</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Unlimited delivery date views — no visitor caps, ever.
                </Text>
                <List type="bullet">
                  <List.Item>Unlimited products & views</List.Item>
                  <List.Item>Per-variant delivery rules</List.Item>
                  <List.Item>Collection & tag-based rules</List.Item>
                </List>
                <Button url="/app/settings" variant="plain" size="slim">
                  Upgrade to Pro — $6.99/mo →
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Need help?</Text>
                <Divider />
                <Text as="p" variant="bodySm">
                  We respond to every support request within 24 hours.
                </Text>
                <Button url="mailto:support@wwapps.io" variant="plain" size="slim">
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
