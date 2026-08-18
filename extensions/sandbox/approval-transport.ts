import { resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

export interface UserApprovalChoice {
	id: string;
	label: string;
	requestReason?: boolean;
}

export interface UserApprovalRequest {
	requestId: string;
	title: string;
	message: string;
	source: "tool_call";
	surface: string | null;
	value: string | null;
	choices: readonly UserApprovalChoice[];
	reasonTitle?: string;
	reasonPlaceholder?: string;
	signal?: AbortSignal;
}

export interface UserApprovalResult {
	choiceId: string | null;
	reason?: string;
	unavailableReason?: string;
}

type ApprovalContext = Pick<ExtensionContext, "hasUI" | "sessionManager" | "ui">;

interface ApprovalSession {
	ctx: ApprovalContext;
	shutdown: AbortController;
}

const sessions = new Map<string, ApprovalSession>();

/** Register a session so descendants can follow its parent chain to a UI. */
export function registerApprovalSession(ctx: ApprovalContext): void {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return;
	const key = resolve(sessionFile);
	sessions.get(key)?.shutdown.abort();
	sessions.set(key, { ctx, shutdown: new AbortController() });
}

export function unregisterApprovalSession(ctx: ApprovalContext): void {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return;
	const key = resolve(sessionFile);
	const session = sessions.get(key);
	if (session?.ctx !== ctx) return;
	session.shutdown.abort();
	sessions.delete(key);
}

/**
 * Shows an approval in the current UI, or in the interactive parent of an
 * in-process child session. The sandbox owns both transport and policy.
 */
export const requestUserApproval: (
	ctx: ApprovalContext,
	request: UserApprovalRequest,
) => Effect.Effect<UserApprovalResult> = Effect.fn("Sandbox.requestUserApproval")(
	function* (ctx: ApprovalContext, request: UserApprovalRequest) {
		if (ctx.hasUI) return yield* requestLocalApproval(ctx.ui, request);

		const target = findInteractiveAncestor(ctx);
		if (!target) {
			return {
				choiceId: null,
				unavailableReason: "No interactive parent sandbox session is available for approval",
			} satisfies UserApprovalResult;
		}
		const signals = [target.shutdown.signal, request.signal].filter(
			(signal): signal is AbortSignal => signal !== undefined,
		);
		const forwarded = { ...request, signal: AbortSignal.any(signals) };
		return yield* requestLocalApproval(target.ctx.ui, forwarded).pipe(
			Effect.catch((error) => Effect.succeed({
				choiceId: null,
				unavailableReason: error instanceof Error ? error.message : String(error),
			} satisfies UserApprovalResult)),
		);
	},
);

function findInteractiveAncestor(ctx: ApprovalContext): ApprovalSession | undefined {
	let parentSession = ctx.sessionManager.getHeader()?.parentSession;
	const visited = new Set<string>();
	while (parentSession) {
		const key = resolve(parentSession);
		if (visited.has(key)) return undefined;
		visited.add(key);
		const session = sessions.get(key);
		if (!session) return undefined;
		if (session.ctx.hasUI) return session;
		parentSession = session.ctx.sessionManager.getHeader()?.parentSession;
	}
	return undefined;
}

const requestLocalApproval: (
	ui: Pick<ExtensionContext["ui"], "select" | "input">,
	request: UserApprovalRequest,
) => Effect.Effect<UserApprovalResult> = Effect.fn("Sandbox.requestLocalApproval")(
	function* (ui, request) {
		const labels = request.choices.map((choice) => choice.label);
		const selection = yield* Effect.tryPromise({
			try: () => ui.select(`${request.title}\n${request.message}`, labels, { signal: request.signal }),
			catch: (error) => error,
		});
		const choice = request.choices.find((candidate) => candidate.label === selection);
		if (!choice) return { choiceId: null } satisfies UserApprovalResult;

		const reason = choice.requestReason
			? yield* Effect.tryPromise({
					try: () => ui.input(
						request.reasonTitle ?? "Tell the agent what to do instead",
						request.reasonPlaceholder ?? "Short note",
						{ signal: request.signal },
					),
					catch: (error) => error,
				})
			: undefined;
		return { choiceId: choice.id, ...(reason ? { reason } : {}) } satisfies UserApprovalResult;
	},
);
