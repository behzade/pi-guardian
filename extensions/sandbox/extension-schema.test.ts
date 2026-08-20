import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSandbox from "./index.ts";
import { BackgroundJobParams, validateBackgroundJobParams } from "./tool-schemas.ts";

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("./tool-schemas.ts", import.meta.url), "utf8");

test("background jobs expose a provider-compatible object schema", () => {
	const schema = BackgroundJobParams as {
		type?: unknown;
		anyOf?: unknown;
		properties?: { action?: { anyOf?: Array<{ type?: unknown }> } };
	};
	assert.equal(schema.type, "object");
	assert.equal(schema.anyOf, undefined);
	assert.ok(schema.properties?.action?.anyOf?.length);
	assert.ok(schema.properties?.action?.anyOf?.every((variant) => variant.type === "string"));
});

test("background jobs validate action-specific required fields before execution", () => {
	assert.equal(validateBackgroundJobParams({ action: "start", name: "pi-test" }), "Background job action start requires command.");
	assert.equal(validateBackgroundJobParams({ action: "read" }), "Background job action read requires name.");
	assert.equal(validateBackgroundJobParams({ action: "keys", name: "pi-test" }), "Background job action keys requires keys.");
	assert.deepEqual(
		validateBackgroundJobParams({ action: "start", name: "pi-test", command: "sleep 1" }),
		{ action: "start", name: "pi-test", command: "sleep 1" },
	);
});

test("bash and background jobs cannot request per-command permissions", () => {
	const bashStart = schemaSource.indexOf("export const BashParams");
	const backgroundStart = schemaSource.indexOf("export const BackgroundJobParams");
	const bashSchema = schemaSource.slice(bashStart, backgroundStart);
	const backgroundSchema = schemaSource.slice(backgroundStart);
	assert.doesNotMatch(bashSchema, /permissions/);
	assert.doesNotMatch(backgroundSchema, /permissions/);
});

test("request_access owns every durable access request variant", () => {
	const requestStart = schemaSource.indexOf("const AccessRightParams");
	const bashStart = schemaSource.indexOf("export const BashParams", requestStart);
	const schema = schemaSource.slice(requestStart, bashStart);
	assert.match(schema, /Type\.Literal\("filesystem"\)/);
	assert.match(schema, /Type\.Literal\("network_host"\)/);
	assert.match(schema, /Type\.Literal\("network_endpoint"\)/);
	assert.match(schema, /minimum: 1, maximum: 65_535/);
	assert.match(schema, /Type\.Literal\("development_cache"\)/);
	assert.match(indexSource, /name: "request_access"/);
	assert.doesNotMatch(indexSource, /name: "request_network_permission"/);
});

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
