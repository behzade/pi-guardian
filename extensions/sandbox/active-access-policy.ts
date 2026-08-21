import { ensureDevelopmentCacheDirectories } from "./development-caches.ts";
import {
	activateProjectPolicy,
	EMPTY_PROJECT_POLICY,
	loadProjectPolicy,
	loadProjectPolicyForUpdate,
	mergeAccessPolicies,
	sameProjectPolicy,
	type ActiveProjectPolicy,
} from "./project-policy.ts";
import type { NativeSandboxConfig } from "./sandbox-config.ts";
import {
	loadSessionPolicy,
	type SessionPolicyIdentity,
} from "./session-policy-store.ts";

/** Active project, Pi-session, and combined policy state for one workspace. */
export class ActiveAccessPolicy {
	private constructor(
		readonly cwd: string,
		readonly machineConfig: NativeSandboxConfig,
		readonly trusted: boolean,
		readonly sessionIdentity: SessionPolicyIdentity | undefined,
		public project: ActiveProjectPolicy,
		public session: ActiveProjectPolicy,
		public effective: ActiveProjectPolicy,
	) {}

	static load(
		cwd: string,
		machineConfig: NativeSandboxConfig,
		trusted: boolean,
		sessionIdentity?: SessionPolicyIdentity,
	): ActiveAccessPolicy {
		const empty = () => activateProjectPolicy(EMPTY_PROJECT_POLICY, cwd, machineConfig);
		const project = trusted ? loadProjectPolicy(cwd, machineConfig) : empty();
		const session = trusted && sessionIdentity
			? loadSessionPolicy(sessionIdentity, machineConfig)
			: empty();
		const effective = activateProjectPolicy(
			mergeAccessPolicies(project.policy, session.policy),
			cwd,
			machineConfig,
		);
		ensureDevelopmentCacheDirectories(effective.config.developmentCache);
		return new ActiveAccessPolicy(cwd, machineConfig, trusted, sessionIdentity, project, session, effective);
	}

	synchronize(): ActiveProjectPolicy {
		if (!this.trusted) return this.revalidate();
		const project = loadProjectPolicyForUpdate(this.cwd, this.machineConfig);
		const session = this.sessionIdentity
			? loadSessionPolicy(this.sessionIdentity, this.machineConfig)
			: this.revalidate(this.session);
		return this.replace(project, session);
	}

	replace(project: ActiveProjectPolicy, session: ActiveProjectPolicy): ActiveProjectPolicy {
		const previous = this.effective;
		this.project = project;
		this.session = session;
		this.effective = activateProjectPolicy(
			mergeAccessPolicies(project.policy, session.policy),
			this.cwd,
			this.machineConfig,
		);
		if (!sameProjectPolicy(previous.policy, this.effective.policy)) {
			ensureDevelopmentCacheDirectories(this.effective.config.developmentCache);
		}
		return this.effective;
	}

	revalidate(policy: ActiveProjectPolicy = this.effective): ActiveProjectPolicy {
		return activateProjectPolicy(
			policy.policy,
			this.cwd,
			this.machineConfig,
			policy.sourceText,
		);
	}
}
