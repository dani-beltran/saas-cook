import type { Metadata } from "next";
import { ResetPassword } from "../../../components/reset-password";

export const metadata: Metadata = {
	referrer: "no-referrer",
	robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function ResetPasswordPage() {
	return <ResetPassword />;
}
