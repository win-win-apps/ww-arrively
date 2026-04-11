/**
 * Redirect /app/additional to /app to avoid 404 on the boilerplate route.
 */
import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app");
};

export default function AdditionalPage() {
  return null;
}
