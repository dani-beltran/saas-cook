"use client";
import { useState } from "react";
import { usePersonalSettings } from "./personal-settings-provider";

export function UserAvatar({
	user,
	className = "dashboard-avatar",
}: {
	user: {
		id?: string;
		name?: string | null;
		email: string;
		image?: string | null;
	};
	className?: string;
}) {
	const personal = usePersonalSettings();
	const image =
		personal?.settings && personal.settings.userId === user.id
			? personal.settings.image
			: user.image;
	const [failedImage, setFailedImage] = useState<string | null>(null);
	// Historical external identity URLs are never fetched from the browser.
	const safeImage =
		image && /^\/api\/auth\/avatar\?version=[0-9a-f-]{36}$/.test(image)
			? image
			: null;
	const initials = (user.name?.trim() || user.email)
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0])
		.join("")
		.toUpperCase();
	return (
		<span className={`${className} user-avatar`} aria-hidden="true">
			{safeImage && safeImage !== failedImage ? (
				// biome-ignore lint/performance/noImgElement: Private normalized avatars require the browser session; an image proxy cannot authenticate delivery.
				<img
					src={safeImage}
					alt=""
					width={64}
					height={64}
					onError={() => setFailedImage(safeImage)}
				/>
			) : (
				initials
			)}
		</span>
	);
}
