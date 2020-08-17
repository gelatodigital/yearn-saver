// We require the Buidler Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `buidler run <script>` you'll find the Buidler
// Runtime Environment's members available in the global scope.
const bre = require("@nomiclabs/buidler");
const ethers = bre.ethers;
const { constants, utils } = require("ethers");

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

// FUNDS TO DEPOSIT
let fundsToDeposit = 0;

describe("1-click anything for auto-minting CHI", function () {
  // No timeout for Mocha due to Rinkeby mining latency
  this.timeout(0);

  // We use our User Wallet. Per our config this wallet is at the accounts index 0
  // and hence will be used by default for all transactions we send.
  let myUserWallet;
  let myUserAddress;

  // 2) We will deploy a GnosisSafeProxy using the Factory, or if we already deployed
  //  one, we will use that one.
  let cpk;
  let gnosisSafe;
  let proxyIsDeployed;

  let gelatoCore;

  before(async function () {
    // We get our User Wallet from the Buidler Runtime Env
    [myUserWallet] = await bre.ethers.getSigners();
    myUserAddress = await myUserWallet.getAddress();

    // Create CPK instance connected to new mastercopy
    cpk = await CPK.create({ ethers, signer: myUserWallet });
    expect(await cpk.getOwnerAccount()).to.be.equal(myUserAddress);

    const codeAtProxy = await bre.ethers.provider.getCode(cpk.address);
    proxyIsDeployed = codeAtProxy === "0x" ? false : true;

    if (proxyIsDeployed) {
      gnosisSafe = await bre.ethers.getContractAt(
        bre.GnosisSafe.abi,
        cpk.address
      );
      expect(await gnosisSafe.isOwner(myUserAddress)).to.be.true;
    }

    console.log(`
      \n Network:           ${bre.network.name}\
      \n CPK Proxy address: ${cpk.address}\
      \n Proxy deployed?:   ${proxyIsDeployed}\n
    `);

    gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      network.config.deployments.GelatoCore // the Rinkeby Address of the deployed GelatoCore
    );

    currentGelatoGasPrice = await bre.run("fetchGelatoGasPrice");

    // FOR TESTING WE SET IT EQUAL TO CURRENT SO WE CAN CHECK FOR EXECUTION
    triggerGasPrice = currentGelatoGasPrice;

    // FUNDS TO DEPOSIT
    fundsToDeposit = await gelatoCore.minExecProviderFunds(
      SELF_PROVIDER_GAS_LIMIT,
      triggerGasPrice
    );
  });

  it("In a single tx: [deployProxy], whitelist GnosisModule, setup Gelato, submitTask", async function () {
    // Check if Gelato is already whitelisted as Safe Module
    let gelatoIsWhitelisted = false;
    if (proxyIsDeployed)
      gelatoIsWhitelisted = await gnosisSafe.isModuleEnabled(GELATO);
    if (gelatoIsWhitelisted === true)
      console.log(`✅ Gelato Safe Module ALREADY whitelisted.`);

    // Check current funding on Gelato
    const currentProviderFunds = await gelatoCore.providerFunds(cpk.address);
    const fundsAlreadyProvided = currentProviderFunds.gte(fundsToDeposit);
    if (fundsAlreadyProvided) {
      console.log(
        `\n ✅ Already provided ${utils.formatEther(
          currentProviderFunds
        )} ETH on Gelato`
      );
    }

    // Check if SelfProvider UserProxy already has Default Executor assigned
    const assignedExecutor = await gelatoCore.executorByProvider(
      cpk.address // As the User is being his own provider, we will use the userProxy's address as the provider address
    );
    const isDefaultExecutorAssigned =
      utils.getAddress(assignedExecutor) === utils.getAddress(EXECUTOR)
        ? true
        : false;
    if (isDefaultExecutorAssigned)
      console.log("\n ✅Default Executor ALREADY assigned");

    const isExecutorValid = await gelatoCore.isExecutorMinStaked(EXECUTOR);
    if (!isExecutorValid) {
      console.error("❌ Executor is not minStaked");
      process.exit(1);
    }

    // If the user wants to use Gelato through their GnosisSafe,
    // he needs to register the ProviderModuleGnosisSafeProxy
    // to make his GnosisSafe compatible with Gelato. Here we check,
    // if the User already enabled the ProviderModuleGnosisSafeProxy.
    // If not, we will enable it in the upcoming Tx.
    const isUserProxyModuleWhitelisted = await gelatoCore.isModuleProvided(
      cpk.address,
      PROVIDER_MODULE_GNOSIS
    );
    if (isUserProxyModuleWhitelisted)
      console.log("\n ✅ UserProxyModule ALREADY whitelisted");

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

    // The single Transaction that:
    // 1) deploys a GnosisSafeProxy if not deployed
    // 2) enableModule(GELATO on GnosisSafe
    // 3) multiProvide(funds, executor, providerModuleGnosisSafeProxy) on Gelato
    // 4) submitTask to GELATO

    try {
      let tx;
      if (!gelatoIsWhitelisted) {
        // If we have not enabled Gelato Module we enable it and then setup Gelato
        // and submitTask
        console.log(
          "\n Sending TX to whitelist Gelato Gnosis Module, setup UserProxy and submitTask"
        );
        tx = await cpk.execTransactions(
          [
            {
              to: cpk.address,
              operation: CPK.CALL,
              value: 0,
              data: await bre.run("abi-encode-withselector", {
                abi: bre.GnosisSafe.abi,
                functionname: "enableModule",
                inputs: [GELATO],
              }),
            },
            {
              to: GELATO,
              operation: CPK.CALL,
              value: fundsAlreadyProvided ? 0 : fundsToDeposit,
              data: await bre.run("abi-encode-withselector", {
                abi: GelatoCoreLib.GelatoCore.abi,
                functionname: "multiProvide",
                inputs: [
                  isDefaultExecutorAssigned ? constants.AddressZero : EXECUTOR,
                  [], // this can be left empty, as it is only relevant for external providers
                  isUserProxyModuleWhitelisted ? [] : [PROVIDER_MODULE_GNOSIS],
                ],
              }),
            },
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
          ],
          {
            value: fundsAlreadyProvided ? 0 : fundsToDeposit,
            gasLimit: 5000000,
          }
        );
      } else if (
        !fundsAlreadyProvided ||
        !isDefaultExecutorAssigned ||
        !isUserProxyModuleWhitelisted
      ) {
        // If we already enabled Gelato Module we only setup Gelato and submitTask
        console.log("\n Sending TX to setup UserProxy and submitTask");

        tx = await cpk.execTransactions(
          [
            {
              to: GELATO,
              operation: CPK.CALL,
              value: fundsAlreadyProvided ? 0 : fundsToDeposit,
              data: await bre.run("abi-encode-withselector", {
                abi: GelatoCoreLib.GelatoCore.abi,
                functionname: "multiProvide",
                inputs: [
                  isDefaultExecutorAssigned ? constants.AddressZero : EXECUTOR,
                  [], // this can be left empty, as it is only relevant for external providers
                  isUserProxyModuleWhitelisted ? [] : [PROVIDER_MODULE_GNOSIS],
                ],
              }),
            },
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
          ],
          {
            value: fundsAlreadyProvided ? 0 : fundsToDeposit,
            gasLimit: 5000000,
          }
        );
      } else {
        // If we already enabled Gelato Module and already setup Gelato
        console.log("\n Sending TX to submitTask");

        tx = await cpk.execTransactions(
          [
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
          ],
          {
            value: fundsAlreadyProvided ? 0 : fundsToDeposit,
            gasLimit: 5000000,
          }
        );
      }

      // Wait for mining
      console.log("📓 all-in-one TX:", tx.hash);
      await tx.transactionResponse.wait();

      // Mined !
      // Make sure User is owner of deployed GnosisSafe
      gnosisSafe = await bre.ethers.getContractAt(
        bre.GnosisSafe.abi,
        cpk.address
      );
      expect(await gnosisSafe.isOwner(myUserAddress)).to.be.true;

      // GelatoModule whitelisted on GnosisSafe
      if (!gelatoIsWhitelisted) {
        expect(await gnosisSafe.isModuleEnabled(GELATO)).to.be.true;
        console.log(`✅ Tx: Gelato GnosisModule whitelisted.`);
      }

      // Provided Funds on Gelato
      if (!fundsAlreadyProvided) {
        expect(await gelatoCore.providerFunds(gnosisSafe.address)).to.be.gte(
          fundsToDeposit
        );
        console.log(
          `✅ Tx: Deposited ${utils.formatEther(fundsToDeposit)} ETH on gelato`
        );
        console.log(
          `Funds on Gelato: ${utils.formatEther(
            await gelatoCore.providerFunds(gnosisSafe.address)
          )} ETH`
        );
      }

      // Gelato Default Executor assigned
      if (!isDefaultExecutorAssigned) {
        expect(
          await gelatoCore.executorByProvider(gnosisSafe.address)
        ).to.be.equal(EXECUTOR);
        console.log(`✅ Tx: Selected default execution network: ${EXECUTOR}`);
      }

      // ProviderModuleGnosisSafeProxy whitelisted on Gelato
      if (!isUserProxyModuleWhitelisted) {
        expect(
          await gelatoCore.isModuleProvided(
            gnosisSafe.address,
            PROVIDER_MODULE_GNOSIS
          )
        ).to.be.true;
        console.log(
          `✅ Tx: Whitelisted ProviderModuleGnosisSafeProxy: ${PROVIDER_MODULE_GNOSIS}`
        );
      }

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
        process.exit(1);
      }

      // SUCCESS !
      console.log("\nUser Proxy succesfully set up and Task Submitted ✅ \n");
    } catch (error) {
      console.error("\n Gelato UserProxy Setup Error ❌  \n", error);
      process.exit(1);
    }
  });
});
