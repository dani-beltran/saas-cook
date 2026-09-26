import { connect } from "node:net";
import { connect as connectTls } from "node:tls";
import type { EmailTransport } from "./delivery";

/** Bounded SMTP adapter. Remote credentials require implicit TLS; local Mailpit needs none. */
export function createSmtpTransport(options: {
	host: string;
	port: number;
	from: string;
	secure?: boolean;
	username?: string;
	password?: string;
}): EmailTransport {
	if (/[\r\n<>]/.test(options.from) || !options.from.includes("@"))
		throw new Error("Invalid SMTP sender");
	if (options.username && !options.secure)
		throw new Error("SMTP credentials require TLS");
	return async (message) => {
		if (/[\r\n<>]/.test(message.to)) throw new Error("Invalid SMTP recipient");
		const socket = options.secure
			? connectTls({
					host: options.host,
					port: options.port,
					servername: options.host,
				})
			: connect({ host: options.host, port: options.port });
		socket.setEncoding("utf8");
		socket.setTimeout(10000, () => socket.destroy(new Error("SMTP timeout")));
		let buffer = "";
		const replies: string[] = [];
		let pending: ((response: string) => void) | undefined;
		let failure: Error | undefined;
		socket.on("data", (chunk) => {
			buffer += chunk;
			while (buffer.includes("\r\n")) {
				const boundary = buffer.indexOf("\r\n");
				const line = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				if (/^\d{3} /.test(line)) {
					if (pending) {
						const callback = pending;
						pending = undefined;
						callback(line);
					} else replies.push(line);
				}
			}
		});
		socket.on("error", (error) => {
			failure = error;
			pending?.("000 transport failed");
			pending = undefined;
		});
		socket.on("close", () => {
			failure ??= new Error("SMTP closed");
			pending?.("000 transport closed");
			pending = undefined;
		});
		async function read(code: number) {
			if (failure) throw new Error("SMTP delivery unavailable");
			const response =
				replies.shift() ??
				(await new Promise<string>((resolve) => {
					pending = resolve;
				}));
			if (Number(response.slice(0, 3)) !== code)
				throw new Error("SMTP delivery unavailable");
		}
		async function command(value: string, code: number) {
			socket.write(`${value}\r\n`);
			await read(code);
		}
		try {
			await read(220);
			await command("EHLO common-saas", 250);
			if (options.username)
				await command(
					`AUTH PLAIN ${Buffer.from(`\0${options.username}\0${options.password ?? ""}`).toString("base64")}`,
					235,
				);
			await command(`MAIL FROM:<${options.from}>`, 250);
			await command(`RCPT TO:<${message.to}>`, 250);
			await command("DATA", 354);
			const boundary = `common-saas-${message.id}`;
			const encode = (value: string) =>
				Buffer.from(value)
					.toString("base64")
					.match(/.{1,76}/g)
					?.join("\r\n") ?? "";
			const mime = [
				`From: <${options.from}>`,
				`To: <${message.to}>`,
				`Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`,
				`Message-ID: <${message.id}@common-saas>`,
				`MIME-Version: 1.0`,
				`Content-Type: multipart/alternative; boundary="${boundary}"`,
				"",
				`--${boundary}`,
				"Content-Type: text/plain; charset=UTF-8",
				"Content-Transfer-Encoding: base64",
				"",
				encode(message.text),
				`--${boundary}`,
				"Content-Type: text/html; charset=UTF-8",
				"Content-Transfer-Encoding: base64",
				"",
				encode(message.html),
				`--${boundary}--`,
				"",
			].join("\r\n");
			await command(`${mime}\r\n.`, 250);
			await command("QUIT", 221);
		} finally {
			socket.destroy();
		}
	};
}
