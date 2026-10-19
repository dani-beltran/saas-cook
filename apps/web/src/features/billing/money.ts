// Stripe charge minor units, including ISK/UGX compatibility; this is not a payout formatter.
// https://docs.stripe.com/currencies#zero-decimal
const zeroDecimal = new Set(
	"bif clp djf gnf jpy kmf krw mga pyg rwf vnd vuv xaf xof xpf".split(" "),
);
export function formatBillingAmount(
	amount: number,
	currency: string,
	locale: string,
) {
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
		amount / (zeroDecimal.has(currency.toLowerCase()) ? 1 : 100),
	);
}
