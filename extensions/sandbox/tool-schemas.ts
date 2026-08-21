import { Type } from "typebox";

const AccessRightParams = Type.Union([
	Type.Object(
		{
			kind: Type.Literal("filesystem"),
			access: Type.Union([Type.Literal("read"), Type.Literal("write")]),
			path: Type.String({
				description: "Project-relative or home-relative (~/); absolute paths outside those roots can be approved only for this Pi session",
				maxLength: 1024,
			}),
			scope: Type.Union([Type.Literal("file"), Type.Literal("tree")]),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("network_host"),
			host: Type.String({ description: "One exact hostname or IP, without scheme, port, path, or wildcard" }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("network_endpoint"),
			host: Type.String({ description: "Loopback host: localhost, 127.0.0.1, or ::1" }),
			port: Type.Integer({ minimum: 1, maximum: 65_535 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			kind: Type.Literal("development_cache"),
			environment: Type.Record(
				Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 64 }),
				Type.String({ maxLength: 256 }),
				{ minProperties: 1, maxProperties: 16 },
			),
		},
		{ additionalProperties: false },
	),
]);

export const RequestAccessParams = Type.Object(
	{
		rights: Type.Array(AccessRightParams, { minItems: 1, maxItems: 32 }),
		reason: Type.String({ description: "Why the project needs these rights", maxLength: 2000 }),
	},
	{ additionalProperties: false },
);

export const BashParams = Type.Object(
	{
		command: Type.String({ description: "Bash command to execute" }),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	},
	{ additionalProperties: false },
);

const BackgroundJobAction = Type.Union([
	Type.Literal("start"),
	Type.Literal("list"),
	Type.Literal("status"),
	Type.Literal("read"),
	Type.Literal("write"),
	Type.Literal("line"),
	Type.Literal("keys"),
	Type.Literal("stop"),
]);

export const BackgroundJobParams = Type.Object(
	{
		action: BackgroundJobAction,
		name: Type.Optional(Type.String({ description: "Required for every action except list; must start with pi-" })),
		command: Type.Optional(Type.String({ description: "Required when action is start" })),
		cwd: Type.Optional(Type.String({ description: "Working directory inside this workspace; only used by start" })),
		lines: Type.Optional(Type.Integer({ description: "Only used by read", minimum: 1, maximum: 10_000 })),
		text: Type.Optional(Type.String({ description: "Required when action is write or line" })),
		keys: Type.Optional(Type.Array(Type.String(), {
			description: "Required when action is keys",
			minItems: 1,
			maxItems: 20,
		})),
	},
	{ additionalProperties: false },
);

export type BackgroundJobInput =
	| { action: "start"; name: string; command: string; cwd?: string }
	| { action: "list" }
	| { action: "status" | "stop"; name: string }
	| { action: "read"; name: string; lines?: number }
	| { action: "write" | "line"; name: string; text: string }
	| { action: "keys"; name: string; keys: string[] };

export function validateBackgroundJobParams(params: {
	action: BackgroundJobInput["action"];
	name?: string;
	command?: string;
	cwd?: string;
	lines?: number;
	text?: string;
	keys?: string[];
}): BackgroundJobInput | string {
	if (params.action === "list") return { action: "list" };
	if (params.name === undefined) return `Background job action ${params.action} requires name.`;
	if (params.action === "start") {
		if (params.command === undefined) return "Background job action start requires command.";
		return { action: "start", name: params.name, command: params.command, ...(params.cwd === undefined ? {} : { cwd: params.cwd }) };
	}
	if (params.action === "read") {
		return { action: "read", name: params.name, ...(params.lines === undefined ? {} : { lines: params.lines }) };
	}
	if (params.action === "write" || params.action === "line") {
		if (params.text === undefined) return `Background job action ${params.action} requires text.`;
		return { action: params.action, name: params.name, text: params.text };
	}
	if (params.action === "keys") {
		if (params.keys === undefined) return "Background job action keys requires keys.";
		return { action: "keys", name: params.name, keys: params.keys };
	}
	return { action: params.action, name: params.name };
}
