import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  http,
  keccak256,
  concat,
  parseAbi,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash, normalize } from "viem/ens";
import { SUPPLIERS, config, requireEnv, supplierByLabel } from "./config";
import { formatHbar } from "./hbar";
import { ServiceCardSchema, type ServiceCard } from "./types";

export const ENSV2 = {
  ethRegistry: "0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2",
  ethRegistrar: "0xa88553F454b77203B0D036A05c894d555EAAa2Cc",
  factory: "0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef",
  proxyLogic: "0xA136BeE4E37B44586242e516a39893EfD54315e9",
  resolverImpl: "0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e",
  userRegistryImpl: "0x624a25d67B59D587752EbEc8DdeD8827dAe52050",
  mockUsdc: "0x768F42455A2D082E23ceeF7d51e5787C82d67a39",
} as const satisfies Record<string, Address>;

export const ALL_ROLES = BigInt("0x1111111111111111111111111111111111111111111111111111111111111111");
export const ROLE_SET_RESOLVER = 1n << 24n;
export const ROLE_SET_TEXT = 1n << 4n;
export const ROLE_SET_ADDR = 1n << 0n;

export const RECORD_KEYS = {
  agentContext: "agent-context",
  agentEndpoint: "agent-endpoint[x402]",
  capability: "mandi:capability",
  price: "mandi:price",
  chain: "mandi:chain",
  verified: "mandi:verified",
} as const;

export const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);

export const registryAbi = parseAbi([
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256 tokenId)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function setResolver(uint256 anyId, address resolver)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function grantRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
]);

export const resolverAbi = parseAbi([
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)",
  "function multicall(bytes[] data) returns (bytes[] results)",
  "function authorizeNameRoles(bytes toName, uint256 roleBitmap, address account, bool grant) returns (bool)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
]);

export const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const initializeResolverAbi = parseAbi([
  "function initialize(address admin, uint256 roleBitmap, bytes[] setters)",
]);

export const initializeRegistryAbi = parseAbi(["function initialize(address rootAccount, uint256 roleBitmap)"]);

export function publicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(config.ens.rpcUrl || undefined, { retryCount: 5, retryDelay: 400, timeout: 20_000 }),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await work();
    } catch (err) {
      lastError = err;
      await sleep(300 * (i + 1));
    }
  }
  throw lastError;
}

export function deployerAccount() {
  return privateKeyToAccount(requireEnv("SEPOLIA_PRIVATE_KEY") as Hex);
}

export function walletClient() {
  return createWalletClient({
    account: deployerAccount(),
    chain: sepolia,
    transport: http(config.ens.rpcUrl || undefined),
  });
}

export function resolverSalt(owner: Address): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(stringToBytes("OwnedResolver")), owner, 0n],
      ),
    ),
  );
}

export function subregistrySalt(parentName: string): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [keccak256(stringToBytes("UserRegistry")), namehash(parentName), 0n],
      ),
    ),
  );
}

export function predictProxy(deployer: Address, salt: bigint): Address {
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [deployer, salt]),
  );
  const bytecode = concat([
    "0x3d604d80600a3d3981f3363d3d373d3d3d363d73",
    ENSV2.proxyLogic,
    "0x5af43d82803e903d91602b57fd5bf3",
    outerSalt,
  ]);
  return getContractAddress({ bytecode, from: ENSV2.factory, opcode: "CREATE2", salt: outerSalt });
}

export function resolverInitData(admin: Address): Hex {
  return encodeFunctionData({
    abi: initializeResolverAbi,
    functionName: "initialize",
    args: [admin, ALL_ROLES, []],
  });
}

export function subregistryInitData(root: Address): Hex {
  return encodeFunctionData({
    abi: initializeRegistryAbi,
    functionName: "initialize",
    args: [root, ALL_ROLES],
  });
}

export function serviceName(label: string): string {
  return normalize(`${label}.${config.ens.parentName}`);
}

export function labelOf(name: string): string {
  return name.split(".")[0]!;
}

export function serviceRecords(label: string): Record<string, string> {
  const supplier = supplierByLabel(label);
  if (!supplier) throw new Error(`unknown supplier ${label}`);
  return {
    [RECORD_KEYS.agentContext]: supplier.context,
    [RECORD_KEYS.agentEndpoint]: `${config.publicUrl}/s/${label}/assess`,
    [RECORD_KEYS.capability]: supplier.capability,
    [RECORD_KEYS.price]: formatHbar(supplier.priceHbar),
    [RECORD_KEYS.chain]: config.x402.network,
  };
}

export async function readRecords(name: string, keys: string[]): Promise<Record<string, string>> {
  const client = publicClient();
  const normalized = normalize(name);
  const values: (string | null)[] = [];
  for (const key of keys) values.push(await withRetry(() => client.getEnsText({ name: normalized, key })));
  const out: Record<string, string> = {};
  keys.forEach((key, i) => {
    out[key] = values[i] ?? "";
  });
  return out;
}

export async function resolveService(name: string): Promise<ServiceCard> {
  const records = await readRecords(name, Object.values(RECORD_KEYS));
  if (!records[RECORD_KEYS.agentEndpoint]) throw new Error(`${name} has no ${RECORD_KEYS.agentEndpoint} record`);
  return ServiceCardSchema.parse({
    name: normalize(name),
    endpoint: records[RECORD_KEYS.agentEndpoint],
    agentContext: records[RECORD_KEYS.agentContext],
    capability: records[RECORD_KEYS.capability],
    price: records[RECORD_KEYS.price],
    chain: records[RECORD_KEYS.chain],
    verified: records[RECORD_KEYS.verified] === "true",
  });
}

export function subregistryAddress(): Address {
  if (config.ens.subregistry) return config.ens.subregistry as Address;
  return predictProxy(deployerAccount().address, subregistrySalt(config.ens.parentName));
}

export function resolverAddress(): Address {
  if (config.ens.resolver) return config.ens.resolver as Address;
  return predictProxy(deployerAccount().address, resolverSalt(deployerAccount().address));
}

export async function setTextRecord(name: string, key: string, value: string): Promise<string> {
  const wallet = walletClient();
  const hash = await wallet.writeContract({
    address: resolverAddress(),
    abi: resolverAbi,
    functionName: "setText",
    args: [nodeOf(name), key, value],
  });
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

const MAX_CHUNK = 1000n;
const MIN_CHUNK = 10n;
const REQUESTS_PER_REFRESH = 30;
const REQUEST_SPACING_MS = 150;
const scan: { address?: Address; nextBlock?: bigint; chunk: bigint; labels: Set<string> } = { chunk: MAX_CHUNK, labels: new Set() };

function rangeLimitFrom(message: string): bigint | null {
  const match = /(\d+)\s*block/i.exec(message);
  return match ? BigInt(match[1]!) : null;
}

export async function registeredLabels(): Promise<string[]> {
  const client = publicClient();
  const address = subregistryAddress();
  const head = await client.getBlockNumber();
  if (scan.address !== address) {
    scan.address = address;
    scan.labels = new Set();
    scan.chunk = MAX_CHUNK;
    scan.nextBlock = config.ens.fromBlock ? BigInt(config.ens.fromBlock) : head - 100_000n;
  }
  let from = scan.nextBlock!;
  let requests = 0;
  while (from <= head && requests < REQUESTS_PER_REFRESH) {
    const to = from + scan.chunk - 1n > head ? head : from + scan.chunk - 1n;
    requests += 1;
    if (requests > 1) await sleep(REQUEST_SPACING_MS);
    try {
      const logs = await client.getLogs({ address, event: registryAbi[8], fromBlock: from, toBlock: to });
      for (const log of logs) if (log.args.label) scan.labels.add(log.args.label);
      from = to + 1n;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (scan.chunk > MIN_CHUNK && /range|limit|blocks/i.test(message)) {
        const limit = rangeLimitFrom(message);
        scan.chunk = limit && limit >= MIN_CHUNK && limit < scan.chunk ? limit : scan.chunk / 2n > MIN_CHUNK ? scan.chunk / 2n : MIN_CHUNK;
        continue;
      }
      throw err;
    }
  }
  scan.nextBlock = from;
  return [...scan.labels];
}

export function scanProgress() {
  return { nextBlock: scan.nextBlock?.toString() ?? null, chunk: scan.chunk.toString(), labelsFromEvents: scan.labels.size };
}

export async function labelsOnChain(labels: string[]): Promise<string[]> {
  const client = publicClient();
  const address = subregistryAddress();
  const found: string[] = [];
  for (const label of labels) {
    const resolver = await client.readContract({ address, abi: registryAbi, functionName: "getResolver", args: [label] });
    if (resolver !== zeroAddress) found.push(label);
  }
  return found;
}

let directoryCache: { at: number; cards: ServiceCard[]; source: string } | undefined;

export function directorySource(): string | null {
  return directoryCache?.source ?? null;
}

export async function directory(capability?: string): Promise<string[]> {
  if (!directoryCache || Date.now() - directoryCache.at > 60_000) {
    const [fromEvents, verified] = await Promise.all([
      registeredLabels().catch((err) => {
        console.warn(`directory: event scan failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        return [] as string[];
      }),
      labelsOnChain(SUPPLIERS.map((s) => s.label)),
    ]);
    const labels = [...new Set([...fromEvents, ...verified])];
    const source = fromEvents.length > 0 ? (verified.some((v) => !fromEvents.includes(v)) ? "events+registry-lookup" : "events") : "registry-lookup";
    const cards: ServiceCard[] = [];
    for (const label of labels) {
      try {
        cards.push(await resolveService(serviceName(label)));
      } catch (err) {
        console.warn(`directory skip ${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    directoryCache = { at: Date.now(), cards, source };
  }
  return directoryCache.cards
    .filter((card) => !capability || card.capability === capability)
    .map((card) => card.name);
}

export const nodeOf = (name: string) => namehash(normalize(name));
export const labelIdOf = (label: string) => BigInt(labelhash(label));
