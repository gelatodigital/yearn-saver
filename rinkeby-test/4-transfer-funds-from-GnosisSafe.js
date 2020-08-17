// We require the Buidler Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `buidler run <script>` you'll find the Buidler
// Runtime Environment's members available in the global scope.
const bre = require("@nomiclabs/buidler");
const ethers = bre.ethers;
const { utils } = require("ethers");

// CPK Library
const CPK = require("contract-proxy-kit-custom");

// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chaFi"
const { expect } = require("chai");

describe("Transfering ETH out of GnosisSafe", function () {
  // No timeout for Mocha due to Rinkeby mining latency
  this.timeout(0);

  // We use our User Wallet. Per our config this wallet is at the accounts index 0
  // and hence will be used by default for all transactions we send.
  let myUserWallet;
  let myUserAddress;

  // 2) We will deploy a GnosisSafeProxy using the Factory, or if we already deployed
  //  one, we will use that one.
  let cpk;

  before(async function () {
    // We get our User Wallet from the Buidler Runtime Env
    [myUserWallet] = await bre.ethers.getSigners();
    myUserAddress = await myUserWallet.getAddress();

    // Create CPK instance connected to new mastercopy
    cpk = await CPK.create({ ethers, signer: myUserWallet });
    expect(await cpk.getOwnerAccount()).to.be.equal(myUserAddress);

    const codeAtProxy = await bre.ethers.provider.getCode(cpk.address);
    const proxyDeployed = codeAtProxy === "0x" ? false : true;

    console.log(`
      \n Network:           ${bre.network.name}\
      \n CPK Proxy address: ${cpk.address}\
      \n Proxy deployed?:  ${proxyDeployed}\n
    `);

    if (proxyDeployed === false) {
      console.error("Need `yarn setup-proxy` first");
      process.exit(1);
    }
  });

  it("Transfer funds from GnosisSafe", async function () {
    const prevFundsInUserProxy = await ethers.provider.getBalance(cpk.address);
    console.log(
      `Current funds in GnosisSafe: ${utils.formatEther(
        prevFundsInUserProxy
      )} ETH`
    );

    if (prevFundsInUserProxy.eq("0")) {
      console.log(
        `❌ GnosisSafe ${cpk.address} has no funds on ${bre.network.name}`
      );
      process.exit(1);
    }

    console.log(
      `\n Transferring ${utils.formatEther(
        prevFundsInUserProxy
      )} ETH to ${myUserAddress} on ${bre.network.name}`
    );
    try {
      const tx = await cpk.execTransactions([
        {
          operation: CPK.CALL,
          to: myUserAddress,
          value: prevFundsInUserProxy,
          data: "0x",
        },
      ]);
      // Wait for mining
      console.log(`Tx Hash: ${tx.hash}`);
      await tx.transactionResponse.wait();

      const fundsInUserProxy = await ethers.provider.getBalance(cpk.address);
      expect(fundsInUserProxy).to.be.equal(0);
      console.log(`New funds in GnosisSafe at ${cpk.address}`);
      console.log(`${utils.formatEther(fundsInUserProxy)} ETH`);
    } catch (error) {
      console.error("\n GnosisSafe transfer funds error ❌  \n", error);
      process.exit(1);
    }
  });
});
