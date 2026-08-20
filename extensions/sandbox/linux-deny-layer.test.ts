import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrokerExecRequest, BrokerFilesystemDeny } from "./broker-client.ts";
import {
	buildLinuxDenyLaunch,
	concreteLinuxDeniesForTest,
} from "./linux-deny-layer.ts";

test("expands workspace denies without following or scanning outside the static root", () => {
	const root = mkdtempSync(join(tmpdir(), "guardian-denies-"));
	try {
		mkdirSync(join(root, "nested"));
		mkdirSync(join(root, ".guardian"));
		writeFileSync(join(root, ".env"), "secret");
		writeFileSync(join(root, "nested", "service.key"), "secret");
		writeFileSync(join(root, "nested", "visible.txt"), "ok");
		const denies: BrokerFilesystemDeny[] = [
			{ access: "read_write", pattern: `${root}/**/.env`, scope: "glob" },
			{ access: "read_write", pattern: `${root}/**/*.key`, scope: "glob" },
			{ access: "write", pattern: join(root, ".guardian"), scope: "tree" },
		];
		const concrete = concreteLinuxDeniesForTest(denies);
		assert.equal(concrete.length, 3);
		assert.ok(concrete.some((deny) => deny.access === "write" && deny.path === join(root, ".guardian") && deny.directory));
		assert.ok(concrete.some((deny) => deny.access === "read_write" && deny.path === join(root, ".env") && !deny.directory));
		assert.ok(concrete.some((deny) => deny.access === "read_write" && deny.path === join(root, "nested", "service.key") && !deny.directory));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("wraps nono with fixed bubblewrap deny mounts", () => {
	const root = mkdtempSync(join(tmpdir(), "guardian-denies-"));
	try {
		const denied = join(root, ".env");
		writeFileSync(denied, "secret");
		const request = {
			cwd: root,
			policy: {
				denies: [{ access: "read_write", pattern: denied, scope: "file" }],
			},
		} as BrokerExecRequest;
		const launch = buildLinuxDenyLaunch(
			"/fixed/bwrap",
			"/fixed/nono",
			["run", "--", "/bin/true"],
			request,
			root,
		);
		assert.equal(launch.program, "/fixed/bwrap");
		assert.deepEqual(launch.args.slice(-7), [
			"--chdir",
			root,
			"--",
			"/fixed/nono",
			"run",
			"--",
			"/bin/true",
		]);
		assert.ok(launch.args.includes(denied));
		assert.ok(launch.args.includes("--ro-bind"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
