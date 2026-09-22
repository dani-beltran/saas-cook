import { handle } from "../../../../handlers";
export const runtime = "nodejs";
const request = (r: Request) => handle(r, "rpc");
export { request as GET, request as POST, request as PATCH };
