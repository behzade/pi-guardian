import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lock = JSON.parse(
	await readFile(new URL("./package-lock.json", import.meta.url), "utf8"),
);

test("registry packages have integrity hashes for Nix importNpmLock", () => {
	const missingIntegrity = Object.entries(lock.packages)
		.filter(
			([, entry]) =>
				typeof entry.resolved === "string" &&
				/^https?:/.test(entry.resolved) &&
				typeof entry.integrity !== "string",
		)
		.map(([name]) => name);

	assert.deepEqual(missingIntegrity, []);
});
