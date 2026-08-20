import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { BrokerExecRequest } from "./broker-client.ts";
import { buildNonoProfile } from "./nono-client.ts";

function request(network: BrokerExecRequest["policy"]["network"]): BrokerExecRequest {
	return {
		type: "exec",
		id: "test",
		command: { program: "/bin/sh", args: ["-c", "true"] },
		cwd: "/work",
		env: { PATH: "/bin", HOME: "/home/test" },
		timeout_ms: null,
		policy: {
			base_rights: [
				{ access: "read", path: "/work", scope: "tree", missing_path: "reject" },
				{ access: "write", path: "/work", scope: "tree", missing_path: "reject" },
			],
			grants: [
				{ access: "read", path: "/outside/input.txt", scope: "file", missing_path: "reject" },
			],
			denies: [],
			network,
			unix_socket_roots: [],
			output_limit_bytes: 1024,
		},
	};
}

test("profile maps exact filesystem scopes and blocks network by default", () => {
	const profile = buildNonoProfile(request({ mode: "blocked" })) as {
		filesystem: Record<string, string[]>;
		network: { block: boolean; allow_domain: string[] };
	};
	assert.deepEqual(profile.filesystem.allow, ["/work"]);
	assert.deepEqual(profile.filesystem.read, existsSync("/nix/store") ? ["/nix/store", "/work"] : ["/work"]);
	assert.deepEqual(profile.filesystem.read_file, ["/outside/input.txt"]);
	assert.equal(profile.network.block, true);
	assert.deepEqual(profile.network.allow_domain, []);
});

test("Linux delegates overlapping denies to the mount layer while macOS keeps Seatbelt denies", () => {
	const value = request({ mode: "blocked" });
	value.policy.denies = [{ access: "read_write", pattern: "/work/.env", scope: "file" }];
	const linux = buildNonoProfile(value, "linux") as { filesystem: { deny: string[] } };
	const macos = buildNonoProfile(value, "darwin") as { filesystem: { deny: string[] } };
	assert.deepEqual(linux.filesystem.deny, []);
	assert.deepEqual(macos.filesystem.deny, ["/work/.env"]);
});

test("profile maps exact hosts without enabling unrestricted network", () => {
	const profile = buildNonoProfile(request({
		mode: "proxy",
		tcp_port: 1,
		unix_socket: "/unused",
		allow_local_binding: false,
		allowed_hosts: ["api.example.com", "192.0.2.1"],
	})) as { network: { block: boolean; allow_domain: string[] } };
	assert.equal(profile.network.block, false);
	assert.deepEqual(profile.network.allow_domain, ["api.example.com", "192.0.2.1"]);
});

test("Linux local network maps to the complete localhost port range", {
	skip: process.platform !== "linux",
}, () => {
	const profile = buildNonoProfile(request({ mode: "loopback" })) as {
		network: { open_port: number[]; open_port_range: number[][] };
	};
	assert.deepEqual(profile.network.open_port, [0]);
	assert.deepEqual(profile.network.open_port_range, [[1, 65_535]]);
});
