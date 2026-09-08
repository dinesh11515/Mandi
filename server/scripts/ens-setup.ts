import { toHex, zeroAddress, zeroHash } from "viem";
import { config } from "../src/config";
import {
  ENSV2,
  deployerAccount,
  erc20Abi,
  factoryAbi,
  labelIdOf,
  predictProxy,
  publicClient,
  registrarAbi,
  registryAbi,
  resolverInitData,
  resolverSalt,
  subregistryInitData,
  subregistrySalt,
  walletClient,
} from "../src/ens";

const ONE_YEAR = 365n * 24n * 60n * 60n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const reader = publicClient();
  const label = config.ens.parentLabel;
  const [available, [base, premium]] = await Promise.all([
    reader.readContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "isAvailable", args: [label] }),
    reader.readContract({
      address: ENSV2.ethRegistrar,
      abi: registrarAbi,
      functionName: "getRegisterPrice",
      args: [label, ONE_YEAR, ENSV2.mockUsdc],
    }),
  ]);
  console.log(`${config.ens.parentName}: available=${available} price=${Number(base + premium) / 1e6} MockUSDC/yr`);

  const account = deployerAccount();
  const wallet = walletClient();
  console.log(`deployer ${account.address}`);

  const resolver = predictProxy(account.address, resolverSalt(account.address));
  if ((await reader.getCode({ address: resolver })) === undefined) {
    const hash = await wallet.writeContract({
      address: ENSV2.factory,
      abi: factoryAbi,
      functionName: "deployProxy",
      args: [ENSV2.resolverImpl, resolverSalt(account.address), resolverInitData(account.address)],
    });
    await reader.waitForTransactionReceipt({ hash });
    console.log(`resolver deployed ${resolver} tx ${hash}`);
  } else {
    console.log(`resolver exists ${resolver}`);
  }

  const subregistry = predictProxy(account.address, subregistrySalt(config.ens.parentName));
  if ((await reader.getCode({ address: subregistry })) === undefined) {
    const hash = await wallet.writeContract({
      address: ENSV2.factory,
      abi: factoryAbi,
      functionName: "deployProxy",
      args: [ENSV2.userRegistryImpl, subregistrySalt(config.ens.parentName), subregistryInitData(account.address)],
    });
    const receipt = await reader.waitForTransactionReceipt({ hash });
    console.log(`subregistry deployed ${subregistry} tx ${hash} block ${receipt.blockNumber}`);
    console.log(`add to .env: ENS_FROM_BLOCK=${receipt.blockNumber}`);
  } else {
    console.log(`subregistry exists ${subregistry}`);
  }

  if (available) {
    const price = base + premium;
    const balance = await reader.readContract({ address: ENSV2.mockUsdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    if (balance < price) {
      const hash = await wallet.writeContract({ address: ENSV2.mockUsdc, abi: erc20Abi, functionName: "mint", args: [account.address, price] });
      await reader.waitForTransactionReceipt({ hash });
      console.log(`minted ${Number(price) / 1e6} MockUSDC`);
    }
    const approveHash = await wallet.writeContract({ address: ENSV2.mockUsdc, abi: erc20Abi, functionName: "approve", args: [ENSV2.ethRegistrar, price] });
    await reader.waitForTransactionReceipt({ hash: approveHash });
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const commitment = await reader.readContract({
      address: ENSV2.ethRegistrar,
      abi: registrarAbi,
      functionName: "makeCommitment",
      args: [label, account.address, secret, subregistry, resolver, ONE_YEAR, zeroHash],
    });
    const commitHash = await wallet.writeContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "commit", args: [commitment] });
    await reader.waitForTransactionReceipt({ hash: commitHash });
    console.log(`committed ${commitment}; waiting 75s for MIN_COMMITMENT_AGE`);
    await sleep(75_000);
    const registerHash = await wallet.writeContract({
      address: ENSV2.ethRegistrar,
      abi: registrarAbi,
      functionName: "register",
      args: [label, account.address, secret, subregistry, resolver, ONE_YEAR, ENSV2.mockUsdc, zeroHash],
    });
    await reader.waitForTransactionReceipt({ hash: registerHash });
    console.log(`registered ${config.ens.parentName} tx ${registerHash}`);
  } else {
    const current = await reader.readContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName: "getSubregistry", args: [label] });
    if (current.toLowerCase() !== subregistry.toLowerCase()) {
      const hash = await wallet.writeContract({
        address: ENSV2.ethRegistry,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [labelIdOf(label), subregistry],
      });
      await reader.waitForTransactionReceipt({ hash });
      console.log(`subregistry set on ${config.ens.parentName} tx ${hash}`);
    } else {
      console.log(`subregistry already set on ${config.ens.parentName}`);
    }
    const currentResolver = await reader.readContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName: "getResolver", args: [label] });
    if (currentResolver === zeroAddress) {
      const hash = await wallet.writeContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName: "setResolver", args: [labelIdOf(label), resolver] });
      await reader.waitForTransactionReceipt({ hash });
      console.log(`resolver set on ${config.ens.parentName} tx ${hash}`);
    }
  }

  console.log(`add to .env: ENS_SUBREGISTRY=${subregistry}`);
  console.log(`add to .env: ENS_RESOLVER=${resolver}`);
  console.log(`https://explorer.ens.dev/name/${config.ens.parentName}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
