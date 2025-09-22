import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_PSEUDONYM = 101;
const ERR_INVALID_PUBKEY = 102;
const ERR_INVALID_TIMESTAMP = 103;
const ERR_IDENTITY_ALREADY_EXISTS = 104;
const ERR_IDENTITY_NOT_FOUND = 105;
const ERR_INVALID_MAX_IDENTITIES = 106;
const ERR_MAX_IDENTITIES_EXCEEDED = 107;
const ERR_INVALID_METADATA = 109;
const ERR_AUTHORITY_NOT_VERIFIED = 110;
const ERR_INVALID_ATTRIBUTE = 111;
const ERR_INVALID_RECOVERY_KEY = 112;

interface Identity {
	pseudonym: string;
	pubkey: string;
	createdAt: number;
	status: boolean;
	metadata: string;
}

interface Attribute {
	value: string;
	updatedAt: number;
}

interface RecoveryKey {
	recoveryKey: string;
}

interface Result<T> {
	ok: boolean;
	value: T;
}

class IdentityRegistryMock {
	state: {
		nextId: number;
		maxIdentities: number;
		creationFee: number;
		authorityContract: string | null;
		identities: Map<number, Identity>;
		identitiesByPseudonym: Map<string, number>;
		identityAttributes: Map<string, Attribute>;
		recoveryKeys: Map<number, RecoveryKey>;
	} = {
		nextId: 0,
		maxIdentities: 10000,
		creationFee: 500,
		authorityContract: null,
		identities: new Map(),
		identitiesByPseudonym: new Map(),
		identityAttributes: new Map(),
		recoveryKeys: new Map(),
	};
	blockHeight: number = 0;
	caller: string = "ST1TEST";
	authorities: Set<string> = new Set(["ST1TEST"]);
	stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

	reset() {
		this.state = {
			nextId: 0,
			maxIdentities: 10000,
			creationFee: 500,
			authorityContract: null,
			identities: new Map(),
			identitiesByPseudonym: new Map(),
			identityAttributes: new Map(),
			recoveryKeys: new Map(),
		};
		this.blockHeight = 0;
		this.caller = "ST1TEST";
		this.authorities = new Set(["ST1TEST"]);
		this.stxTransfers = [];
	}

	setAuthorityContract(contractPrincipal: string): Result<boolean> {
		if (contractPrincipal === "SP000000000000000000002Q6VF78")
			return { ok: false, value: false };
		if (this.state.authorityContract !== null)
			return { ok: false, value: false };
		this.state.authorityContract = contractPrincipal;
		return { ok: true, value: true };
	}

	setMaxIdentities(newMax: number): Result<boolean> {
		if (newMax <= 0) return { ok: false, value: false };
		if (!this.state.authorityContract) return { ok: false, value: false };
		this.state.maxIdentities = newMax;
		return { ok: true, value: true };
	}

	setCreationFee(newFee: number): Result<boolean> {
		if (newFee < 0) return { ok: false, value: false };
		if (!this.state.authorityContract) return { ok: false, value: false };
		this.state.creationFee = newFee;
		return { ok: true, value: true };
	}

	registerIdentity(
		pseudonym: string,
		pubkey: string,
		metadata: string
	): Result<number> {
		if (this.state.nextId >= this.state.maxIdentities)
			return { ok: false, value: ERR_MAX_IDENTITIES_EXCEEDED };
		if (!pseudonym || pseudonym.length > 50)
			return { ok: false, value: ERR_INVALID_PSEUDONYM };
		if (!pubkey || pubkey.length > 256)
			return { ok: false, value: ERR_INVALID_PUBKEY };
		if (metadata.length > 200)
			return { ok: false, value: ERR_INVALID_METADATA };
		if (this.state.identitiesByPseudonym.has(pseudonym))
			return { ok: false, value: ERR_IDENTITY_ALREADY_EXISTS };
		if (!this.state.authorityContract)
			return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
		this.stxTransfers.push({
			amount: this.state.creationFee,
			from: this.caller,
			to: this.state.authorityContract,
		});
		const id = this.state.nextId;
		this.state.identities.set(id, {
			pseudonym,
			pubkey,
			createdAt: this.blockHeight,
			status: true,
			metadata,
		});
		this.state.identitiesByPseudonym.set(pseudonym, id);
		this.state.nextId++;
		return { ok: true, value: id };
	}

	updateIdentity(
		id: number,
		newPseudonym: string,
		newMetadata: string
	): Result<boolean> {
		const identity = this.state.identities.get(id);
		if (!identity) return { ok: false, value: false };
		if (identity.creator !== this.caller) return { ok: false, value: false };
		if (!newPseudonym || newPseudonym.length > 50)
			return { ok: false, value: false };
		if (newMetadata.length > 200) return { ok: false, value: false };
		if (
			this.state.identitiesByPseudonym.has(newPseudonym) &&
			this.state.identitiesByPseudonym.get(newPseudonym) !== id
		) {
			return { ok: false, value: false };
		}
		this.state.identitiesByPseudonym.delete(identity.pseudonym);
		this.state.identitiesByPseudonym.set(newPseudonym, id);
		this.state.identities.set(id, {
			...identity,
			pseudonym: newPseudonym,
			metadata: newMetadata,
		});
		return { ok: true, value: true };
	}

	setAttribute(id: number, key: string, value: string): Result<boolean> {
		const identity = this.state.identities.get(id);
		if (!identity) return { ok: false, value: false };
		if (identity.creator !== this.caller) return { ok: false, value: false };
		if (!key || key.length > 50) return { ok: false, value: false };
		this.state.identityAttributes.set(`${id}-${key}`, {
			value,
			updatedAt: this.blockHeight,
		});
		return { ok: true, value: true };
	}

	setRecoveryKey(id: number, recoveryKey: string): Result<boolean> {
		const identity = this.state.identities.get(id);
		if (!identity) return { ok: false, value: false };
		if (identity.creator !== this.caller) return { ok: false, value: false };
		if (!recoveryKey || recoveryKey.length > 256)
			return { ok: false, value: false };
		this.state.recoveryKeys.set(id, { recoveryKey });
		return { ok: true, value: true };
	}

	deactivateIdentity(id: number): Result<boolean> {
		const identity = this.state.identities.get(id);
		if (!identity) return { ok: false, value: false };
		if (identity.creator !== this.caller) return { ok: false, value: false };
		this.state.identities.set(id, { ...identity, status: false });
		return { ok: true, value: true };
	}

	getIdentity(id: number): Identity | null {
		return this.state.identities.get(id) || null;
	}

	getIdentityByPseudonym(pseudonym: string): Identity | null {
		const id = this.state.identitiesByPseudonym.get(pseudonym);
		return id !== undefined ? this.state.identities.get(id) || null : null;
	}

	getAttribute(id: number, key: string): Attribute | null {
		return this.state.identityAttributes.get(`${id}-${key}`) || null;
	}

	getRecoveryKey(id: number): RecoveryKey | null {
		return this.state.recoveryKeys.get(id) || null;
	}

	getIdentityCount(): Result<number> {
		return { ok: true, value: this.state.nextId };
	}

	isIdentityRegistered(pseudonym: string): Result<boolean> {
		return { ok: true, value: this.state.identitiesByPseudonym.has(pseudonym) };
	}
}

describe("IdentityRegistry", () => {
	let contract: IdentityRegistryMock;

	beforeEach(() => {
		contract = new IdentityRegistryMock();
		contract.reset();
	});

	it("registers identity successfully", () => {
		contract.setAuthorityContract("ST2TEST");
		const result = contract.registerIdentity(
			"Creator1",
			"pubkey123",
			"Artist Profile"
		);
		expect(result.ok).toBe(true);
		expect(result.value).toBe(0);
		const identity = contract.getIdentity(0);
		expect(identity?.pseudonym).toBe("Creator1");
		expect(identity?.pubkey).toBe("pubkey123");
		expect(identity?.metadata).toBe("Artist Profile");
		expect(identity?.status).toBe(true);
		expect(contract.stxTransfers).toEqual([
			{ amount: 500, from: "ST1TEST", to: "ST2TEST" },
		]);
	});

	it("rejects duplicate pseudonym", () => {
		contract.setAuthorityContract("ST2TEST");
		contract.registerIdentity("Creator1", "pubkey123", "Artist Profile");
		const result = contract.registerIdentity(
			"Creator1",
			"pubkey456",
			"Another Profile"
		);
		expect(result.ok).toBe(false);
		expect(result.value).toBe(ERR_IDENTITY_ALREADY_EXISTS);
	});

	it("rejects non-authorized caller for update", () => {
		contract.setAuthorityContract("ST2TEST");
		contract.registerIdentity("Creator1", "pubkey123", "Artist Profile");
		contract.caller = "ST3FAKE";
		const result = contract.updateIdentity(0, "Creator2", "Updated Profile");
		expect(result.ok).toBe(false);
		expect(result.value).toBe(false);
	});

	it("rejects invalid pseudonym", () => {
		contract.setAuthorityContract("ST2TEST");
		const result = contract.registerIdentity("", "pubkey123", "Artist Profile");
		expect(result.ok).toBe(false);
		expect(result.value).toBe(ERR_INVALID_PSEUDONYM);
	});

	it("rejects invalid pubkey", () => {
		contract.setAuthorityContract("ST2TEST");
		const result = contract.registerIdentity("Creator1", "", "Artist Profile");
		expect(result.ok).toBe(false);
		expect(result.value).toBe(ERR_INVALID_PUBKEY);
	});

	it("rejects invalid metadata", () => {
		contract.setAuthorityContract("ST2TEST");
		const longMetadata = "a".repeat(201);
		const result = contract.registerIdentity(
			"Creator1",
			"pubkey123",
			longMetadata
		);
		expect(result.ok).toBe(false);
		expect(result.value).toBe(ERR_INVALID_METADATA);
	});

	it("rejects registration without authority contract", () => {
		const result = contract.registerIdentity(
			"Creator1",
			"pubkey123",
			"Artist Profile"
		);
		expect(result.ok).toBe(false);
		expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
	});

	it("verifies Clarity types", () => {
		const pseudonym = stringUtf8CV("Creator1");
		const id = uintCV(0);
		expect(pseudonym.value).toBe("Creator1");
		expect(id.value).toEqual(BigInt(0));
	});

	it("checks identity existence correctly", () => {
		contract.setAuthorityContract("ST2TEST");
		contract.registerIdentity("Creator1", "pubkey123", "Artist Profile");
		const result = contract.isIdentityRegistered("Creator1");
		expect(result.ok).toBe(true);
		expect(result.value).toBe(true);
		const result2 = contract.isIdentityRegistered("Creator2");
		expect(result2.ok).toBe(true);
		expect(result2.value).toBe(false);
	});

	it("gets identity count correctly", () => {
		contract.setAuthorityContract("ST2TEST");
		contract.registerIdentity("Creator1", "pubkey123", "Artist Profile");
		contract.registerIdentity("Creator2", "pubkey456", "Designer Profile");
		const result = contract.getIdentityCount();
		expect(result.ok).toBe(true);
		expect(result.value).toBe(2);
	});
});
