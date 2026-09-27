"use client";
import { createApiClient } from "@common-saas/api/client";
import type {
	CustomerDto,
	CustomerQuery,
} from "@common-saas/api-contracts/example-customers";
import { useCallback, useEffect, useRef, useState } from "react";

export const customersApi = () =>
	createApiClient(`${window.location.origin}/api/rpc`).exampleCustomers;
/** Mounted per organization + URL query. Cleanup rejects late list and mutation responses. */
export function useCustomers(organizationId: string, query: CustomerQuery) {
	const [items, setItems] = useState<CustomerDto[]>([]),
		[loading, setLoading] = useState(true),
		[error, setError] = useState<unknown>(null),
		[next, setNext] = useState<string | null>(null);
	const [history, setHistory] = useState<Array<string | undefined>>([
		undefined,
	]);
	const [refresh, setRefresh] = useState(0);
	const alive = useRef(true),
		sequence = useRef(0);
	const cursor = history.at(-1);
	// query is stable for this keyed mount; serialize the dependency for clarity.
	const queryKey = JSON.stringify(query);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			sequence.current++;
		};
	}, []);
	useEffect(() => {
		void refresh;
		const request = ++sequence.current;
		setLoading(true);
		setError(null);
		setItems([]);
		setNext(null);
		void customersApi()
			.list({ organizationId, ...JSON.parse(queryKey), cursor })
			.then((page) => {
				if (!alive.current || request !== sequence.current) return;
				if (!page.items.length && !page.nextCursor && history.length > 1) {
					setHistory((h) => h.slice(0, -1));
					return;
				}
				setItems(page.items);
				setNext(page.nextCursor);
				setLoading(false);
			})
			.catch((failure) => {
				if (alive.current && request === sequence.current) {
					setError(failure);
					setLoading(false);
				}
			});
		return () => {
			sequence.current++;
		};
	}, [organizationId, queryKey, cursor, history.length, refresh]);
	const reload = useCallback(() => {
		sequence.current++;
		setRefresh((x) => x + 1);
	}, []);
	return {
		items,
		loading,
		error,
		next,
		alive,
		reload,
		reset: () => {
			setHistory([undefined]);
			reload();
		},
		hasPrevious: history.length > 1,
		previous: () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)),
		advance: () => {
			if (next) setHistory((h) => [...h, next]);
		},
	};
}
