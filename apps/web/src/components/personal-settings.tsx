"use client";
import { Button, Input, RadioGroup, RadioGroupItem } from "@saas-cook/ui";
import type { ThemeConfig } from "@saas-cook/ui/theme";
import { useLocale } from "next-intl";
import { useId, useRef, useState } from "react";
import { personalSettingsMessages } from "../i18n/personal-settings";
import { usePersonalSettings } from "./personal-settings-provider";

export function AppearanceChoices({
	value,
	disabled = false,
	onChange,
}: {
	value: ThemeConfig["mode"];
	disabled?: boolean;
	onChange: (mode: ThemeConfig["mode"]) => void;
}) {
	const id = useId();
	const copy = personalSettingsMessages[useLocale() === "es" ? "es" : "en"];
	return (
		<>
			{" "}
			<fieldset disabled={disabled}>
				<legend id="color-mode-label" className="sr-only">
					{copy.mode}
				</legend>
				<RadioGroup
					className="account-mode-options"
					name="color-mode"
					aria-labelledby="color-mode-label"
					aria-describedby="color-mode-help"
					value={value}
					disabled={disabled}
					onValueChange={(mode) => {
						if (mode === "light" || mode === "dark" || mode === "system")
							onChange(mode);
					}}
				>
					{(["light", "dark", "system"] as const).map((mode) => (
						<label
							key={mode}
							className="account-mode-option"
							htmlFor={`${id}-${mode}`}
						>
							<RadioGroupItem
								id={`${id}-${mode}`}
								value={mode}
								aria-describedby="color-mode-help"
							/>
							<span
								className={`account-mode-preview mode-${mode}`}
								aria-hidden="true"
							>
								<span />
								<span />
								<span />
							</span>
							<span className="account-mode-label">
								{copy[mode]}
								<span className="account-mode-check" aria-hidden="true">
									✓
								</span>
							</span>
						</label>
					))}
				</RadioGroup>
			</fieldset>
			<p id="color-mode-help" className="account-setting-description">
				{copy.systemHelp}
			</p>
		</>
	);
}

export function AppearanceSettings() {
	const copy = personalSettingsMessages[useLocale() === "es" ? "es" : "en"];
	const personal = usePersonalSettings();
	if (!personal) return null;
	return (
		<section className="account-appearance" aria-labelledby="appearance-title">
			<div className="account-section-intro">
				<div>
					<h2 id="appearance-title">{copy.appearance}</h2>
					<p>{copy.description}</p>
				</div>
			</div>
			<AppearanceChoices
				value={personal.mode}
				disabled={!personal.settings}
				onChange={personal.setMode}
			/>
			{!personal.settings ? (
				<p
					role={personal.status === "error" ? "alert" : "status"}
					className="account-setting-description"
				>
					{personal.status === "error" ? copy.loadError : copy.loading}{" "}
					{personal.status === "error" && (
						<Button
							variant="secondary"
							onClick={() => {
								void personal.refresh().catch(() => {});
							}}
						>
							{copy.retry}
						</Button>
					)}
				</p>
			) : (
				<p
					role={personal.status === "error" ? "alert" : "status"}
					className={`account-preference-status${personal.status === "error" ? " text-destructive" : ""}`}
				>
					{personal.status === "idle"
						? ""
						: copy[
								personal.status === "saved"
									? "saved"
									: personal.status === "saving"
										? "saving"
										: "error"
							]}
				</p>
			)}
		</section>
	);
}
export function ProfilePictureControls() {
	const copy = personalSettingsMessages[useLocale() === "es" ? "es" : "en"];
	const personal = usePersonalSettings();
	const input = useRef<HTMLInputElement>(null);
	const working = useRef(false);
	const [status, setStatus] = useState<
		"idle" | "pending" | "success" | "invalid" | "failed" | "conflict"
	>("idle");
	if (!personal) return null;
	async function update(file: File | null) {
		if (!personal || working.current) return;
		if (
			file &&
			(!file.size ||
				file.size > 5 * 1024 * 1024 ||
				!["image/jpeg", "image/png", "image/webp"].includes(file.type))
		) {
			setStatus("invalid");
			return;
		}
		working.current = true;
		setStatus("pending");
		try {
			await personal.changeAvatar(file);
			setStatus("success");
		} catch (error) {
			setStatus(
				error instanceof Error &&
					["invalid_image", "too_large"].includes(error.message)
					? "invalid"
					: error instanceof Error && error.message === "conflict"
						? "conflict"
						: "failed",
			);
		} finally {
			working.current = false;
		}
	}
	const busy = status === "pending";
	const error = ["invalid", "failed", "conflict"].includes(status);
	return (
		<div className="account-picture-controls" aria-busy={busy}>
			<div className="account-picture-actions">
				<Input
					ref={input}
					hidden
					tabIndex={-1}
					type="file"
					accept="image/jpeg,image/png,image/webp"
					aria-label={copy.picture}
					disabled={busy || !personal.settings}
					aria-describedby="picture-guidance"
					onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						if (file) void update(file);
					}}
				/>
				<Button
					variant="secondary"
					disabled={busy || !personal.settings}
					onClick={() => input.current?.click()}
				>
					{personal.settings?.image ? copy.change : copy.upload}
				</Button>
				{personal.settings?.image && (
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => {
							void update(null);
						}}
					>
						{copy.remove}
					</Button>
				)}
			</div>
			<p id="picture-guidance" className="account-setting-description">
				{copy.guidance}
				<br />
				{copy.limits}
			</p>
			<p
				role={error ? "alert" : "status"}
				className={`account-preference-status${error ? " text-destructive" : ""}`}
			>
				{status === "idle" ? "" : copy[status]}
			</p>
		</div>
	);
}
