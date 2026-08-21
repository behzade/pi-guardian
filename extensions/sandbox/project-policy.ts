import { existsSync, lstatSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { NativeSandboxConfig } from "./sandbox-config.ts";
import { normalizeDevelopmentCacheConfig } from "./development-caches.ts";
import {
	canonicalize,
	gitControlRoot,
	isControlRootSymlink,
	isInside,
	isProtectedPath,
	isProtectedWritePath,
	normalizeNetworkHost,
	projectControlRoot,
	type IoPermission,
} from "./io-permissions.ts";
import { isDeniedByConfig } from "./io-policy.ts";
import { networkRuleMatches } from "./network-policy.ts";
import {
	projectPolicyPath,
	readProjectPolicySource,
	writeProjectPolicySource,
} from "./project-policy-store.ts";
export { projectPolicyPath } from "./project-policy-store.ts";

export type ProjectAccessRight =
	| {
			kind: "filesystem";
			access: "read" | "write";
			path: string;
			scope: "file" | "tree";
	  }
	| { kind: "network_host"; host: string }
	| { kind: "network_endpoint"; host: string; port: number };

export type ProjectAccessRequest = ProjectAccessRight | { kind: "development_cache"; environment: Record<string, string> };

export interface ProjectSandboxPolicy {
	version: 1;
	rights: ProjectAccessRight[];
	developmentCache?: { environment: Record<string, string> };
}

export interface ActiveProjectPolicy {
	policy: ProjectSandboxPolicy;
	filesystem: IoPermission[];
	networkHosts: string[];
	localPorts: number[];
	config: NativeSandboxConfig;
	/** Exact file bytes loaded or written by the trusted host; null means absent. */
	sourceText: string | null;
}
export const EMPTY_PROJECT_POLICY: ProjectSandboxPolicy = { version: 1, rights: [] };

export function loadProjectPolicy(
	cwd: string,
	globalConfig: NativeSandboxConfig,
): ActiveProjectPolicy {
	const sourceText = readProjectPolicySource(cwd);
	const policy = sourceText === null
		? structuredClone(EMPTY_PROJECT_POLICY)
		: normalizeProjectPolicy(JSON.parse(sourceText));
	return activateProjectPolicy(policy, cwd, globalConfig, sourceText);
}

export function loadProjectPolicyForUpdate(
	cwd: string,
	globalConfig: NativeSandboxConfig,
): ActiveProjectPolicy {
	// Callers synchronize this fresh project snapshot before preparing an
	// approval; the conditional save below still rejects edits made meanwhile.
	return loadProjectPolicy(cwd, globalConfig);
}

export function activateProjectPolicy(
	policy: ProjectSandboxPolicy,
	cwd: string,
	globalConfig: NativeSandboxConfig,
	sourceText: string | null = null,
): ActiveProjectPolicy {
	return activateAccessPolicy(policy, cwd, globalConfig, sourceText, false);
}

/** Activates a session/effective policy, which may contain host-specific absolute paths. */
export function activateSessionPolicy(
	policy: ProjectSandboxPolicy,
	cwd: string,
	globalConfig: NativeSandboxConfig,
	sourceText: string | null = null,
): ActiveProjectPolicy {
	return activateAccessPolicy(policy, cwd, globalConfig, sourceText, true);
}

function activateAccessPolicy(
	policy: ProjectSandboxPolicy,
	cwd: string,
	globalConfig: NativeSandboxConfig,
	sourceText: string | null,
	allowAbsolutePaths: boolean,
): ActiveProjectPolicy {
	const normalized = normalizeAccessPolicy(policy, allowAbsolutePaths);
	const config = withProjectCacheEnvironment(globalConfig, normalized);
	const filesystem: IoPermission[] = [];
	const networkHosts = new Set<string>();
	const localPorts = new Set<number>();
	for (const right of normalized.rights) {
		if (right.kind === "network_endpoint") {
			if (config.network?.enabled === false) {
				throw new Error(`${right.host}:${right.port} is denied because network access is disabled by machine policy`);
			}
			if ((config.network?.deniedDomains ?? []).some((rule) => networkRuleMatches(rule, right.host))) {
				throw new Error(`${right.host}:${right.port} is denied by the machine sandbox policy`);
			}
			localPorts.add(right.port);
			continue;
		}
		if (right.kind === "network_host") {
			if (config.network?.enabled === false) {
				throw new Error(`${right.host} is denied because network access is disabled by machine policy`);
			}
			if ((config.network?.deniedDomains ?? []).some((rule) => networkRuleMatches(rule, right.host))) {
				throw new Error(`${right.host} is denied by the machine sandbox policy`);
			}
			networkHosts.add(right.host);
			continue;
		}
		filesystem.push(activateFilesystemRight(right, cwd, config));
	}
	return {
		policy: normalized,
		filesystem,
		networkHosts: [...networkHosts].sort(),
		localPorts: [...localPorts].sort((left, right) => left - right),
		config,
		sourceText,
	};
}

export function addProjectAccess(
	current: ProjectSandboxPolicy,
	requests: readonly ProjectAccessRequest[],
	cwd: string,
	globalConfig: NativeSandboxConfig,
): ActiveProjectPolicy {
	return addAccess(current, requests, cwd, globalConfig, false);
}

export function addSessionAccess(
	current: ProjectSandboxPolicy,
	requests: readonly ProjectAccessRequest[],
	cwd: string,
	globalConfig: NativeSandboxConfig,
): ActiveProjectPolicy {
	return addAccess(current, requests, cwd, globalConfig, true);
}

function addAccess(
	current: ProjectSandboxPolicy,
	requests: readonly ProjectAccessRequest[],
	cwd: string,
	globalConfig: NativeSandboxConfig,
	allowAbsolutePaths: boolean,
): ActiveProjectPolicy {
	if (requests.length === 0) throw new Error("request_access needs at least one access request");
	if (requests.length > 32) throw new Error("request_access accepts at most 32 access requests");

	const requestedRights: ProjectAccessRight[] = [];
	const requestedEnvironment: Record<string, string> = {};
	for (const request of requests) {
		if (request.kind === "development_cache") {
			const entries = Object.entries(request.environment);
			if (entries.length === 0 || entries.length > 16) {
				throw new Error("Each development_cache request must contain 1 to 16 environment mappings");
			}
			if (entries.some(([name]) => name.length > 64)) {
				throw new Error("Development cache environment names must be at most 64 characters");
			}
			if (entries.some(([, target]) => typeof target === "string" && target.length > 256)) {
				throw new Error("Development cache targets must be at most 256 characters");
			}
			const cache = normalizeDevelopmentCacheConfig({ environment: request.environment });
			for (const [name, target] of Object.entries(cache?.environment ?? {})) {
				const managed = globalConfig.developmentCache?.environment?.[name];
				if (managed !== undefined) {
					if (managed !== target) {
						throw new Error(`request_access cannot replace managed cache mapping ${name}`);
					}
					continue;
				}
				const existing = current.developmentCache?.environment[name];
				if (existing !== undefined && existing !== target) {
					throw new Error(`request_access cannot replace existing project cache mapping ${name}`);
				}
				requestedEnvironment[name] = target;
			}
			if (Object.keys(requestedEnvironment).length > 32) {
				throw new Error("request_access accepts at most 32 net development-cache mappings");
			}
			continue;
		}
		requestedRights.push(normalizeRequestedRight(request, cwd, allowAbsolutePaths));
	}

	const currentNormalized = normalizeAccessPolicy(current, allowAbsolutePaths);
	const currentKeys = new Set(currentNormalized.rights.map(rightKey));
	const uniqueRequestedRights = [...new Map(
		requestedRights.map((right) => [rightKey(right), right]),
	).values()];
	const netNewRights = uniqueRequestedRights.filter((right) => !currentKeys.has(rightKey(right)));
	assertNoGiantSiblingFileList(netNewRights);
	const environment = {
		...(currentNormalized.developmentCache?.environment ?? {}),
		...requestedEnvironment,
	};
	const candidate = normalizeAccessPolicy({
		...currentNormalized,
		rights: [...currentNormalized.rights, ...netNewRights],
		...(Object.keys(environment).length > 0
			? { developmentCache: { environment } }
			: {}),
	}, allowAbsolutePaths);
	return allowAbsolutePaths
		? activateSessionPolicy(candidate, cwd, globalConfig)
		: activateProjectPolicy(candidate, cwd, globalConfig);
}

export function addProjectRights(
	current: ProjectSandboxPolicy,
	rights: readonly ProjectAccessRight[],
	cwd: string,
	globalConfig: NativeSandboxConfig,
): ActiveProjectPolicy {
	return addProjectAccess(current, rights, cwd, globalConfig);
}

export function requestsRequireSessionScope(
	requests: readonly ProjectAccessRequest[],
	cwd: string,
): boolean {
	const workspace = resolve(cwd);
	const home = resolve(homedir());
	return requests.some((request) => {
		if (request.kind !== "filesystem" || !isAbsolute(request.path)) return false;
		const absolute = resolve(request.path);
		return !isInside(workspace, absolute) && !isInside(home, absolute);
	});
}

/** Trusted host write used only after the user approves the displayed additions. */
export function saveProjectPolicy(
	cwd: string,
	policy: ProjectSandboxPolicy,
	expectedSourceText?: string | null,
): string {
	const sourceText = serializeProjectPolicy(policy);
	writeProjectPolicySource(cwd, sourceText, expectedSourceText);
	return sourceText;
}

export function serializeProjectPolicy(policy: ProjectSandboxPolicy): string {
	return `${JSON.stringify(normalizeProjectPolicy(policy), null, 2)}\n`;
}

export function sameProjectPolicy(
	left: ProjectSandboxPolicy,
	right: ProjectSandboxPolicy,
): boolean {
	return JSON.stringify(normalizeSessionPolicy(left)) === JSON.stringify(normalizeSessionPolicy(right));
}

export function mergeAccessPolicies(
	...policies: readonly ProjectSandboxPolicy[]
): ProjectSandboxPolicy {
	const rights: ProjectAccessRight[] = [];
	const environment: Record<string, string> = {};
	for (const policy of policies) {
		const normalized = normalizeSessionPolicy(policy);
		rights.push(...normalized.rights);
		for (const [name, target] of Object.entries(normalized.developmentCache?.environment ?? {})) {
			const existing = environment[name];
			if (existing !== undefined && existing !== target) {
				throw new Error(`Sandbox access policies contain conflicting development-cache mapping ${name}`);
			}
			environment[name] = target;
		}
	}
	return normalizeSessionPolicy({
		version: 1,
		rights,
		...(Object.keys(environment).length > 0 ? { developmentCache: { environment } } : {}),
	});
}

export function accessPolicyAdditions(
	before: ProjectSandboxPolicy,
	after: ProjectSandboxPolicy,
): ProjectSandboxPolicy {
	const beforeNormalized = normalizeSessionPolicy(before);
	const afterNormalized = normalizeSessionPolicy(after);
	const beforeRights = new Set(beforeNormalized.rights.map(rightKey));
	const rights = afterNormalized.rights.filter((right) => !beforeRights.has(rightKey(right)));
	const previousEnvironment = beforeNormalized.developmentCache?.environment ?? {};
	const environment = Object.fromEntries(
		Object.entries(afterNormalized.developmentCache?.environment ?? {})
			.filter(([name, target]) => previousEnvironment[name] !== target),
	);
	return normalizeSessionPolicy({
		version: 1,
		rights,
		...(Object.keys(environment).length > 0 ? { developmentCache: { environment } } : {}),
	});
}

/** Renders only bounded, semantic net-new entries that approval will add. */
export function projectPolicyDiff(
	before: ProjectSandboxPolicy,
	after: ProjectSandboxPolicy,
	cwd: string,
): string {
	return sandboxPolicyDiff(before, after, `Project policy additions: ${projectPolicyPath(cwd)}`);
}

export function sandboxPolicyDiff(
	before: ProjectSandboxPolicy,
	after: ProjectSandboxPolicy,
	heading: string,
): string {
	return sandboxPolicySummary(accessPolicyAdditions(before, after), heading);
}

export function sandboxPolicySummary(
	additions: ProjectSandboxPolicy,
	heading = "Requested sandbox rights:",
): string {
	const lines = additions.rights.map((right) => {
		if (right.kind === "filesystem") {
			return `  ${right.access.padEnd(8)}${(right.scope === "tree" ? "directory" : "file").padEnd(11)}${JSON.stringify(right.path)}`;
		}
		if (right.kind === "network_host") {
			return `  ${"network".padEnd(8)}${"host".padEnd(11)}${JSON.stringify(right.host)}`;
		}
		return `  ${"network".padEnd(8)}${"endpoint".padEnd(11)}${JSON.stringify(`${right.host}:${right.port}`)}`;
	});
	for (const [name, target] of Object.entries(additions.developmentCache?.environment ?? {})) {
		lines.push(`  ${"cache".padEnd(8)}${name}  ${JSON.stringify(target)}`);
	}
	return [heading, ...lines].join("\n");
}

export function normalizeProjectPolicy(value: unknown): ProjectSandboxPolicy {
	return normalizeAccessPolicy(value, false);
}

export function normalizeSessionPolicy(value: unknown): ProjectSandboxPolicy {
	return normalizeAccessPolicy(value, true);
}

function normalizeAccessPolicy(value: unknown, allowAbsolutePaths: boolean): ProjectSandboxPolicy {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("project sandbox policy must be a JSON object");
	}
	const input = value as Record<string, unknown>;
	assertKnownKeys(input, ["version", "rights", "developmentCache"], "project sandbox policy");
	if (input.version !== 1) throw new Error("project sandbox policy version must be 1");
	if (!Array.isArray(input.rights)) throw new Error("project sandbox policy rights must be an array");
	if (input.rights.length > 256) throw new Error("project sandbox policy accepts at most 256 rights");
	const rights = input.rights.map((right) => normalizeRight(right, allowAbsolutePaths));
	const uniqueRights = [...new Map(rights.map((right) => [rightKey(right), right])).values()]
		.sort((left, right) => rightKey(left).localeCompare(rightKey(right)));
	if (uniqueRights.filter((right) => right.kind === "filesystem").length > 64) {
		throw new Error("Project policy accepts at most 64 filesystem rights; use tree rights instead of file lists");
	}
	let developmentCache: ProjectSandboxPolicy["developmentCache"];
	if (input.developmentCache !== undefined) {
		if (!input.developmentCache || typeof input.developmentCache !== "object" || Array.isArray(input.developmentCache)) {
			throw new Error("developmentCache must be a JSON object");
		}
		const cache = input.developmentCache as Record<string, unknown>;
		assertKnownKeys(cache, ["environment"], "developmentCache");
		const normalized = normalizeDevelopmentCacheConfig({ environment: cache.environment });
		const environment = Object.fromEntries(
			Object.entries(normalized?.environment ?? {})
				.sort(([left], [right]) => left.localeCompare(right)),
		);
		if (Object.keys(environment).length > 128) {
			throw new Error("Project policy accepts at most 128 development-cache mappings");
		}
		if (Object.keys(environment).some((name) => name.length > 64)) {
			throw new Error("Project development-cache environment names must be at most 64 characters");
		}
		if (Object.values(environment).some((target) => target.length > 256)) {
			throw new Error("Project development-cache targets must be at most 256 characters");
		}
		if (Object.keys(environment).length > 0) {
			developmentCache = { environment };
		}
	}
	return {
		version: 1,
		rights: uniqueRights,
		...(developmentCache ? { developmentCache } : {}),
	};
}

function normalizeRequestedRight(
	right: ProjectAccessRight,
	cwd: string,
	allowAbsolutePaths: boolean,
): ProjectAccessRight {
	if (right.kind !== "filesystem") return normalizeRight(right, allowAbsolutePaths);
	return normalizeRight({
		...right,
		path: portableRequestPath(right.path, cwd, allowAbsolutePaths),
	}, allowAbsolutePaths);
}

function normalizeRight(value: unknown, allowAbsolutePaths = false): ProjectAccessRight {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("each project sandbox right must be a JSON object");
	}
	const right = value as Record<string, unknown>;
	if (right.kind === "filesystem") {
		assertKnownKeys(right, ["kind", "access", "path", "scope"], "filesystem right");
		if (right.access !== "read" && right.access !== "write") {
			throw new Error("filesystem access must be read or write");
		}
		if (right.scope !== "file" && right.scope !== "tree") {
			throw new Error("filesystem scope must be file or tree");
		}
		return {
			kind: "filesystem",
			access: right.access,
			path: normalizeFilesystemPath(right.path, allowAbsolutePaths),
			scope: right.scope,
		};
	}
	if (right.kind === "network_host") {
		assertKnownKeys(right, ["kind", "host"], "network_host right");
		if (typeof right.host !== "string") throw new Error("network_host host must be a string");
		return { kind: "network_host", host: normalizeNetworkHost(right.host) };
	}
	if (right.kind === "network_endpoint") {
		assertKnownKeys(right, ["kind", "host", "port"], "network_endpoint right");
		if (typeof right.host !== "string") throw new Error("network_endpoint host must be a string");
		const host = normalizeNetworkHost(right.host);
		if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
			throw new Error("network_endpoint host must be localhost, 127.0.0.1, or ::1");
		}
		if (!Number.isInteger(right.port) || (right.port as number) < 1 || (right.port as number) > 65_535) {
			throw new Error("network_endpoint port must be an integer from 1 to 65535");
		}
		return { kind: "network_endpoint", host: "localhost", port: right.port as number };
	}
	throw new Error("project sandbox right kind must be filesystem, network_host, or network_endpoint");
}

function activateFilesystemRight(
	right: Extract<ProjectAccessRight, { kind: "filesystem" }>,
	cwd: string,
	config: NativeSandboxConfig,
): IoPermission {
	const lexical = expandPortablePath(right.path, cwd);
	assertNoExistingSymlink(right.path, cwd);
	const actual = canonicalize(lexical);
	const projectRoot = right.access === "write" ? projectControlRoot(lexical, cwd) : undefined;
	if (projectRoot) {
		throw new Error(`Project policy cannot grant sandboxed writes to project ${projectRoot.endsWith(".guardian") ? ".guardian" : ".pi"}`);
	}
	const gitRoot = right.access === "write" ? gitControlRoot(lexical, cwd) : undefined;
	const explicitGitRoot = gitRoot !== undefined && actual === canonicalize(gitRoot);
	if (
		isProtectedPath(lexical) ||
		(right.access === "write" && isProtectedWritePath(lexical)) ||
		(isDeniedByConfig(actual, right.access, config, cwd) && !explicitGitRoot)
	) {
		throw new Error(`Project policy cannot grant protected or machine-denied ${right.access} access: ${right.path}`);
	}
	if (!existsSync(actual) && right.access === "read") {
		throw new Error(`Project policy read rights must target an existing path: ${right.path}`);
	}
	if (existsSync(actual)) {
		const directory = statSync(actual).isDirectory();
		if ((right.scope === "tree") !== directory) {
			throw new Error(`Project policy ${right.scope} scope does not match the existing path type: ${right.path}`);
		}
	}
	if (right.access === "write") {
		if (gitRoot && isControlRootSymlink(gitRoot)) {
			throw new Error(`Project policy cannot grant a symlinked control root: ${gitRoot}`);
		}
	}
	return { kind: right.access, path: actual, directory: right.scope === "tree" };
}

function withProjectCacheEnvironment(
	globalConfig: NativeSandboxConfig,
	policy: ProjectSandboxPolicy,
): NativeSandboxConfig {
	const base = globalConfig.developmentCache?.environment ?? {};
	const additions = policy.developmentCache?.environment ?? {};
	for (const [name, target] of Object.entries(additions)) {
		if (base[name] !== undefined && base[name] !== target) {
			throw new Error(`Project developmentCache.environment cannot replace managed mapping ${name}`);
		}
	}
	return {
		...globalConfig,
		developmentCache: {
			...globalConfig.developmentCache,
			environment: { ...base, ...additions },
		},
	};
}

function portableRequestPath(value: unknown, cwd: string, allowAbsolutePaths: boolean): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
		throw new Error("filesystem path must be a non-empty portable path");
	}
	if (value.length > 1024) throw new Error("filesystem paths must be at most 1024 characters");
	if (!isAbsolute(value)) return normalizePortablePath(value);
	const absolute = resolve(value);
	const workspace = resolve(cwd);
	if (isInside(workspace, absolute)) {
		const path = relative(workspace, absolute);
		return path || ".";
	}
	const home = resolve(homedir());
	if (isInside(home, absolute)) {
		const path = relative(home, absolute);
		return path ? `~/${path}` : "~";
	}
	if (allowAbsolutePaths) return absolute;
	throw new Error("Absolute filesystem request paths must be inside the project or home directory");
}

function normalizeFilesystemPath(value: unknown, allowAbsolutePaths: boolean): string {
	if (allowAbsolutePaths && typeof value === "string" && isAbsolute(value)) {
		if (value.length === 0 || value.includes("\0")) {
			throw new Error("filesystem path must be a non-empty path");
		}
		if (value.length > 1024) throw new Error("filesystem paths must be at most 1024 characters");
		return resolve(value);
	}
	return normalizePortablePath(value);
}

function normalizePortablePath(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
		throw new Error("filesystem path must be a non-empty portable path");
	}
	if (value.length > 1024) throw new Error("filesystem paths must be at most 1024 characters");
	if (isAbsolute(value)) {
		throw new Error("Checked-in filesystem paths must be project-relative or home-relative (~/)");
	}
	if (value === "~") return value;
	const homeRelative = value.startsWith("~/");
	const body = homeRelative ? value.slice(2) : value;
	const normalized = normalize(body);
	if (
		isAbsolute(body) ||
		normalized === ".." ||
		normalized.startsWith(`..${sep}`)
	) {
		throw new Error(
			homeRelative
				? "home-relative filesystem paths cannot escape the home directory"
				: "relative filesystem paths cannot escape the project root",
		);
	}
	return homeRelative ? `~/${normalized}` : normalized;
}

function expandPortablePath(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	if (isAbsolute(path)) return resolve(path);
	return resolve(cwd, path);
}

function assertNoExistingSymlink(path: string, cwd: string): void {
	const root = isAbsolute(path)
		? resolve(path).split(sep)[0] || sep
		: path === "~" || path.startsWith("~/")
			? resolve(homedir())
			: resolve(cwd);
	const target = expandPortablePath(path, cwd);
	const rel = relative(root, target);
	let current = root;
	for (const part of rel === "" ? [] : rel.split(sep)) {
		current = resolve(current, part);
		const metadata = lstatIfExists(current);
		if (!metadata) break;
		if (metadata.isSymbolicLink()) {
			throw new Error(`Project filesystem rights cannot cross an existing symlink: ${current}`);
		}
	}
}

function assertNoGiantSiblingFileList(rights: readonly ProjectAccessRight[]): void {
	const groups = new Map<string, number>();
	for (const right of rights) {
		if (right.kind !== "filesystem" || right.scope !== "file") continue;
		const key = `${right.access}:${dirname(right.path)}`;
		groups.set(key, (groups.get(key) ?? 0) + 1);
	}
	for (const [key, count] of groups) {
		if (count > 3) {
			throw new Error(`Rejecting ${count} new sibling file rights under ${key.slice(key.indexOf(":") + 1)}; request one tree right instead`);
		}
	}
}

function lstatIfExists(path: string): ReturnType<typeof lstatSync> | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

function rightKey(right: ProjectAccessRight): string {
	return JSON.stringify(right);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) throw new Error(`${field} contains unknown fields: ${unknown.join(", ")}`);
}
