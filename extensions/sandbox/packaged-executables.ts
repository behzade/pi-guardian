import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";

const NATIVE_VERSION = "3.0.0";
const require = createRequire(import.meta.url);

interface NativePackage {
	name: string;
	nonoPath: string;
	bwrapPath: string;
}

const NATIVE_PACKAGES: Record<string, NativePackage> = {
	"darwin:arm64": {
		name: "pi-extension-sandbox-darwin-arm64",
		nonoPath: "bin/nono",
		bwrapPath: "",
	},
	"linux:x64": {
		name: "pi-extension-sandbox-linux-x64",
		nonoPath: "bin/nono",
		bwrapPath: "bin/bwrap",
	},
};

type ResolveManifest = (specifier: string) => string;

export interface PackagedExecutables {
	nonoPath: string;
	bwrapPath: string;
	packageName: string;
}

/** Resolves only fixed files from the exact platform package; never searches PATH. */
export function resolvePackagedExecutables(
	platform = process.platform,
	arch = process.arch,
	resolveManifest: ResolveManifest = (specifier) => require.resolve(specifier),
): PackagedExecutables {
	const selected = NATIVE_PACKAGES[`${platform}:${arch}`];
	if (!selected) {
		throw new Error(`Guardian npm packages do not support ${platform}/${arch}`);
	}

	let manifestPath: string;
	try {
		manifestPath = realpathSync(resolveManifest(`${selected.name}/package.json`));
	} catch (error) {
		throw new Error(
			`Guardian native package ${selected.name}@${NATIVE_VERSION} is missing`,
			{ cause: error },
		);
	}
	const manifest = parseManifest(manifestPath);
	if (manifest.name !== selected.name || manifest.version !== NATIVE_VERSION) {
		throw new Error(
			`Guardian native package must be ${selected.name}@${NATIVE_VERSION}; found ${stringField(manifest.name)}@${stringField(manifest.version)}`,
		);
	}
	if (
		!arrayField(manifest.os).includes(platform) ||
		!arrayField(manifest.cpu).includes(arch) ||
		manifest.guardian?.nono?.path !== selected.nonoPath ||
		(selected.bwrapPath !== "" && manifest.guardian?.bubblewrap?.path !== selected.bwrapPath)
	) {
		throw new Error(`Guardian native package ${selected.name} has invalid platform or executable metadata`);
	}
	const root = dirname(manifestPath);
	return {
		nonoPath: verifiedExecutable(root, selected.nonoPath, manifest.guardian?.nono?.sha256),
		bwrapPath: selected.bwrapPath
			? verifiedExecutable(root, selected.bwrapPath, manifest.guardian?.bubblewrap?.sha256)
			: "",
		packageName: selected.name,
	};
}

interface NativeManifest extends Record<string, unknown> {
	name?: unknown;
	version?: unknown;
	os?: unknown;
	cpu?: unknown;
	guardian?: {
		nono?: { path?: unknown; sha256?: unknown };
		bubblewrap?: { path?: unknown; sha256?: unknown };
	};
}

function parseManifest(path: string): NativeManifest {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("manifest is not an object");
		}
		return value as NativeManifest;
	} catch (error) {
		throw new Error(`Guardian native package manifest is invalid: ${path}`, { cause: error });
	}
}

function verifiedExecutable(root: string, relativePath: string, expectedSha256: unknown): string {
	if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
		throw new Error(`Guardian native executable ${relativePath} has invalid checksum metadata`);
	}
	const lexicalPath = join(root, relativePath);
	const metadata = lstatSync(lexicalPath);
	if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0) {
		throw new Error(`Guardian native executable must be a regular executable file: ${lexicalPath}`);
	}
	const path = realpathSync(lexicalPath);
	const fromRoot = relative(root, path);
	if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
		throw new Error(`Guardian native executable escapes its package: ${lexicalPath}`);
	}
	const actualSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
	if (actualSha256 !== expectedSha256) {
		throw new Error(`Guardian native executable checksum mismatch: ${lexicalPath}`);
	}
	return path;
}

function arrayField(value: unknown): string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "unknown";
}
