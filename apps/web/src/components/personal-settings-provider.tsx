"use client";
import type { PersonalSettings } from "@saas-cook/api/runtime";
import type { ThemeConfig } from "@saas-cook/ui/theme";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { identityClient } from "../lib/identity-client";
import { productTheme } from "../product-theme";

type Mode = ThemeConfig["mode"];
type Status = "idle" | "saving" | "saved" | "error";
class SettingsError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}
async function settingsRequest(
	userId: string,
	path = "personal-settings",
	init?: RequestInit,
): Promise<PersonalSettings> {
	const response = await fetch(`/api/auth/${path}`, {
		cache: "no-store",
		...init,
		headers: { ...init?.headers, "x-personal-user": userId },
	});
	if (!response.ok) throw new SettingsError((await response.json()).error);
	const result: PersonalSettings = await response.json();
	if (result.userId !== userId) throw new SettingsError("account_changed");
	return result;
}
const PersonalContext = createContext<{
	settings: PersonalSettings | null;
	mode: Mode;
	status: Status;
	setMode: (mode: Mode) => void;
	refresh: () => Promise<void>;
	changeAvatar: (file: File | null) => Promise<void>;
} | null>(null);
export function usePersonalSettings() {
	return useContext(PersonalContext);
}

export function PersonalSettingsProvider({
	initial,
	children,
}: {
	initial: PersonalSettings | null;
	children: ReactNode;
}) {
	const { data: session, isPending, refetch } = identityClient.useSession();
	const pendingMfa = Boolean(
		session?.user.twoFactorEnabled &&
			!(session.session as { mfa?: boolean }).mfa,
	);
	const settled = !isPending || Boolean(session);
	const userId = session && !pendingMfa ? session.user.id : null;
	const identityKey = `${userId ?? ""}:${session?.session.id ?? ""}`;
	const identity = useRef(identityKey);
	identity.current = identityKey;
	const [settings, setSettings] = useState(initial);
	const snapshot = useRef(initial);
	const [optimistic, setOptimistic] = useState<Mode | null>(null);
	const [status, setStatus] = useState<Status>("idle");
	const desired = useRef<Mode | null>(null);
	const draining = useRef(false);
	const avatarSaving = useRef(false);
	const mutation = useRef(0);
	const refreshGeneration = useRef(0);
	const channel = useRef<BroadcastChannel | null>(null);
	const activeSettings =
		settings?.userId === userId || (isPending && !session) ? settings : null;
	const selectedMode = activeSettings
		? (optimistic ?? activeSettings.mode ?? productTheme.mode)
		: productTheme.mode;
	useLayoutEffect(() => {
		document.documentElement.dataset.mode = selectedMode;
		document
			.querySelector('meta[name="color-scheme"]')
			?.setAttribute(
				"content",
				selectedMode === "system" ? "light dark" : selectedMode,
			);
	}, [selectedMode]);
	const refresh = useCallback(async () => {
		if (!userId) return;
		const key = identityKey;
		const version = mutation.current;
		const generation = ++refreshGeneration.current;
		const result = await settingsRequest(userId);
		if (
			identity.current !== key ||
			version !== mutation.current ||
			generation !== refreshGeneration.current ||
			draining.current ||
			avatarSaving.current
		)
			return;
		if (!snapshot.current) setStatus("idle");
		snapshot.current = result;
		setSettings(result);
	}, [userId, identityKey]);
	useEffect(() => {
		desired.current = null;
		draining.current = false;
		avatarSaving.current = false;
		mutation.current++;
		setOptimistic(null);
		setStatus("idle");
		if (!userId) {
			if (settled) {
				snapshot.current = null;
				setSettings(null);
			}
			return;
		}
		if (snapshot.current?.userId !== userId) {
			snapshot.current = null;
			setSettings(null);
		}
		const reload = () => {
			void refresh().catch(() => {
				if (identity.current === identityKey) setStatus("error");
			});
		};
		reload();
		const onVisible = () => {
			if (document.visibilityState === "visible") reload();
		};
		window.addEventListener("focus", reload);
		document.addEventListener("visibilitychange", onVisible);
		const interval = window.setInterval(onVisible, 30000);
		if (typeof BroadcastChannel !== "undefined") {
			channel.current = new BroadcastChannel("saas-cook-personal-settings");
			// Only invalidations cross tabs. Values and user IDs are never trusted caches.
			channel.current.onmessage = reload;
		}
		return () => {
			window.removeEventListener("focus", reload);
			document.removeEventListener("visibilitychange", onVisible);
			clearInterval(interval);
			channel.current?.close();
			channel.current = null;
		};
	}, [userId, identityKey, settled, refresh]);
	async function saveMode(next: Mode) {
		if (!userId || !snapshot.current || snapshot.current.userId !== userId)
			return;
		desired.current = next;
		setOptimistic(next);
		setStatus("saving");
		if (draining.current) return;
		draining.current = true;
		const key = identityKey;
		const current = () => identity.current === key;
		try {
			while (desired.current && current()) {
				const target: Mode = desired.current;
				mutation.current++;
				try {
					const result = await settingsRequest(userId, "personal-settings", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							mode: target,
							expectedVersion: snapshot.current?.themeVersion,
						}),
					});
					if (!current()) return;
					snapshot.current = {
						...(snapshot.current ?? result),
						mode: result.mode,
						themeVersion: result.themeVersion,
					};
					setSettings(snapshot.current);
					channel.current?.postMessage("changed");
					if (desired.current === target) desired.current = null;
				} catch {
					if (!current()) return;
					// Reconcile even a committed response lost in transit. A newer local choice
					// may then use the fresh revision; an old request never wins the UI.
					const result = await settingsRequest(userId);
					if (!current()) return;
					snapshot.current = {
						...(snapshot.current ?? result),
						mode: result.mode,
						themeVersion: result.themeVersion,
					};
					setSettings(snapshot.current);
					if (desired.current !== target) continue;
					desired.current = null;
					setStatus(result.mode === target ? "saved" : "error");
					return;
				}
			}
			if (current()) setStatus("saved");
		} catch {
			if (current()) {
				desired.current = null;
				setStatus("error");
			}
		} finally {
			if (current()) {
				draining.current = false;
				setOptimistic(null);
			}
		}
	}
	async function changeAvatar(file: File | null) {
		if (!userId || snapshot.current?.userId !== userId)
			throw new SettingsError("account_changed");
		const key = identityKey;
		const operationKey = crypto.randomUUID();
		const expectedVersion = snapshot.current.avatarVersion;
		avatarSaving.current = true;
		mutation.current++;
		try {
			const result = await settingsRequest(userId, "avatar", {
				method: "POST",
				headers: file
					? {
							"Content-Type": file.type,
							"x-avatar-version": expectedVersion ?? "none",
							"x-operation-key": operationKey,
						}
					: { "Content-Type": "application/json" },
				body: file ?? JSON.stringify({ expectedVersion, operationKey }),
			});
			if (identity.current !== key) return;
			snapshot.current = {
				...(snapshot.current ?? result),
				image: result.image,
				avatarVersion: result.avatarVersion,
			};
			setSettings(snapshot.current);
			channel.current?.postMessage("changed");
			void refetch();
		} catch (error) {
			if (identity.current !== key) return;
			const result = await settingsRequest(userId);
			if (identity.current !== key) return;
			snapshot.current = {
				...(snapshot.current ?? result),
				image: result.image,
				avatarVersion: result.avatarVersion,
			};
			setSettings(snapshot.current);
			if (file ? result.avatarVersion === operationKey : !result.image) {
				channel.current?.postMessage("changed");
				void refetch();
				return;
			}
			throw error;
		} finally {
			if (identity.current === key) {
				avatarSaving.current = false;
				mutation.current++;
			}
		}
	}
	return (
		<PersonalContext.Provider
			value={{
				settings: activeSettings,
				mode: selectedMode,
				status,
				setMode: (value) => {
					void saveMode(value);
				},
				refresh,
				changeAvatar,
			}}
		>
			{children}
		</PersonalContext.Provider>
	);
}
