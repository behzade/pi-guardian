import {
	chmodSync,
	existsSync,
	lstatSync,
	readdirSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
	BrokerExecRequest,
	BrokerFilesystemDeny,
} from "./broker-client.ts";

const MAX_GLOB_MATCHES = 8_192;

interface ConcreteDeny {
	access: BrokerFilesystemDeny["access"];
	path: string;
	directory: boolean;
}

export interface LinuxDenyLaunch {
	program: string;
	args: string[];
}

/**
 * Adds only the deny-over-allow behavior Landlock cannot represent. Nono still
 * owns filesystem grants and network policy inside this mount namespace.
 */
export function buildLinuxDenyLaunch(
	bwrapPath: string,
	nonoPath: string,
	nonoArgs: readonly string[],
	request: BrokerExecRequest,
	privateDirectory: string,
): LinuxDenyLaunch {
	const denies = concreteDenies(request.policy.denies);
	const args = [
		"--new-session",
		"--die-with-parent",
		"--unshare-user",
		"--unshare-pid",
		"--unshare-ipc",
		"--unshare-uts",
		"--cap-drop",
		"ALL",
		"--bind",
		"/",
		"/",
		"--dev",
		"/dev",
		"--proc",
		"/proc",
	];
	let hiddenFile: string | undefined;
	for (const deny of denies) {
		if (deny.access === "write") {
			args.push("--ro-bind", deny.path, deny.path);
			continue;
		}
		if (deny.directory) {
			args.push(
				"--perms",
				"000",
				"--tmpfs",
				deny.path,
				"--remount-ro",
				deny.path,
			);
			continue;
		}
		if (!hiddenFile) {
			hiddenFile = join(privateDirectory, "denied-file");
			writeFileSync(hiddenFile, "", { mode: 0o000, flag: "wx" });
			chmodSync(hiddenFile, 0o000);
		}
		args.push("--ro-bind", hiddenFile, deny.path);
	}
	args.push("--chdir", request.cwd, "--", nonoPath, ...nonoArgs);
	return { program: bwrapPath, args };
}

export function concreteLinuxDeniesForTest(
	denies: readonly BrokerFilesystemDeny[],
): Array<{ access: string; path: string; directory: boolean }> {
	return concreteDenies(denies);
}

function concreteDenies(denies: readonly BrokerFilesystemDeny[]): ConcreteDeny[] {
	const merged = new Map<string, ConcreteDeny>();
	for (const deny of denies) {
		const paths = deny.scope === "glob" ? expandGlob(deny.pattern) : [deny.pattern];
		for (const lexicalPath of paths) {
			if (!existsSync(lexicalPath)) continue;
			const metadata = lstatSync(lexicalPath);
			const path = metadata.isSymbolicLink() ? realpathSync(lexicalPath) : resolve(lexicalPath);
			const directory = statSync(path).isDirectory();
			const current = merged.get(path);
			merged.set(path, {
				path,
				directory,
				access: current ? mergeAccess(current.access, deny.access) : deny.access,
			});
			if (merged.size > MAX_GLOB_MATCHES) {
				throw new Error(`Linux deny policy matched more than ${MAX_GLOB_MATCHES} paths`);
			}
		}
	}
	return removeRedundantDenies([...merged.values()]);
}

function expandGlob(pattern: string): string[] {
	if (!pattern.startsWith("/")) throw new Error(`Linux deny glob must be absolute: ${pattern}`);
	const firstGlob = pattern.search(/[?*[]/);
	if (firstGlob < 0) return existsSync(pattern) ? [pattern] : [];
	const prefix = pattern.slice(0, firstGlob);
	const root = prefix.endsWith("/")
		? prefix.slice(0, -1) || "/"
		: dirname(prefix);
	if (root === "/") {
		throw new Error(`Linux deny glob cannot require a root filesystem scan: ${pattern}`);
	}
	if (!existsSync(root)) return [];
	const matcher = globRegex(pattern);
	const matches: string[] = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop() as string;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (matcher.test(path)) {
				matches.push(path);
				if (matches.length > MAX_GLOB_MATCHES) {
					throw new Error(`Linux deny glob matched more than ${MAX_GLOB_MATCHES} paths: ${pattern}`);
				}
			}
			if (entry.isDirectory()) pending.push(path);
		}
	}
	return matches;
}

function globRegex(pattern: string): RegExp {
	let source = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "*" && pattern[index + 1] === "*") {
			index += 1;
			if (pattern[index + 1] === "/") {
				index += 1;
				source += "(?:.*/)?";
			} else source += ".*";
		} else if (character === "*") source += "[^/]*";
		else if (character === "?") source += "[^/]";
		else if (character === "[") throw new Error("Linux deny glob character classes are unsupported");
		else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
	}
	return new RegExp(`${source}$`);
}

function mergeAccess(
	left: BrokerFilesystemDeny["access"],
	right: BrokerFilesystemDeny["access"],
): BrokerFilesystemDeny["access"] {
	return left === right ? left : "read_write";
}

function removeRedundantDenies(denies: ConcreteDeny[]): ConcreteDeny[] {
	const ordered = denies.sort((left, right) =>
		left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path));
	return ordered.filter((deny, index) => !ordered.slice(0, index).some((parent) =>
		parent.directory &&
		deny.path.startsWith(`${parent.path}/`) &&
		(parent.access !== "write" || deny.access === "write"),
	));
}
