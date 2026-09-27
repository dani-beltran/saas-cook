"use client";

import { useEffect, useState } from "react";

// A visual preference only; organization context always comes from the route.
export function useAppearance() {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const sync = () => {
			let preference: string | null = null;
			try {
				preference = localStorage.getItem("common-saas-appearance");
			} catch {}
			setDark(preference ? preference === "dark" : media.matches);
		};
		sync();
		media.addEventListener("change", sync);
		window.addEventListener("storage", sync);
		return () => {
			media.removeEventListener("change", sync);
			window.removeEventListener("storage", sync);
		};
	}, []);
	return {
		dark,
		toggleTheme: () => {
			setDark(!dark);
			try {
				localStorage.setItem("common-saas-appearance", dark ? "light" : "dark");
			} catch {}
		},
	};
}
