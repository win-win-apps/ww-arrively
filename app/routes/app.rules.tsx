import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  TextField,
  Select,
  Divider,
  InlineStack,
  Badge,
  Banner,
  Box,
  DataTable,
  EmptyState,
  Modal,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";

// Rule type
type DeliveryRule = {
  id: string;
  type: "product" | "collection" | "tag" | "variant";
  targetId: string;
  targetLabel: string;
  processingDays: string;
  shippingDaysMin: string;
  shippingDaysMax: string;
};

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
  const rulesField = nodes.find((m: { key: string }) => m.key === "rules");
  const rules: DeliveryRule[] = rulesField ? JSON.parse(rulesField.value) : [];
  const installId = data.data?.currentAppInstallation?.id;

  return json({ rules, installId });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  // Re-fetch current rules and installId
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
  const nodes = installData.data?.currentAppInstallation?.metafields?.nodes ?? [];
  const rulesField = nodes.find((m: { key: string }) => m.key === "rules");
  let rules: DeliveryRule[] = rulesField ? JSON.parse(rulesField.value) : [];

  if (intent === "save") {
    const newRule: DeliveryRule = {
      id: String(Date.now()),
      type: String(formData.get("type")) as DeliveryRule["type"],
      targetId: String(formData.get("targetId")),
      targetLabel: String(formData.get("targetLabel")),
      processingDays: String(formData.get("processingDays")),
      shippingDaysMin: String(formData.get("shippingDaysMin")),
      shippingDaysMax: String(formData.get("shippingDaysMax")),
    };
    rules = [...rules, newRule];
  } else if (intent === "delete") {
    const ruleId = String(formData.get("ruleId"));
    rules = rules.filter((r) => r.id !== ruleId);
  }

  await admin.graphql(
    `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [{
          ownerId: installId,
          namespace: "$app",
          key: "rules",
          value: JSON.stringify(rules),
          type: "json",
        }],
      },
    }
  );

  return json({ ok: true });
};

export default function Rules() {
  const { rules } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [modalOpen, setModalOpen] = useState(false);
  const [ruleType, setRuleType] = useState<"product" | "collection" | "tag" | "variant">("product");
  const [targetId, setTargetId] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [processingDays, setProcessingDays] = useState("1");
  const [shippingMin, setShippingMin] = useState("3");
  const [shippingMax, setShippingMax] = useState("7");

  const openModal = useCallback(() => {
    setTargetId(""); setTargetLabel(""); setProcessingDays("1");
    setShippingMin("3"); setShippingMax("7");
    setModalOpen(true);
  }, []);

  const saveRule = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("type", ruleType);
    fd.set("targetId", targetId);
    fd.set("targetLabel", targetLabel || targetId);
    fd.set("processingDays", processingDays);
    fd.set("shippingDaysMin", shippingMin);
    fd.set("shippingDaysMax", shippingMax);
    submit(fd, { method: "post" });
    setModalOpen(false);
  }, [ruleType, targetId, targetLabel, processingDays, shippingMin, shippingMax, submit]);

  const deleteRule = useCallback((ruleId: string) => {
    const fd = new FormData();
    fd.set("intent", "delete");
    fd.set("ruleId", ruleId);
    submit(fd, { method: "post" });
  }, [submit]);

  const typeOptions = [
    { label: "Specific product", value: "product" },
    { label: "Collection", value: "collection" },
    { label: "Product tag", value: "tag" },
    { label: "Specific variant", value: "variant" },
  ];

  const typeLabels: Record<string, string> = {
    product: "Product",
    collection: "Collection",
    tag: "Tag",
    variant: "Variant",
  };

  const rows = rules.map((rule) => [
    <Badge key={rule.id} tone={
      rule.type === "variant" ? "info" :
      rule.type === "collection" ? "success" :
      rule.type === "tag" ? "warning" : undefined
    }>
      {typeLabels[rule.type]}
    </Badge>,
    rule.targetLabel || rule.targetId,
    `${rule.processingDays} day${Number(rule.processingDays) !== 1 ? "s" : ""}`,
    `${rule.shippingDaysMin}–${rule.shippingDaysMax} days`,
    <Button
      key={rule.id}
      variant="plain"
      tone="critical"
      size="slim"
      onClick={() => deleteRule(rule.id)}
    >
      Remove
    </Button>,
  ]);

  const idPlaceholder = {
    product: "Product ID or handle (e.g. summer-tee)",
    collection: "Collection handle (e.g. fast-ship)",
    tag: "Tag name (e.g. local-pickup)",
    variant: "Variant ID (e.g. 48392010281)",
  };

  return (
    <Page
      title="Delivery Rules"
      primaryAction={{ content: "Add rule", onAction: openModal }}
    >
      <TitleBar title="Delivery Rules" />

      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              Rules override the default delivery window for specific products, collections, tags, or variants.{" "}
              <strong>More specific rules win</strong> — variant beats product, product beats collection.
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            {rules.length === 0 ? (
              <EmptyState
                heading="No delivery rules yet"
                image=""
                action={{ content: "Add your first rule", onAction: openModal }}
              >
                <Text as="p" variant="bodyMd">
                  Override the default delivery window for specific products, collections, tags, or individual variants.
                  This is especially useful for items that ship from different warehouses or have longer lead times.
                </Text>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Type", "Target", "Processing", "Shipping", "Actions"]}
                rows={rows}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {/* Add Rule Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add delivery rule"
        primaryAction={{
          content: isSaving ? "Saving…" : "Save rule",
          onAction: saveRule,
          loading: isSaving,
          disabled: !targetId,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <FormLayout>
              <Select
                label="Rule type"
                options={typeOptions}
                value={ruleType}
                onChange={(v) => setRuleType(v as DeliveryRule["type"])}
              />
              <TextField
                label={ruleType === "tag" ? "Tag name" : ruleType === "variant" ? "Variant ID" : `${typeLabels[ruleType]} ID or handle`}
                placeholder={idPlaceholder[ruleType]}
                value={targetId}
                onChange={setTargetId}
                autoComplete="off"
              />
              <TextField
                label="Display label (optional)"
                helpText="Shown in the rules table for your reference."
                placeholder={`e.g. Fast-ship collection`}
                value={targetLabel}
                onChange={setTargetLabel}
                autoComplete="off"
              />
              <Divider />
              <FormLayout.Group>
                <TextField
                  label="Processing days"
                  type="number"
                  min="0"
                  value={processingDays}
                  onChange={setProcessingDays}
                  autoComplete="off"
                />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField
                  label="Shipping days — minimum"
                  type="number"
                  min="1"
                  value={shippingMin}
                  onChange={setShippingMin}
                  autoComplete="off"
                />
                <TextField
                  label="Shipping days — maximum"
                  type="number"
                  min="1"
                  value={shippingMax}
                  onChange={setShippingMax}
                  autoComplete="off"
                />
              </FormLayout.Group>
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
