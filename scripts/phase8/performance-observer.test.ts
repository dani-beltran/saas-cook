import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("observes real HTTP revocation context without retaining identifiers or changing fetch results", async () => {
	const directory = await mkdtemp(join(tmpdir(), "phase8-observer-test-"));
	try {
		const code = `
const fs=require('node:fs'),http=require('node:http'),{channel}=require('node:diagnostics_channel');
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const dir=require('node:os').tmpdir();
const secret='synthetic-secret-must-never-appear';
const response={ok:true,status:204};
globalThis.fetch=async()=>response;
require(${JSON.stringify(resolve("scripts/phase8/performance-observer.cjs"))});
const server=http.createServer(async(req,res)=>{
 for(const milliseconds of [12.2,99.999,100,100.001]) channel('saas-cook.authorization.fence-wait').publish({milliseconds,credential:secret});
 const result=await fetch('http://fga.test/stores/SECRET/check',{body:JSON.stringify({contextual_tuples:{tuple_keys:[{user:secret}]}})});
 if(result!==response)throw Error('observer replaced the provider result');
 res.end();
});
const request=()=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/v1/organizations/SECRET/resource-grants/SECRET',method:'DELETE'},res=>{res.resume();res.once('end',resolve)});req.once('error',reject);req.end();});
(async()=>{
 fs.writeFileSync(dir+'/phase8-window.json',JSON.stringify({start:Date.now()-1,end:Date.now()+5000}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await wait(250);await request();await wait(250);
 const before=JSON.parse(fs.readFileSync(dir+'/phase8-observer-'+process.pid+'.json','utf8'));
 fs.writeFileSync(dir+'/phase8-window.json',JSON.stringify({start:0,end:1}));await wait(250);await request();await wait(250);
 const after=JSON.parse(fs.readFileSync(dir+'/phase8-observer-'+process.pid+'.json','utf8'));
 server.close();process.stdout.write(JSON.stringify({before,after}));
})().catch(()=>{server.close();process.exitCode=1;});`;
		const result = await promisify(execFile)(process.execPath, ["-e", code], {
			timeout: 5000,
			env: {
				...process.env,
				NODE_OPTIONS: "",
				OPENFGA_API_URL: "http://fga.test",
				TMPDIR: directory,
			},
		});
		expect(result.stdout).not.toContain("SECRET");
		expect(result.stdout).not.toContain("synthetic-secret");
		const { before, after } = JSON.parse(result.stdout);
		expect(before.fence).toEqual({ 13: 1, 100: 2, 101: 1 });
		expect(before.fenceThreshold).toEqual({
			limitExclusiveMs: 100,
			count: 4,
			below: 2,
			atOrAbove: 2,
		});
		expect(before.revocationFence).toEqual({ 13: 1, 100: 2, 101: 1 });
		expect(before.tuples).toEqual({ 1: 1 });
		expect(before.checks).toBe(1);
		expect(before.malformed).toBe(0);
		expect(after.checks).toBe(1);
		expect(after.fence).toEqual(before.fence);
		expect(after.fenceThreshold).toEqual(before.fenceThreshold);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
