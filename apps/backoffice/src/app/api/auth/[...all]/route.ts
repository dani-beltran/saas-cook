import { publicRequest } from "../../../../lib/request";
import { backoffice } from "../../../../lib/runtime";
/** Routes only the allowlisted isolated staff ceremonies. */
export async function GET(request: Request) {
	return backoffice().identity.handle(publicRequest(request));
}
/** Same identity, ingress and audit boundary for state-changing ceremonies. */
export async function POST(request: Request) {
	return backoffice().identity.handle(publicRequest(request));
}
