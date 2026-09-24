import type {
	BashToolDetails,
	EditToolDetails,
	ExtensionAPI,
	ExtensionContext,
	ReadToolDetails,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	CustomEditor,
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	keyHint,
	renderDiff,
	SettingsManager,
	UserMessageComponent,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { relative } from "node:path";

const PREVIEW_LINES = 5;
const RAIL = "┃";

type RowState = { isPartial: boolean; isError: boolean };

const text = (s: string) => new Text(s, 0, 0);

function tilde(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function shortPath(path: string | undefined, cwd: string): string {
	if (!path) return "…";
	const rel = relative(cwd, path);
	if (path.startsWith("/") && rel && !rel.startsWith("..")) return rel;
	return tilde(path);
}

// fx rows: "● Verb arg" with the argument in gray.
function row(theme: Theme, state: RowState, verb: string, arg: string, suffix = ""): string {
	const dot = state.isError ? theme.fg("error", "■") : state.isPartial ? theme.fg("dim", "●") : "●";
	return `${dot} ${verb} ${theme.fg("muted", arg)}${suffix}`;
}

// First output line hangs off "└", the rest align under it.
function tree(theme: Theme, lines: string[]): string {
	return lines.map((l, i) => `${theme.fg("dim", i === 0 ? "└ " : "  ")}${l}`).join("\n");
}

const join = (...parts: string[]) => parts.filter(Boolean).join("\n");

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n")
		.trimEnd();
}

function preview(theme: Theme, body: string, expanded: boolean, color: "toolOutput" | "error" = "toolOutput"): string[] {
	const lines = body ? body.split("\n") : [];
	const shown = expanded ? lines : lines.slice(-PREVIEW_LINES);
	const out = shown.map((l) => theme.fg(color, l));
	const hidden = lines.length - shown.length;
	if (hidden > 0) out.unshift(theme.fg("dim", `… ${hidden} earlier lines `) + keyHint("app.tools.expand", "to expand"));
	return out;
}

function registerTools(pi: ExtensionAPI) {
	const settings = SettingsManager.create(process.cwd());
	const cwd = process.cwd();

	const read = createReadToolDefinition(cwd, { autoResizeImages: settings.getImageAutoResize() });
	pi.registerTool({
		...read,
		renderShell: "self",
		renderCall(args, theme, ctx) {
			const start = args.offset ?? 1;
			const range = args.offset || args.limit ? `:${start}${args.limit ? `-${start + args.limit - 1}` : ""}` : "";
			return text(row(theme, ctx, ctx.isPartial ? "Reading" : "Read", shortPath(args.path, ctx.cwd) + range));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) return text("");
			const body = textOf(result);
			if (ctx.isError) return text(tree(theme, preview(theme, body, expanded, "error")));
			if (result.content.some((c) => c.type === "image")) return text(tree(theme, [theme.fg("muted", "image")]));
			if (expanded) return text(tree(theme, preview(theme, body, true)));
			const n = body.split("\n").length;
			const truncated = (result.details as ReadToolDetails | undefined)?.truncation?.truncated ? " (truncated)" : "";
			return text(tree(theme, [theme.fg("muted", `${n} line${n === 1 ? "" : "s"}${truncated}`)]));
		},
	});

	const bash = createBashToolDefinition(cwd, {
		commandPrefix: settings.getShellCommandPrefix(),
		shellPath: settings.getShellPath(),
	});
	pi.registerTool({
		...bash,
		renderShell: "self",
		renderCall(args, theme, ctx) {
			const [first = "", ...rest] = (args.command ?? "").split("\n");
			return text(row(theme, ctx, ctx.isPartial ? "Running" : "Ran", rest.length ? `${first} …` : first));
		},
		renderResult(result, { expanded }, theme, ctx) {
			const lines = preview(theme, textOf(result), expanded, ctx.isError ? "error" : "toolOutput");
			const full = (result.details as BashToolDetails | undefined)?.fullOutputPath;
			if (full) lines.push(theme.fg("muted", `full output: ${full}`));
			return text(lines.length ? tree(theme, lines) : "");
		},
	});

	const write = createWriteToolDefinition(cwd);
	pi.registerTool({
		...write,
		renderShell: "self",
		renderCall(args, theme, ctx) {
			const n = args.content ? args.content.replace(/\n$/, "").split("\n").length : 0;
			const suffix = n ? theme.fg("muted", ` (${n} line${n === 1 ? "" : "s"})`) : "";
			return text(row(theme, ctx, ctx.isPartial ? "Writing" : "Wrote", shortPath(args.path, ctx.cwd), suffix));
		},
		renderResult(result, { expanded }, theme, ctx) {
			return text(ctx.isError ? tree(theme, preview(theme, textOf(result), expanded, "error")) : "");
		},
	});

	const edit = createEditToolDefinition(cwd);
	pi.registerTool({
		...edit,
		renderShell: "self",
		renderCall(args, theme, ctx) {
			// The finished row carries +/- stats from the result, so renderResult draws it.
			return text(ctx.isPartial ? row(theme, ctx, "Editing", shortPath(args.path, ctx.cwd)) : "");
		},
		renderResult(result, { expanded }, theme, ctx) {
			const path = shortPath(ctx.args.path, ctx.cwd);
			if (ctx.isError) {
				return text(join(row(theme, ctx, "Edit failed", path), tree(theme, preview(theme, textOf(result), expanded, "error"))));
			}
			const diff = (result.details as EditToolDetails | undefined)?.diff ?? "";
			const lines = diff.split("\n");
			const add = lines.filter((l) => l.startsWith("+")).length;
			const del = lines.filter((l) => l.startsWith("-")).length;
			const stats = [add ? theme.fg("toolDiffAdded", `+${add}`) : "", del ? theme.fg("toolDiffRemoved", `-${del}`) : ""]
				.filter(Boolean)
				.join(theme.fg("muted", " / "));
			const head = row(theme, ctx, "Edited", path, stats ? ` ${stats}` : "");
			return text(join(head, diff ? tree(theme, renderDiff(diff).split("\n")) : ""));
		},
	});
}

type PatchedProto = UserMessageComponent & { __fxTheme?: () => Theme };

// Pi has no user-message renderer hook, so patch the shared component once;
// __fxTheme doubles as the on/off switch across reloads and shutdown.
function patchUserMessages(getTheme: (() => Theme) | undefined) {
	const proto = UserMessageComponent.prototype as PatchedProto;
	const patched = "__fxTheme" in proto;
	proto.__fxTheme = getTheme;
	if (patched) return;
	const render = proto.render;
	proto.render = function (this: PatchedProto, width: number) {
		const theme = this.__fxTheme?.();
		if (!theme) return render.call(this, width);
		const lines = render.call(this, Math.max(1, width - 1));
		// Box padding makes the first and last lines blank. Drop the last (pi already adds a
		// spacer after it) but keep its OSC 133 prompt markers on the final content line.
		if (lines.length < 3) return lines;
		const out = lines.slice(0, -1).map((line, i) => (i === 0 ? line : `${theme.fg("accent", RAIL)}\x1b[1m${line}\x1b[22m`));
		out[out.length - 1] += lines[lines.length - 1]!.match(/\x1b\]133;[A-Z]\x07/g)?.join("") ?? "";
		return out;
	};
}

function header(ctx: ExtensionContext) {
	ctx.ui.setHeader((_tui, theme) => ({
		invalidate() {},
		render: (width: number) => [
			truncateToWidth(`${theme.bold(theme.fg("accent", "π"))}${theme.fg("muted", ` v${VERSION} · Run /help for commands`)}`, width),
		],
	}));
}

function footer(pi: ExtensionAPI, ctx: ExtensionContext) {
	ctx.ui.setFooter((tui, theme, data) => {
		const unsub = data.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsub,
			invalidate() {},
			render(width: number): string[] {
				const thinking = pi.getThinkingLevel();
				const pct = ctx.getContextUsage()?.percent;
				const rest = [thinking === "off" ? "" : thinking, pct == null ? "" : `${Math.round(pct)}%`].filter(Boolean);
				const left = theme.fg("text", ctx.model?.id ?? "no model") + theme.fg("muted", rest.map((r) => ` · ${r}`).join(""));
				const right = theme.fg("muted", [...data.getExtensionStatuses().values()].filter(Boolean).join(" · "));
				const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
				return [truncateToWidth(left + " ".repeat(gap) + right, width)];
			},
		};
	});
}

function editor(ctx: ExtensionContext) {
	class FxEditor extends CustomEditor {
		private hiddenAbove = 0;
		private hiddenBelow = 0;

		// Pi resets padding to the editorPaddingX setting; keep two columns for the rail.
		override setPaddingX(padding: number): void {
			super.setPaddingX(Math.max(2, padding));
		}

		// Borders become blank rows; the top one is dropped in render() and handleMouse() compensates.
		protected override renderTopBorder(_width: number, hidden: number): string {
			this.hiddenAbove = hidden;
			return "";
		}

		protected override renderBottomBorder(_width: number, hidden: number): string {
			this.hiddenBelow = hidden;
			return "";
		}

		override render(width: number): string[] {
			const lines = super.render(width);
			const theme = ctx.ui.theme;
			let last = 1;
			while (last < lines.length && lines[last]!.startsWith("  ")) last++;
			for (let i = 1; i < last; i++) {
				const mark = i === 1 && this.hiddenAbove ? "↑" : i === last - 1 && this.hiddenBelow ? "↓" : " ";
				lines[i] = `${theme.fg("accent", RAIL)}${theme.fg("dim", mark)}${lines[i]!.slice(2)}`;
			}
			return lines.slice(1);
		}

		override handleMouse(event: Parameters<CustomEditor["handleMouse"]>[0]) {
			return super.handleMouse({ ...event, y: event.y + 1 });
		}
	}
	ctx.ui.setEditorComponent((tui, theme, keybindings) => new FxEditor(tui, theme, keybindings, { paddingX: 2 }));
}

export default function (pi: ExtensionAPI) {
	registerTools(pi);

	let timer: ReturnType<typeof setInterval> | undefined;
	let started = 0;
	let running = 0;
	let ui: ExtensionContext["ui"] | undefined;
	const stop = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};
	const tick = () => {
		const s = Math.floor((Date.now() - started) / 1000);
		ui?.setWorkingMessage(`${running ? "Running" : "Thinking"} (${s}s)`);
	};

	pi.on("session_start", (_e, ctx) => {
		if (ctx.mode !== "tui") return;
		ui = ctx.ui;
		const current = ctx.ui.theme.name;
		if (current === "dark" || current === "light") {
			// Theme instance (not name) so the user's saved theme setting is left untouched.
			const fx = ctx.ui.getTheme(current === "light" ? "fx-light" : "fx-dark");
			if (fx) ctx.ui.setTheme(fx);
		}
		patchUserMessages(() => ctx.ui.theme);
		ctx.ui.setWorkingIndicator({ frames: ["•"] });
		header(ctx);
		editor(ctx);
		footer(pi, ctx);
	});

	pi.on("agent_start", () => {
		if (!ui) return;
		stop();
		started = Date.now();
		running = 0;
		tick();
		timer = setInterval(tick, 1000);
	});
	pi.on("tool_execution_start", () => {
		running++;
		if (timer) tick();
	});
	pi.on("tool_execution_end", () => {
		running = Math.max(0, running - 1);
		if (timer) tick();
	});
	pi.on("agent_end", stop);
	pi.on("session_shutdown", () => {
		stop();
		patchUserMessages(undefined);
		ui = undefined;
	});
}
