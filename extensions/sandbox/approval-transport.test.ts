import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
	registerApprovalSession,
	requestUserApproval,
	unregisterApprovalSession,
	type UserApprovalRequest,
} from "./approval-transport.ts";

const request: UserApprovalRequest = {
	requestId: "request-1",
	title: "Permission needed",
	message: "Allow the requested file?",
	source: "tool_call",
	surface: "read",
	value: "/tmp/input",
	choices: [
		{ id: "allow", label: "Allow" },
		{ id: "deny", label: "No" },
		{ id: "deny-reason", label: "No, with comment", requestReason: true },
	],
};

function context(options: {
	hasUI: boolean;
	sessionFile: string;
	parentSession?: string;
	select?: (_title: string, _choices: string[], options?: { signal?: AbortSignal }) => Promise<string | undefined>;
	input?: () => Promise<string | undefined>;
}) {
	return {
		hasUI: options.hasUI,
		sessionManager: {
			getSessionFile: () => options.sessionFile,
			getHeader: () => ({ parentSession: options.parentSession }),
		},
		ui: {
			select: options.select ?? (async () => undefined),
			input: options.input ?? (async () => undefined),
		},
	} as never;
}

test("uses the local UI when one is available", async () => {
	const ctx = context({ hasUI: true, sessionFile: "/sessions/local.jsonl", select: async () => "Allow" });
	const result = await Effect.runPromise(requestUserApproval(ctx, request));
	assert.deepEqual(result, { choiceId: "allow" });
});

test("collects a denial reason from the local UI", async () => {
	const ctx = context({
		hasUI: true,
		sessionFile: "/sessions/local.jsonl",
		select: async () => "No, with comment",
		input: async () => "Use the checked-in fixture",
	});
	const result = await Effect.runPromise(requestUserApproval(ctx, request));
	assert.deepEqual(result, { choiceId: "deny-reason", reason: "Use the checked-in fixture" });
});

test("routes a headless child approval to its registered parent", async () => {
	const parent = context({ hasUI: true, sessionFile: "/sessions/parent.jsonl", select: async () => "Allow" });
	const child = context({ hasUI: false, sessionFile: "/sessions/child.jsonl", parentSession: "/sessions/parent.jsonl" });
	registerApprovalSession(parent);
	try {
		const result = await Effect.runPromise(requestUserApproval(child, request));
		assert.deepEqual(result, { choiceId: "allow" });
	} finally {
		unregisterApprovalSession(parent);
	}
});

test("routes through a registered headless parent to an interactive ancestor", async () => {
	const parent = context({ hasUI: true, sessionFile: "/sessions/parent.jsonl", select: async () => "Allow" });
	const middle = context({ hasUI: false, sessionFile: "/sessions/middle.jsonl", parentSession: "/sessions/parent.jsonl" });
	const child = context({ hasUI: false, sessionFile: "/sessions/child.jsonl", parentSession: "/sessions/middle.jsonl" });
	registerApprovalSession(parent);
	registerApprovalSession(middle);
	try {
		const result = await Effect.runPromise(requestUserApproval(child, request));
		assert.deepEqual(result, { choiceId: "allow" });
	} finally {
		unregisterApprovalSession(middle);
		unregisterApprovalSession(parent);
	}
});

test("aborts a forwarded prompt when its interactive parent unregisters", async () => {
	const parent = context({
		hasUI: true,
		sessionFile: "/sessions/parent.jsonl",
		select: (_title, _choices, options) => new Promise((_resolve, reject) => {
			options?.signal?.addEventListener("abort", () => reject(new Error("approval aborted")), { once: true });
			queueMicrotask(() => unregisterApprovalSession(parent));
		}),
	});
	const child = context({ hasUI: false, sessionFile: "/sessions/child.jsonl", parentSession: "/sessions/parent.jsonl" });
	registerApprovalSession(parent);
	const result = await Effect.runPromise(requestUserApproval(child, request));
	assert.deepEqual(result, { choiceId: null, unavailableReason: "approval aborted" });
});

test("fails closed without an interactive parent", async () => {
	const child = context({ hasUI: false, sessionFile: "/sessions/child.jsonl", parentSession: "/sessions/missing.jsonl" });
	const result = await Effect.runPromise(requestUserApproval(child, request));
	assert.equal(result.choiceId, null);
	assert.match(result.unavailableReason ?? "", /interactive parent sandbox session/);
});
