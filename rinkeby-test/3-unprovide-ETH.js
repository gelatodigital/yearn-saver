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

const GelatoCoreLib = require("@gelatonetwork/core");

const GELATO = bre.network.config.deployments.GelatoCore;

describe("Unproviding ETH deposited on Gelato via GnosisSafe", function () {
  // No timeout for Mocha due to Rinkeby mining latency
  this.timeout(0);

  // We use our User Wallet. Per our config this wallet is at the accounts index 0
  // and hence will be used by default for all transactions we send.
  let myUserWallet;
  let myUserAddress;

  // 2) We will deploy a GnosisSafeProxy using the Factory, or if we already deployed
  //  one, we will use that one.
  let cpk;

  let gelatoCore;

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

    gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      network.config.deployments.GelatoCore // the Rinkeby Address of the deployed GelatoCore
    );
  });

  it("Withdraws funds from Gelato and transfer to User", async function () {
    const fundsOnGelato = await gelatoCore.providerFunds(cpk.address);
    console.log(
      `Current funds on Gelato: ${utils.formatEther(fundsOnGelato)} ETH`
    );

    const prevUserWalletBalance = await myUserWallet.getBalance();
    console.log(
      `Current funds in User Wallet: ${utils.formatEther(
        prevUserWalletBalance
      )} ETH`
    );

    if (fundsOnGelato.eq("0")) {
      console.log(
        `❌ GnosisSafe ${cpk.address} has no funds on Gelato on ${bre.network.name}`
      );
      process.exit(1);
    }

    console.log(
      `\n Withdrawing ${utils.formatEther(fundsOnGelato)} ETH to userWallet`
    );
    try {
      const tx = await cpk.execTransactions(
        [
          {
            operation: CPK.CALL,
            to: GELATO,
            value: 0,
            data: await bre.run("abi-encode-withselector", {
              abi: GelatoCoreLib.GelatoCore.abi,
              functionname: "unprovideFunds",
              inputs: [fundsOnGelato],
            }),
          },
          {
            operation: CPK.CALL,
            to: myUserAddress,
            value: fundsOnGelato,
            data: "0x",
          },
        ],
        { gasLimit: 2000000 }
      );
      // Wait for mining
      await tx.transactionResponse.wait();
      console.log(`Tx Hash: ${tx.hash}`);

      const newFundsOnGelato = await gelatoCore.providerFunds(cpk.address);
      expect(newFundsOnGelato).to.be.equal(0);
      console.log(
        `New funds in Gelato: ${utils.formatEther(newFundsOnGelato)} ETH`
      );

      const userWalletBalance = await myUserWallet.getBalance();
      expect(userWalletBalance).to.be.gt(prevUserWalletBalance);
      console.log(
        `Funds in UserWallet: ${utils.formatEther(userWalletBalance)} ETH`
      );
    } catch (error) {
      console.error("\n Gelato unprovideFunds error ❌  \n", error);
      process.exit(1);
    }
  });
});
