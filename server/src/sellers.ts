import { recoverMessageAddress, zeroAddress, type Address, type Hex } from "viem";
import { allSuppliers, assertSellerLabel, config, removeSupplier, SELLER_DEFAULTS, supplierByLabel, upsertSupplier, type Depth, type Supplier } from "./config";
import { assertSupplierOwner, chainOwnership, directory, labelOf, labelsOnChain, ownerOf, registerService, serviceName, type RegisterResult } from "./ens";
import { attestationLookup } from "./world";

export { ownerOf } from "./ens";

export type SellerRegistrationMessageInput = {
  label: string;
  owner: string;
  payTo: string;
  priceHbar: number;
  capability: string;
};

export function sellerRegistrationMessage(input: SellerRegistrationMessageInput): string {
  return [
    "Mandi seller registration",
    `name: ${input.label}.${config.ens.parentName}`,
    `owner: ${input.owner.toLowerCase()}`,
    `payTo: ${input.payTo}`,
    `price: ${input.priceHbar} HBAR`,
    `capability: ${input.capability}`,
  ].join("\n");
}

export type SignedSellerRegistration = SellerRegistrationMessageInput & { signature: Hex };

export async function recoverRegistrationSigner(input: SignedSellerRegistration): Promise<Address | null> {
  return recoverMessageAddress({ message: sellerRegistrationMessage(input), signature: input.signature }).catch(() => null);
}

export async function verifySellerRegistration(input: SignedSellerRegistration): Promise<boolean> {
  const recovered = await recoverRegistrationSigner(input);
  return recovered !== null && recovered.toLowerCase() === input.owner.toLowerCase();
}

export function selfieCheckMessage(input: { label: string; owner: string }): string {
  return ["Mandi Selfie Check", `name: ${input.label}.${config.ens.parentName}`, `owner: ${input.owner.toLowerCase()}`].join("\n");
}

export type SelfieCheckProof = { label: string; wallet: Address; signature: Hex };

export async function recoverSelfieCheckSigner(input: SelfieCheckProof): Promise<Address | null> {
  const message = selfieCheckMessage({ label: input.label, owner: input.wallet });
  return recoverMessageAddress({ message, signature: input.signature }).catch(() => null);
}

export async function assertSelfieCheckOwner(input: SelfieCheckProof): Promise<Supplier> {
  const label = assertSellerLabel(input.label);
  const supplier = assertSupplierOwner(label, input.wallet);
  const recovered = await recoverSelfieCheckSigner({ ...input, label });
  if (!recovered || recovered.toLowerCase() !== input.wallet.toLowerCase()) {
    throw new Error(`signature does not recover ${input.wallet}; sign the Selfie Check message with that wallet`);
  }
  return supplier;
}

export const REGISTRATION_LIMITS = { perHour: 20, perOwnerPerHour: 3, windowMs: 60 * 60 * 1000 };

export class RegistrationRateLimit extends Error {}

const registrations: { at: number; owner: string }[] = [];

function admitRegistration(owner: string, now: number) {
  const oldest = now - REGISTRATION_LIMITS.windowMs;
  while (registrations.length > 0 && registrations[0]!.at <= oldest) registrations.shift();
  if (registrations.length >= REGISTRATION_LIMITS.perHour) {
    throw new RegistrationRateLimit(`Mandi is taking at most ${REGISTRATION_LIMITS.perHour} registrations an hour; try again later`);
  }
  if (registrations.filter((entry) => entry.owner === owner).length >= REGISTRATION_LIMITS.perOwnerPerHour) {
    throw new RegistrationRateLimit(`${owner} has used its ${REGISTRATION_LIMITS.perOwnerPerHour} registrations for this hour; try again later`);
  }
  registrations.push({ at: now, owner });
}

export type SellerRegistrationInput = SignedSellerRegistration & {
  depth: Depth;
  context: string;
  upstream?: string;
};

export type SellerRegistrationDeps = {
  chainOwnership: typeof chainOwnership;
  registerService: typeof registerService;
  now: () => number;
};

const liveDeps: SellerRegistrationDeps = { chainOwnership, registerService, now: Date.now };

export async function registerSeller(input: SellerRegistrationInput, deps: SellerRegistrationDeps = liveDeps): Promise<RegisterResult & { supplier: SellerRow }> {
  const label = assertSellerLabel(input.label);
  const owner = input.owner.toLowerCase();
  const signed = { ...input, label, owner };
  if (!(await verifySellerRegistration(signed))) {
    throw new Error(`signature does not recover ${owner}; sign the registration message with that wallet`);
  }
  const existing = supplierByLabel(label);
  const existingOwner = existing ? ownerOf(existing) : "";
  if (existingOwner && existingOwner !== owner) throw new Error(`${serviceName(label)} belongs to ${existingOwner}`);
  if (!existingOwner) {
    let onChain;
    try {
      onChain = await deps.chainOwnership(label);
    } catch (err) {
      throw new Error(`cannot read the on-chain owner of ${serviceName(label)}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
    if (onChain.owner !== zeroAddress && onChain.owner.toLowerCase() !== owner) {
      throw new Error(`${serviceName(label)} is owned on chain by ${onChain.owner}`);
    }
  }
  admitRegistration(owner, deps.now());
  const supplier = upsertSupplier({
    label,
    owner,
    upstream: input.upstream ?? "",
    payTo: input.payTo,
    priceHbar: input.priceHbar,
    deepPriceHbar: Math.round(input.priceHbar * SELLER_DEFAULTS.deepMultiplier * 1e8) / 1e8,
    depth: input.depth,
    capability: input.capability,
    context: input.context,
  });
  try {
    const result = await deps.registerService(label, { owner: owner as Address });
    return { ...result, supplier: await sellerRow(supplier, true) };
  } catch (err) {
    if (!existing) removeSupplier(label);
    throw err;
  }
}

export type SellerRow = {
  label: string;
  name: string;
  owner: string;
  capability: string;
  depth: Depth;
  priceHbar: number;
  deepPriceHbar: number;
  payTo: string;
  upstream: string;
  context: string;
  listed: boolean;
  attested: boolean;
};

async function sellerRow(supplier: Supplier, listed: boolean): Promise<SellerRow> {
  const name = serviceName(supplier.label);
  const attestation = await attestationLookup(name).catch(() => null);
  return {
    label: supplier.label,
    name,
    owner: ownerOf(supplier),
    capability: supplier.capability,
    depth: supplier.depth,
    priceHbar: supplier.priceHbar,
    deepPriceHbar: supplier.deepPriceHbar,
    payTo: supplier.payTo,
    upstream: supplier.upstream,
    context: supplier.context,
    listed,
    attested: attestation?.valid === true,
  };
}

async function listedLabels(labels: string[]): Promise<Set<string>> {
  const found = await directory()
    .then((names) => names.map(labelOf))
    .catch(() => labelsOnChain(labels).catch(() => []));
  return new Set(found);
}

export async function sellersList(): Promise<SellerRow[]> {
  const suppliers = allSuppliers();
  const listed = await listedLabels(suppliers.map((s) => s.label));
  return Promise.all(suppliers.map((supplier) => sellerRow(supplier, listed.has(supplier.label))));
}

export async function sellersByOwner(address: string): Promise<SellerRow[]> {
  const owner = address.toLowerCase();
  return (await sellersList()).filter((row) => row.owner === owner);
}
