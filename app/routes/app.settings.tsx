import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  TextField,
  Select,
  Checkbox,
  Divider,
  InlineStack,
  Badge,
  Banner,
  FormLayout,
  Tag,
  Box,
  Collapsible,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { authenticate } from "../shopify.server";

// --- Default config ---
const DEFAULT_CONFIG = {
  processingDays: "1",
  shippingDaysMin: "3",
  shippingDaysMax: "7",
  cutoffHour: "14",
  cutoffTimezone: "America/New_York",
  excludeWeekends: true,
  holidays: [] as string[],
  messageTemplate: "Estimated delivery: {date_start} – {date_end}",
  showTruckIcon: true,
  accentColor: "#008060",
  manualPlacementSelector: "",
};

type Config = typeof DEFAULT_CONFIG;

// --- Loader ---
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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
  const configField = nodes.find((m: { key: string }) => m.key === "config");
  const config: Config = configField
    ? { ...DEFAULT_CONFIG, ...JSON.parse(configField.value) }
    : { ...DEFAULT_CONFIG };

  const installId = data.data?.currentAppInstallation?.id;

  return json({ config, installId, saved: false });
};

// --- Action ---
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Re-fetch installId
  const installResp = await admin.graphql(`query { currentAppInstallation { id } }`);
  const installData = await installResp.json();
  const installId = installData.data?.currentAppInstallation?.id;

  const config: Config = {
    processingDays: String(formData.get("processingDays") ?? "1"),
    shippingDaysMin: String(formData.get("shippingDaysMin") ?? "3"),
    shippingDaysMax: String(formData.get("shippingDaysMax") ?? "7"),
    cutoffHour: String(formData.get("cutoffHour") ?? "14"),
    cutoffTimezone: String(formData.get("cutoffTimezone") ?? "America/New_York"),
    excludeWeekends: formData.get("excludeWeekends") === "true",
    holidays: JSON.parse(String(formData.get("holidays") ?? "[]")),
    messageTemplate: String(formData.get("messageTemplate") ?? DEFAULT_CONFIG.messageTemplate),
    showTruckIcon: formData.get("showTruckIcon") === "true",
    accentColor: String(formData.get("accentColor") ?? "#008060"),
    manualPlacementSelector: String(formData.get("manualPlacementSelector") ?? ""),
  };

  const mutResp = await admin.graphql(
    `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: installId,
            namespace: "$app",
            key: "config",
            value: JSON.stringify(config),
            type: "json",
          },
        ],
      },
    }
  );

  const mutData = await mutResp.json();
  const errors = mutData.data?.metafieldsSet?.userErrors ?? [];

  if (errors.length > 0) {
    return json({ error: errors[0].message }, { status: 400 });
  }

  return redirect("/app/settings?saved=1");
};

// --- Component ---
export default function Settings() {
  const { config, saved: loaderSaved } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const isSaving = navigation.state === "submitting";

  // Form state
  const [processingDays, setProcessingDays] = useState(config.processingDays);
  const [shippingDaysMin, setShippingDaysMin] = useState(config.shippingDaysMin);
  const [shippingDaysMax, setShippingDaysMax] = useState(config.shippingDaysMax);
  const [cutoffHour, setCutoffHour] = useState(config.cutoffHour);
  const [cutoffTimezone, setCutoffTimezone] = useState(config.cutoffTimezone);
  const [excludeWeekends, setExcludeWeekends] = useState(config.excludeWeekends);
  const [holidays, setHolidays] = useState<string[]>(config.holidays);
  const [holidayInput, setHolidayInput] = useState("");
  const [messageTemplate, setMessageTemplate] = useState(config.messageTemplate);
  const [showTruckIcon, setShowTruckIcon] = useState(config.showTruckIcon);
  const [accentColor, setAccentColor] = useState(config.accentColor);
  const [manualPlacementSelector, setManualPlacementSelector] = useState(config.manualPlacementSelector ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(!!(config.manualPlacementSelector));

  // Check for saved=1 in URL
  const urlSaved = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("saved") === "1"
    : false;

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("processingDays", processingDays);
    formData.set("shippingDaysMin", shippingDaysMin);
    formData.set("shippingDaysMax", shippingDaysMax);
    formData.set("cutoffHour", cutoffHour);
    formData.set("cutoffTimezone", cutoffTimezone);
    formData.set("excludeWeekends", String(excludeWeekends));
    formData.set("holidays", JSON.stringify(holidays));
    formData.set("messageTemplate", messageTemplate);
    formData.set("showTruckIcon", String(showTruckIcon));
    formData.set("accentColor", accentColor);
    formData.set("manualPlacementSelector", manualPlacementSelector);
    submit(formData, { method: "post" });
  }, [
    processingDays, shippingDaysMin, shippingDaysMax, cutoffHour,
    cutoffTimezone, excludeWeekends, holidays, messageTemplate,
    showTruckIcon, accentColor, manualPlacementSelector, submit,
  ]);

  const addHoliday = useCallback(() => {
    const trimmed = holidayInput.trim();
    if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !holidays.includes(trimmed)) {
      setHolidays([...holidays, trimmed]);
      setHolidayInput("");
    }
  }, [holidayInput, holidays]);

  const removeHoliday = useCallback((date: string) => {
    setHolidays(holidays.filter((h) => h !== date));
  }, [holidays]);

  const timezoneOptions = [
    { label: "Eastern (ET)", value: "America/New_York" },
    { label: "Central (CT)", value: "America/Chicago" },
    { label: "Mountain (MT)", value: "America/Denver" },
    { label: "Pacific (PT)", value: "America/Los_Angeles" },
    { label: "UTC", value: "UTC" },
    { label: "London (GMT/BST)", value: "Europe/London" },
    { label: "Berlin (CET/CEST)", value: "Europe/Berlin" },
    { label: "Dubai (GST)", value: "Asia/Dubai" },
    { label: "Singapore (SGT)", value: "Asia/Singapore" },
    { label: "Tokyo (JST)", value: "Asia/Tokyo" },
    { label: "Sydney (AEST)", value: "Australia/Sydney" },
  ];

  const hourOptions = Array.from({ length: 24 }, (_, i) => ({
    label: `${i.toString().padStart(2, "0")}:00`,
    value: String(i),
  }));

  // Live preview
  const today = new Date();
  const previewStart = new Date(today);
  previewStart.setDate(today.getDate() + Number(processingDays) + Number(shippingDaysMin));
  const previewEnd = new Date(today);
  previewEnd.setDate(today.getDate() + Number(processingDays) + Number(shippingDaysMax));
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const previewText = messageTemplate
    .replace("{date_start}", fmt(previewStart))
    .replace("{date_end}", fmt(previewEnd));

  return (
    <Page
      title="Settings"
      primaryAction={{
        content: isSaving ? "Saving…" : "Save settings",
        onAction: handleSave,
        loading: isSaving,
      }}
    >
      <TitleBar title="Settings" />

      {urlSaved && (
        <Box paddingBlockEnd="400">
          <Banner tone="success" title="Settings saved successfully." />
        </Box>
      )}

      <Layout>
        {/* Delivery Window */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Delivery Window</Text>
              <Divider />
              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Processing days"
                    helpText="Days to prepare the order before shipping (0 = ships same day)."
                    type="number"
                    min="0"
                    max="30"
                    value={processingDays}
                    onChange={setProcessingDays}
                    autoComplete="off"
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Shipping days — minimum"
                    helpText="Fastest delivery (e.g. 3 days after shipping)."
                    type="number"
                    min="1"
                    max="60"
                    value={shippingDaysMin}
                    onChange={setShippingDaysMin}
                    autoComplete="off"
                  />
                  <TextField
                    label="Shipping days — maximum"
                    helpText="Slowest delivery (e.g. 7 days after shipping)."
                    type="number"
                    min="1"
                    max="60"
                    value={shippingDaysMax}
                    onChange={setShippingDaysMax}
                    autoComplete="off"
                  />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Cut-off Time */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Order Cut-off Time</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Orders placed after this time are processed the next business day.
                </Text>
              </BlockStack>
              <Divider />
              <FormLayout>
                <FormLayout.Group>
                  <Select
                    label="Cut-off hour"
                    options={hourOptions}
                    value={cutoffHour}
                    onChange={setCutoffHour}
                  />
                  <Select
                    label="Timezone"
                    options={timezoneOptions}
                    value={cutoffTimezone}
                    onChange={setCutoffTimezone}
                  />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Business Days */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Business Days</Text>
              <Divider />
              <Checkbox
                label="Exclude weekends (Saturday & Sunday)"
                helpText="Delivery day counts will skip non-business days."
                checked={excludeWeekends}
                onChange={setExcludeWeekends}
              />
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Holiday blackouts
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Add dates you&apos;re closed. Format: YYYY-MM-DD (e.g. 2026-12-25)
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <TextField
                    label=""
                    labelHidden
                    placeholder="2026-12-25"
                    value={holidayInput}
                    onChange={setHolidayInput}
                    autoComplete="off"
                  />
                  <Button onClick={addHoliday} size="slim">Add</Button>
                </InlineStack>
                {holidays.length > 0 && (
                  <InlineStack gap="200" wrap>
                    {holidays.map((d) => (
                      <Tag key={d} onRemove={() => removeHoliday(d)}>
                        {d}
                      </Tag>
                    ))}
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Display */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Widget Display</Text>
              <Divider />
              <TextField
                label="Message template"
                helpText="Use {date_start} and {date_end} as placeholders."
                value={messageTemplate}
                onChange={setMessageTemplate}
                autoComplete="off"
              />
              <Checkbox
                label="Show truck icon"
                checked={showTruckIcon}
                onChange={setShowTruckIcon}
              />
              <TextField
                label="Accent color"
                helpText="Hex color for the icon and highlights (e.g. #008060)."
                value={accentColor}
                onChange={setAccentColor}
                autoComplete="off"
                prefix="#"
                maxLength={7}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Live Preview */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Live Preview</Text>
                <Badge tone="info">Approximate</Badge>
              </InlineStack>
              <Divider />
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
                borderWidth="025"
                borderColor="border"
              >
                <InlineStack gap="200" blockAlign="center">
                  {showTruckIcon && (
                    <Text as="span" variant="bodyLg">🚚</Text>
                  )}
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {previewText}
                  </Text>
                </InlineStack>
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                Preview uses today&apos;s date. Actual dates on storefront account
                for cut-off time, weekends, and holidays.
              </Text>
            </BlockStack>
          </Card>

          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Product-level rules</Text>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Override the default delivery window for specific products,
                  collections, tags, or individual variants.
                </Text>
                <Button url="/app/rules" variant="plain" size="slim">
                  Manage delivery rules →
                </Button>
              </BlockStack>
            </Card>
          </Box>

          {/* Advanced — manual placement selector */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">Advanced Settings</Text>
                      {manualPlacementSelector && (
                        <span style={{ display:"inline-block", background:"#e3f0ff", color:"#0066cc", fontSize:11, fontWeight:600, borderRadius:20, padding:"2px 9px" }}>Active</span>
                      )}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Manual placement selector for theme troubleshooting</Text>
                  </BlockStack>
                  <Button variant="plain" icon={advancedOpen ? ChevronUpIcon : ChevronDownIcon} onClick={() => setAdvancedOpen(o => !o)}>
                    {advancedOpen ? "Hide" : "Show"}
                  </Button>
                </InlineStack>

                <Collapsible open={advancedOpen} id="arrively-advanced" transition={{ duration:"200ms", timingFunction:"ease-in-out" }}>
                  <BlockStack gap="400">
                    <Divider />
                    <Banner tone="info">
                      <Text as="p" variant="bodySm">
                        Arrively auto-detects where to insert the delivery date widget on 80%+ of themes.
                        If the widget appears in the wrong spot, paste a CSS selector below for the element
                        it should appear <strong>before</strong> (e.g. the Add to Cart button).
                        Example: <code>.product-form__submit</code>
                      </Text>
                    </Banner>
                    <TextField
                      label="Widget insertion point selector"
                      helpText="CSS selector for the element before which the delivery date widget should be inserted. Leave blank for automatic placement."
                      value={manualPlacementSelector}
                      onChange={setManualPlacementSelector}
                      autoComplete="off"
                      placeholder=".product-form__submit"
                      monospaced
                      clearButton
                      onClearButtonClick={() => setManualPlacementSelector("")}
                    />
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
