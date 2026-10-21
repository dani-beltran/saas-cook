import { z } from "zod";

/** Public UUID syntax; accepting an ID never establishes access to its resource. */
export const publicId = z.uuid();
/** Public resource/organization slug syntax, independent of uniqueness checks. */
export const resourceSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
/** Scoped command key syntax; services own replay and conflict checks. */
export const operationKey = z.string().min(8).max(120);
/** Expected version for records whose initial, absent state has version zero. */
export const initialVersion = z.number().int().min(0);
