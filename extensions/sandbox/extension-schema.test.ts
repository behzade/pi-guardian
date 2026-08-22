import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSandbox from "./index.ts";

test("disabled sandbox does not intercept built-in file tools", async () => {
	let sessionStart: ((event: unknown, context: unknown) => Promise<unknown>) | undefined;
	let toolCall: ((event: unknown, context: unknown) => Promise<unknown>) | undefined;
	const pi = {
		registerFlag() {},
		getFlag() { return true; },
		registerTool() {},
		registerCommand() {},
		on(event: string, handler: (event: unknown, context: unknown) => Promise<unknown>) {
			if (event === "session_start") sessionStart = handler;
			if (event === "tool_call") toolCall = handler;
		},
		events: { emit() {} },
	} as unknown as ExtensionAPI;
	registerSandbox(pi);
	const context = {
		hasUI: false,
		sessionManager: { getSessionFile: () => undefined },
		ui: { notify() {} },
	};
	assert(sessionStart && toolCall);
	await sessionStart({ reason: "startup" }, context);
	assert.equal(
		await toolCall({ toolName: "write", input: { path: "/outside/file" } }, context),
		undefined,
	);
});
