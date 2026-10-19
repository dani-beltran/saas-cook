import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLocale } from "next-intl";
import { useId } from "react";
import { Button } from "./button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "./dialog";
import { Input } from "./input";
import { SampleForm } from "./sample-form";

function ThemeShowcase() {
	const fieldId = useId();
	const es = useLocale() === "es";
	return (
		<Dialog>
			<main
				className="grid gap-field"
				aria-label={es ? "Muestra del tema" : "Theme showcase"}
			>
				<header>
					<h1 className="text-3xl font-semibold">
						{es ? "Tu próximo proyecto" : "Your next project"}
					</h1>
					<p className="mt-2 text-muted-foreground">
						{es
							? "Un espacio para organizar el trabajo de tu equipo."
							: "A place to organize your team's work."}
					</p>
				</header>
				<nav
					aria-label={es ? "Navegación" : "Navigation"}
					className="rounded-xl border border-sidebar-border bg-sidebar p-3 text-sidebar-foreground"
				>
					<a
						href="#theme-form"
						aria-current="page"
						className="block min-h-control rounded-md border-l-4 border-primary bg-sidebar-accent px-3 py-control-y text-sidebar-accent-foreground"
					>
						{es ? "Proyectos" : "Projects"}
					</a>
				</nav>
				<section
					id="theme-form"
					className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
				>
					<SampleForm />
				</section>
				<div className="flex flex-wrap gap-3">
					<DialogTrigger asChild>
						<Button>{es ? "Abrir diálogo" : "Open dialog"}</Button>
					</DialogTrigger>
					<Button variant="secondary">{es ? "Secundario" : "Secondary"}</Button>
					<Button variant="destructive">{es ? "Eliminar" : "Delete"}</Button>
					<Button disabled>{es ? "No disponible" : "Unavailable"}</Button>
				</div>
				<label htmlFor={fieldId} className="grid gap-2 text-sm">
					{es ? "Campo desactivado" : "Disabled field"}
					<Input
						id={fieldId}
						disabled
						value={es ? "Solo lectura" : "Read only"}
					/>
				</label>
				<div className="rounded-md border border-success bg-success-surface p-3 text-success-foreground">
					{es ? "Éxito: cambios guardados." : "Success: changes saved."}
				</div>
				<div className="rounded-md border border-warning bg-warning-surface p-3 text-warning-foreground">
					{es ? "Aviso: revisa los cambios." : "Warning: review the changes."}
				</div>
				<div className="rounded-md border border-info bg-info-surface p-3 text-info-foreground">
					{es
						? "Información: hay una actualización."
						: "Information: an update is available."}
				</div>
				<div className="rounded-md border border-destructive bg-danger-surface p-3 text-destructive">
					{es ? "Error: no se pudo guardar." : "Error: could not save."}
				</div>
				<DialogContent
					showCloseButton={false}
					className="w-[min(480px,calc(100%-32px))]"
				>
					<DialogTitle className="text-xl font-semibold">
						{es ? "Revisar proyecto" : "Review project"}
					</DialogTitle>
					<DialogDescription className="my-4 text-muted-foreground">
						{es
							? "Los cambios están listos para revisar."
							: "Your changes are ready to review."}
					</DialogDescription>
					<DialogClose asChild>
						<Button>{es ? "Cerrar" : "Close"}</Button>
					</DialogClose>
				</DialogContent>
			</main>
		</Dialog>
	);
}

const meta = {
	title: "Foundation/Theme",
	component: ThemeShowcase,
} satisfies Meta<typeof ThemeShowcase>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Showcase: Story = {};
export const SpanishCompact: Story = {
	globals: { locale: "es", density: "compact" },
};
