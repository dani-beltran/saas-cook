import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./dialog";
import { NativeSelect, NativeSelectOption } from "./native-select";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "./table";
import { Textarea } from "./textarea";

function SharedControls({ disabled = false }: { disabled?: boolean }) {
	const id = useId();
	const es = useLocale() === "es";
	const [saved, setSaved] = useState("");
	const [appearanceChanges, setAppearanceChanges] = useState(0);
	const [open, setOpen] = useState(false);
	const [locked, setLocked] = useState(false);
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm({ defaultValues: { status: "", notes: "" } });
	return (
		<div className="grid max-w-lg gap-6">
			<form
				className="grid gap-4"
				onReset={() => {
					reset();
					setSaved("");
				}}
				onSubmit={(event) => {
					const form = event.currentTarget;
					void handleSubmit((values) => {
						const data = new FormData(form);
						setSaved(
							JSON.stringify({
								...values,
								notify: data.get("notify"),
								appearance: data.get("appearance"),
							}),
						);
					})(event);
				}}
			>
				<label htmlFor={`${id}-status`}>{es ? "Estado" : "Status"}</label>
				<NativeSelect
					id={`${id}-status`}
					disabled={disabled}
					aria-invalid={Boolean(errors.status)}
					aria-describedby={errors.status ? `${id}-error` : undefined}
					{...register("status", {
						required: es ? "Selecciona un estado" : "Choose a status",
					})}
				>
					<NativeSelectOption value="">
						{es ? "Seleccionar" : "Choose"}
					</NativeSelectOption>
					<NativeSelectOption value="active">
						{es ? "Activo" : "Active"}
					</NativeSelectOption>
					<NativeSelectOption value="archived" disabled>
						{es ? "Archivado" : "Archived"}
					</NativeSelectOption>
				</NativeSelect>
				{errors.status && (
					<p id={`${id}-error`} role="alert">
						{errors.status.message}
					</p>
				)}
				<label htmlFor={`${id}-notes`}>{es ? "Notas" : "Notes"}</label>
				<Textarea
					id={`${id}-notes`}
					disabled={disabled}
					{...register("notes")}
				/>
				<label htmlFor={`${id}-notify`} className="flex items-center gap-3">
					<Checkbox id={`${id}-notify`} name="notify" disabled={disabled} />
					{es ? "Recibir avisos" : "Receive notices"}
				</label>
				<RadioGroup
					name="appearance"
					onValueChange={() => setAppearanceChanges((count) => count + 1)}
					defaultValue="light"
					disabled={disabled}
					aria-label={es ? "Apariencia" : "Appearance"}
				>
					{(["light", "dark"] as const).map((mode) => (
						<label
							key={mode}
							htmlFor={`${id}-${mode}`}
							className="flex items-center gap-3"
						>
							<RadioGroupItem id={`${id}-${mode}`} value={mode} />
							{mode === "light"
								? es
									? "Claro"
									: "Light"
								: es
									? "Oscuro"
									: "Dark"}
						</label>
					))}
				</RadioGroup>
				<p>
					{es ? "Cambios de apariencia" : "Appearance changes"}:{" "}
					{appearanceChanges}
				</p>
				<div className="flex gap-3">
					<Button type="submit" disabled={disabled}>
						{es ? "Guardar" : "Save"}
					</Button>
					<Button type="reset" variant="secondary" disabled={disabled}>
						{es ? "Restablecer" : "Reset"}
					</Button>
				</div>
				<output aria-live="polite">{saved}</output>
			</form>
			<Table>
				<TableCaption>{es ? "Resultados" : "Results"}</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead scope="col">{es ? "Nombre" : "Name"}</TableHead>
						<TableHead scope="col">{es ? "Estado" : "Status"}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell>Sample</TableCell>
						<TableCell>{es ? "Activo" : "Active"}</TableCell>
					</TableRow>
				</TableBody>
			</Table>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!locked) setOpen(next);
				}}
			>
				<DialogTrigger asChild>
					<Button>{es ? "Revisar" : "Review"}</Button>
				</DialogTrigger>
				<DialogContent
					showCloseButton={false}
					onInteractOutside={(event) => event.preventDefault()}
					onEscapeKeyDown={(event) => {
						if (locked) event.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{es ? "Revisar cambios" : "Review changes"}
						</DialogTitle>
						<DialogDescription>
							{es
								? "Comprueba los cambios antes de guardar."
								: "Check the changes before saving."}
						</DialogDescription>
					</DialogHeader>
					<label
						htmlFor={`${id}-locked`}
						className="my-4 flex items-center gap-3"
					>
						<Checkbox
							id={`${id}-locked`}
							checked={locked}
							onCheckedChange={(checked) => setLocked(checked === true)}
						/>
						{es ? "Guardando" : "Saving"}
					</label>
					<DialogFooter>
						<DialogClose asChild>
							<Button disabled={locked}>{es ? "Cerrar" : "Close"}</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
const meta = {
	title: "Foundation/Controls",
	component: SharedControls,
} satisfies Meta<typeof SharedControls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Spanish: Story = { globals: { locale: "es" } };
