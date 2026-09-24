import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import fxUi from "../index.ts";

const piIndex = import.meta.resolve("@earendil-works/pi-coding-agent");
const builtinDark = JSON.parse(readFileSync(new URL("modes/interactive/theme/dark.json", piIndex), "utf8"));

for (const name of ["fx-dark", "fx-light"]) {
	test(`${name} defines every built-in color and resolves its variables`, () => {
		const theme = JSON.parse(readFileSync(new URL(`../themes/${name}.json`, import.meta.url), "utf8"));
		assert.equal(theme.name, name);
		assert.deepEqual(Object.keys(theme.colors).sort(), Object.keys(builtinDark.colors).sort());
		for (const [key, value] of Object.entries(theme.colors)) {
			if (typeof value === "string" && value !== "" && !value.startsWith("#")) {
				assert.ok(value in theme.vars, `${key} references missing var ${value}`);
			}
		}
	});
}

test("overrides the default tools with fx rows", () => {
	initTheme("dark");
	const tools = new Map<string, ToolDefinition>();
	fxUi({ registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool), on() {} } as unknown as ExtensionAPI);
	assert.deepEqual([...tools.keys()].sort(), ["bash", "edit", "read", "write"]);

	const theme = { fg: (_color: string, s: string) => s, bold: (s: string) => s } as never;
	const done = { isPartial: false, isError: false, expanded: false, cwd: "/repo" };
	const plain = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).join("\n");

	const bash = tools.get("bash")!;
	const call = bash.renderCall!({ command: "ls\necho hi" }, theme, { ...done, args: {} } as never);
	assert.equal(plain(call.render(80)), "● Ran ls …");
	const out = bash.renderResult!({ content: [{ type: "text", text: "a\nb" }], details: undefined }, done, theme, done as never);
	assert.equal(plain(out.render(80)), "└ a\n  b");

	const edit = tools.get("edit")!;
	const result = { content: [], details: { diff: " 1 hello\n-2 world\n+2 fx", patch: "" } };
	const rendered = plain(edit.renderResult!(result, done, theme, { ...done, args: { path: "/repo/a.txt" } } as never).render(80));
	assert.match(rendered, /^● Edited a\.txt \+1 \/ -1\n└ /);
});
