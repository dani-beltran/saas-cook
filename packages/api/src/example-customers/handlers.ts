import type { ResourceActor } from "@saas-cook/db/resources";
import { ResourceError } from "@saas-cook/db/resources";
import type { TenantActor } from "@saas-cook/db/tenancy";
import type { applicationRuntime } from "../runtime";

type Runtime = ReturnType<typeof applicationRuntime>;
type Service = Runtime["exampleCustomers"];
function human(actor: ResourceActor): TenantActor {
	if ("kind" in actor) throw new ResourceError("DENIED");
	return actor;
}
/** Feature handlers stay separate; root registration declares each endpoint capability. */
export const exampleCustomerHandlers = {
	list(
		runtime: Runtime,
		actor: ResourceActor,
		organizationId: string,
		input: Parameters<Service["list"]>[2],
	) {
		return runtime.exampleCustomers.list(human(actor), organizationId, input);
	},
	get(
		runtime: Runtime,
		actor: ResourceActor,
		organizationId: string,
		input: Parameters<Service["get"]>[2],
	) {
		return runtime.exampleCustomers.get(human(actor), organizationId, input);
	},
	create(
		runtime: Runtime,
		actor: ResourceActor,
		organizationId: string,
		input: Parameters<Service["create"]>[2],
	) {
		return runtime.exampleCustomers.create(human(actor), organizationId, input);
	},
	update(
		runtime: Runtime,
		actor: ResourceActor,
		organizationId: string,
		input: Parameters<Service["update"]>[2],
	) {
		return runtime.exampleCustomers.update(human(actor), organizationId, input);
	},
	delete(
		runtime: Runtime,
		actor: ResourceActor,
		organizationId: string,
		input: Parameters<Service["delete"]>[2],
	) {
		return runtime.exampleCustomers.delete(human(actor), organizationId, input);
	},
};
