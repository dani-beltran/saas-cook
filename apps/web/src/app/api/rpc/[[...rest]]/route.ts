import { handleApi } from "@saas-cook/api";
export const runtime = "nodejs";
const handler = (request: Request) => handleApi(request, "rpc");

export {
	handler as GET,
	handler as POST,
	handler as PUT,
	handler as PATCH,
	handler as DELETE,
};
