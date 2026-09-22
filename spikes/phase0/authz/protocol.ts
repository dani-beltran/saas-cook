import { createHash, randomUUID } from "node:crypto";
import {
	type Namespace,
	qualifyObject,
	qualifyTuples,
	type Tuple,
} from "./model.js";

export type AttemptState =
	| "building"
	| "verified"
	| "active"
	| "retired"
	| "abandoned";
export interface Attempt extends Namespace {
	id: string;
	revision: number;
	model: string;
	state: AttemptState;
	tuples: Tuple[];
	manifest: string;
}
export interface Revision extends Namespace {
	desired: number;
	applied: number;
	model: string;
	ready: boolean;
}
export interface Graph {
	write(tuples: readonly Tuple[], model: string): Promise<void>;
	remove(tuples: readonly Tuple[], model: string): Promise<void>;
	check(
		user: string,
		relation: string,
		object: string,
		model: string,
	): Promise<boolean>;
}
export interface Authority {
	prepare(organization: string, id: string): Promise<Attempt>;
	acknowledge(attempt: Attempt): Promise<void>;
	publish(attempt: Attempt): Promise<boolean>;
	abandon(attempt: Attempt): Promise<void>;
}
export class Unavailable extends Error {
	constructor(
		public readonly code:
			| "projection_pending"
			| "recovery_pending"
			| "lock_timeout"
			| "queue_full"
			| "remote_timeout"
			| "not_eligible"
			| "denied",
	) {
		super(code);
	}
}

export function requireReady(revision: Revision): void {
	if (!revision.ready) throw new Unavailable("recovery_pending");
	if (revision.desired !== revision.applied || !revision.generation)
		throw new Unavailable("projection_pending");
}

export function manifest(tuples: readonly Tuple[]): string {
	return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}

/** A timeout abandons the namespace, even when its remote write completes later. */
export async function bounded<T>(
	work: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Unavailable("remote_timeout")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export interface ProjectionResult {
	attempt: Attempt;
	published: boolean;
	buildMs: number;
	tuplesWritten: number;
}

export async function project(
	authority: Authority,
	graph: Graph,
	organization: string,
	options: { batchSize?: number; timeoutMs?: number } = {},
): Promise<ProjectionResult> {
	const start = performance.now();
	const attempt = await authority.prepare(organization, randomUUID());
	let tuplesWritten = 0;
	try {
		const batchSize = options.batchSize ?? 100;
		if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
			throw new Error("Write batch must contain 1–100 tuples");
		for (let offset = 0; offset < attempt.tuples.length; offset += batchSize) {
			const batch = attempt.tuples.slice(offset, offset + batchSize);
			await bounded(
				graph.write(batch, attempt.model),
				options.timeoutMs ?? 1_000,
			);
			tuplesWritten += batch.length;
		}
		await authority.acknowledge(attempt);
		const published = await authority.publish(attempt);
		return {
			attempt,
			published,
			buildMs: performance.now() - start,
			tuplesWritten,
		};
	} catch (error) {
		// The durable attempt stays unusable even if this best-effort state update fails.
		await authority.abandon(attempt).catch(() => undefined);
		throw error;
	}
}

export function newAttempt(
	organization: string,
	id: string,
	revision: Revision,
	source: readonly Tuple[],
): Attempt {
	const namespace = { organization, generation: id, epoch: revision.epoch };
	const tuples = qualifyTuples(source, namespace);
	return {
		...namespace,
		id,
		revision: revision.desired,
		model: revision.model,
		state: "building",
		tuples,
		manifest: manifest(tuples),
	};
}

export function canPublish(attempt: Attempt, revision: Revision): boolean {
	return (
		attempt.state === "verified" &&
		attempt.revision === revision.desired &&
		attempt.epoch === revision.epoch &&
		attempt.model === revision.model
	);
}

export async function checkAt(
	graph: Graph,
	revision: Revision,
	user: string,
	object: string,
	permission = "can_read",
): Promise<boolean> {
	requireReady(revision);
	return graph.check(
		user,
		permission,
		qualifyObject(object, revision),
		revision.model,
	);
}

/** FIFO batches of readers do not overtake an already queued writer. */
export class Fence {
	private readers = 0;
	private writer = false;
	private queue: Array<{
		exclusive: boolean;
		resolve: (release: () => void) => void;
		reject: (reason: unknown) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];
	constructor(
		private readonly timeoutMs = 100,
		private readonly capacity = 100,
	) {}

	async run<T>(exclusive: boolean, fn: () => Promise<T>): Promise<T> {
		const release = await this.acquire(exclusive);
		try {
			return await fn();
		} finally {
			release();
		}
	}
	private acquire(exclusive: boolean): Promise<() => void> {
		if (this.queue.length >= this.capacity)
			return Promise.reject(new Unavailable("queue_full"));
		return new Promise((resolve, reject) => {
			const entry = {
				exclusive,
				resolve,
				reject,
				timer: setTimeout(() => {
					this.queue = this.queue.filter((candidate) => candidate !== entry);
					reject(new Unavailable("lock_timeout"));
					this.drain();
				}, this.timeoutMs),
			};
			this.queue.push(entry);
			this.drain();
		});
	}
	private drain(): void {
		if (this.writer) return;
		while (this.queue.length) {
			const next = this.queue[0];
			if (!next || (next.exclusive && this.readers > 0)) return;
			this.queue.shift();
			clearTimeout(next.timer);
			if (next.exclusive) this.writer = true;
			else this.readers++;
			let released = false;
			next.resolve(() => {
				if (released) return;
				released = true;
				if (next.exclusive) this.writer = false;
				else this.readers--;
				this.drain();
			});
			if (next.exclusive) return;
		}
	}
}
