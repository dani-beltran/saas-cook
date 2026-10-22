import { createWriteStream } from "node:fs";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";

/**
 * Retain workload output without letting disk/write errors bypass owned-service teardown.
 * @param path Unique ignored log path; defaults to exclusive file creation.
 * @param onFailure Callback that marks the run failed and requests bounded interruption.
 * @param open Injectable stream factory for failure tests; production uses an ordinary file.
 * @returns Writes until finalization and idempotent flush status with a 5-second deadline.
 * The retained log is output received through environment finalization; later output is ignored.
 */
export function performanceLog(
	path: string,
	onFailure: () => void,
	open: (path: string) => Writable = (path) =>
		createWriteStream(path, { flags: "wx" }),
) {
	const stream = open(path);
	let failed = false;
	const mark = () => {
		if (!failed) {
			failed = true;
			onFailure();
		}
	};
	stream.on("error", mark);
	let closed = false;
	let result: Promise<boolean> | undefined;
	return {
		write(chunk: Uint8Array) {
			if (!closed && !stream.destroyed) stream.write(chunk);
		},
		finish() {
			if (result) return result;
			closed = true;
			let timer: ReturnType<typeof setTimeout>;
			const flushed = finished(stream).then(
				() => !failed,
				() => {
					mark();
					return false;
				},
			);
			const expired = new Promise<boolean>((resolve) => {
				timer = setTimeout(() => {
					mark();
					stream.destroy();
					resolve(false);
				}, 5000);
			});
			stream.end();
			result = Promise.race([flushed, expired]).finally(() =>
				clearTimeout(timer),
			);
			return result;
		},
	};
}
