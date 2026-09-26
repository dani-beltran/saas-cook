import type { Metadata } from "next";
import { ConfirmIdentity } from "../../../components/confirm-identity";
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function ConfirmationPage() { return <ConfirmIdentity />; }
