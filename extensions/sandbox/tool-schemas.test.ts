import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BackgroundJobParams, validateBackgroundJobParams } from "./tool-schemas.ts";

const accessRequestSource = readFileSync(new URL("./access-request.ts", import.meta.url), "utf8");
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
	assert.match(accessRequestSource, /name: "request_access"/);
	assert.doesNotMatch(accessRequestSource, /name: "request_network_permission"/);
});
