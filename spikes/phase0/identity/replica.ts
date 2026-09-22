// Separate OS processes avoid Better Auth's in-process verification mutex masking
// a broken database consume operation. IPC keeps token values out of argv/logs.
import { makeProvider, origin } from "./provider.ts";

const provider = makeProvider();
process.on("message", async (message: { token: string }) => {
  try {
    const result = await provider.auth.api.magicLinkVerify({ query: { token: message.token }, headers: new Headers({ origin }), asResponse: true });
    process.send?.({ consumed: result.status === 200 });
  } catch { process.send?.({ consumed: false }); }
  finally { await provider.pool.end(); process.disconnect(); }
});
await provider.auth.$context;
process.send?.({ ready: true });
