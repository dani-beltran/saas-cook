import type { Locator } from "@playwright/test";

// WCAG relative luminance on actual computed sRGB colors, including composited backgrounds.
export async function contrast(
	locator: Locator,
	property = "color",
	pseudo: string | null = null,
) {
	return locator.evaluate(
		(element, { property, pseudo }) => {
			const rgb = (color: string) => {
				const canvas = document.createElement("canvas");
				canvas.width = canvas.height = 1;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas unavailable");
				context.fillStyle = color;
				context.fillRect(0, 0, 1, 1);
				return [...context.getImageData(0, 0, 1, 1).data];
			};
			const luminance = (channels: number[]) =>
				channels
					.slice(0, 3)
					.map((v) => {
						const s = v / 255;
						return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
					})
					.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
			const background = (element: Element | null): number[] => {
				if (!element) return [255, 255, 255, 255];
				const color = rgb(getComputedStyle(element).backgroundColor);
				if (color[3] === 255) return color;
				const parent = background(element.parentElement);
				return color.map((value, i) =>
					i === 3
						? 255
						: (value * color[3]) / 255 + parent[i] * (1 - color[3] / 255),
				);
			};
			const style = getComputedStyle(element, pseudo);
			const foreground = rgb(style.getPropertyValue(property));
			const bg =
				pseudo === "::selection"
					? rgb(style.backgroundColor)
					: background(
							property === "outline-color" ? element.parentElement : element,
						);
			const a = luminance(foreground);
			const b = luminance(bg);
			return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
		},
		{ property, pseudo },
	);
}
