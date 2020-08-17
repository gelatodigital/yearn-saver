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
const EXECUTOR = bre.network.config.addressBook.gelatoExecutor.default;
const PROVIDER_MODULE_GNOSIS =
  bre.network.config.deployments.ProviderModuleGnosisSafeProxy;

// The gas limit for our automated CHI.mint TX
// ActionChiMint caps chiAmount to 140 CHI => 6 mio gas should always suffice
const CHI_TOKENS_TO_MINT = 10; // should be kept below 140 MAX!
const PER_CHI_GAS_EST = 50000;
const GELATO_OVERHEAD = 200000;
const SELF_PROVIDER_GAS_LIMIT = utils.bigNumberify(
  PER_CHI_GAS_EST * CHI_TOKENS_TO_MINT + GELATO_OVERHEAD
);

// Current Gelato Gas Price
let currentGelatoGasPrice;

// TRIGGER GAS PRICE
let triggerGasPrice;

describe("Submitting ActionCHIMint Task to Gelato via GnosisSafe", function () {
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

    currentGelatoGasPrice = await bre.run("fetchGelatoGasPrice");
    console.log(`Current Price: ${currentGelatoGasPrice.toString()}`);

    triggerGasPrice = currentGelatoGasPrice.sub(utils.parseUnits("4", "Gwei"));
    console.log(`Trigger Price: ${triggerGasPrice.toString()}`);
  });

  // Submit your Task to Gelato via your GelatoUserProxy
  it("User submits Task as SelfProvider", async function () {
    // First we want to make sure that the Task we want to submit actually has
    // a valid Provider, so we need to ask GelatoCore some questions about the Provider.

    // For our Task to be executable, our Provider must have sufficient funds on Gelato
    const providerIsLiquid = await gelatoCore.isProviderLiquid(
      cpk.address,
      SELF_PROVIDER_GAS_LIMIT, // we need roughtly estimatedGasPerExecution * 3 executions as balance on gelato
      triggerGasPrice
    );
    if (!providerIsLiquid) {
      console.log(
        "\n ❌  Ooops! Your GnosisSafe needs to provide more funds to Gelato \n"
      );
      console.log("DEMO: run this command: `yarn setup-proxy` first");
      process.exit(1);
    }

    // For the Demo, make sure the Provider has the Gelato default Executor assigned
    const assignedExecutor = await gelatoCore.executorByProvider(cpk.address);
    if (assignedExecutor !== EXECUTOR) {
      console.log(
        "\n ❌  Ooops! Your GnosisSafe needs to assign the gelato default Executor \n"
      );
      console.log("DEMO: run this command: `yarn setup-proxy` first");
      process.exit(1);
    }

    // For the Demo, our Provider must use the deployed ProviderModuleGelatoUserProxy
    const userProxyModuleIsProvided = await gelatoCore.isModuleProvided(
      cpk.address,
      PROVIDER_MODULE_GNOSIS
    );
    if (!userProxyModuleIsProvided) {
      console.log(
        "\n ❌  Ooops! Your GnosisSafe still needs to add ProviderModuleGelatoUserProxy \n"
      );
      console.log("DEMO: run this command: `yarn setup-proxy` first");
      process.exit(1);
    }

    // The transaction to submit a Task to Gelato
    if (
      providerIsLiquid &&
      assignedExecutor === EXECUTOR &&
      userProxyModuleIsProvided
    ) {
      // To submit Tasks to  Gelato we need to instantiate a GelatoProvider object
      const myGelatoProvider = new GelatoCoreLib.GelatoProvider({
        addr: cpk.address, // This time, the provider is paying for the Task, hence we input the Providers address
        module: PROVIDER_MODULE_GNOSIS,
      });

      let actionChiMint = await deployments.get("ActionChiMint");
      actionChiMint = await bre.ethers.getContractAt(
        actionChiMint.abi,
        actionChiMint.address
      );

      // Specify and Instantiate the Gelato Task
      const taskAutoMintCHIWhenTriggerGasPrice = new GelatoCoreLib.Task({
        actions: [
          new GelatoCoreLib.Action({
            addr: actionChiMint.address,
            data: await actionChiMint.getActionData(
              myUserAddress, // recipient of CHI Tokens
              CHI_TOKENS_TO_MINT // CHI Tokens to be minted
            ),
            operation: GelatoCoreLib.Operation.Delegatecall,
            termsOkCheck: false,
          }),
        ],
        selfProviderGasLimit: SELF_PROVIDER_GAS_LIMIT,
        // This makes sure we only mint CHI when the gelatoGasPrice is at or below
        // our desired trigger gas price
        selfProviderGasPriceCeil: triggerGasPrice,
      });

      // Specify ExpiryDate: 0 for infinite validity
      const EXPIRY_DATE = 0;

      // Submit Task to gelato
      try {
        const tx = await cpk.execTransactions([
          {
            operation: CPK.CALL,
            to: GELATO,
            value: 0,
            data: await bre.run("abi-encode-withselector", {
              abi: GelatoCoreLib.GelatoCore.abi,
              functionname: "submitTask",
              inputs: [
                myGelatoProvider,
                taskAutoMintCHIWhenTriggerGasPrice,
                EXPIRY_DATE,
              ],
            }),
          },
        ]);
        // Wait for mining
        console.log(`SubmitTask Tx Hash: ${tx.hash}`);
        await tx.transactionResponse.wait();
      } catch (error) {
        console.error("\n PRE taskSubmissionTx error ❌  \n", error);
        process.exit(1);
      }
    }
  });
});
