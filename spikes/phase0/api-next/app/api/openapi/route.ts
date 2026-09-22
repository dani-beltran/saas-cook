import { specification } from "../../../handlers";
export const GET = async () => Response.json(await specification());
