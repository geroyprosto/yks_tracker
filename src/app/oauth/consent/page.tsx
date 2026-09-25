import type { Metadata } from "next";
import { OAuthConsent } from "@/components/oauth-consent";

export const metadata: Metadata = {
  title: "Bağlantı izni · YKSim",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConsentPage({ searchParams }: {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
  const params = await searchParams;
  const authorizationId = typeof params.authorization_id === "string" ? params.authorization_id : "";
  return <OAuthConsent authorizationId={authorizationId} />;
}
