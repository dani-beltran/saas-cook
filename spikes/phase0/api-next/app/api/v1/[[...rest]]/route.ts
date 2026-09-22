import { handle } from "../../../../handlers";
export const runtime = "nodejs";
const request = (r: Request) => handle(r, "rest");
export { request as GET, request as POST, request as PATCH };
