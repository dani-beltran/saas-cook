/** Deliberately unsafe evaluation fixture; never application code. */
export async function listItems(client) {
	return (await client.query("SELECT * FROM tenancy.commercial_review_items"))
		.rows;
}
export function publicInput(value) {
	return { ...value };
}
export async function readProject(client, _actor, id) {
	return (
		await client.query("SELECT * FROM tenancy.projects WHERE id=$1", [id])
	).rows[0];
}
export function erased({ personMissing, ingestionAcknowledged }) {
	return personMissing || ingestionAcknowledged;
}
export function restoreCredentials(saved) {
	return { ...saved, verified: true };
}
