import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // 48 hours after uninstall, Shopify sends this to confirm
  // all shop data should be deleted. Clean up any remaining sessions.
  await db.session.deleteMany({ where: { shop } }).catch(() => {});

  return new Response();
};
