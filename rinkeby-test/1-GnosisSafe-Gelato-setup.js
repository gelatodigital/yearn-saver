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

const FUNDS_TO_DEPOSIT = utils.parseEther("1");

describe("Create a GnosisSafe via CPK and setup with Gelato", function () {
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
  });

  it("Gelato: Whitelist GnosisModule and setup (funds, executor, ProviderModule)", async function () {
    // Check if Gelato is already whitelisted as Safe Module
    let gelatoIsWhitelisted = false;
    if (proxyIsDeployed)
      gelatoIsWhitelisted = await gnosisSafe.isModuleEnabled(GELATO);
    if (gelatoIsWhitelisted === true)
      console.log(`✅ Gelato Safe Module ALREADY whitelisted.`);

    // Instantiate GelatoCore contract instance for sanity checks
    const gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      network.config.deployments.GelatoCore // the Rinkeby Address of the deployed GelatoCore
    );

    // Check current funding on Gelato
    const currentProviderFunds = await gelatoCore.providerFunds(cpk.address);
    const fundsAlreadyProvided = currentProviderFunds.gte(FUNDS_TO_DEPOSIT);
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

    // The single Transaction that:
    // 1) deploys a GnosisSafeProxy if not deployed
    // 2) enableModule(GELATO on GnosisSafe
    // 3) multiProvide(funds, executor, providerModuleGnosisSafeProxy) on Gelato
    if (
      !gelatoIsWhitelisted ||
      !fundsAlreadyProvided ||
      !isDefaultExecutorAssigned ||
      !isUserProxyModuleWhitelisted
    ) {
      try {
        console.log("\n Sending Transaction to setup UserProxy");

        let tx;
        if (!gelatoIsWhitelisted) {
          // If we have not enabled Gelato Module we enable it and then setup Gelato
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
                value: fundsAlreadyProvided ? 0 : FUNDS_TO_DEPOSIT,
                data: await bre.run("abi-encode-withselector", {
                  abi: GelatoCoreLib.GelatoCore.abi,
                  functionname: "multiProvide",
                  inputs: [
                    isDefaultExecutorAssigned
                      ? constants.AddressZero
                      : EXECUTOR,
                    [], // this can be left empty, as it is only relevant for external providers
                    isUserProxyModuleWhitelisted
                      ? []
                      : [PROVIDER_MODULE_GNOSIS],
                  ],
                }),
              },
            ],
            {
              value: fundsAlreadyProvided ? 0 : FUNDS_TO_DEPOSIT,
              gasLimit: 5000000,
            }
          );
        } else {
          // If we already enabled Gelato Module we only setup Gelato
          tx = await cpk.execTransactions(
            [
              {
                to: GELATO,
                operation: CPK.CALL,
                value: fundsAlreadyProvided ? 0 : FUNDS_TO_DEPOSIT,
                data: await bre.run("abi-encode-withselector", {
                  abi: GelatoCoreLib.GelatoCore.abi,
                  functionname: "multiProvide",
                  inputs: [
                    isDefaultExecutorAssigned
                      ? constants.AddressZero
                      : EXECUTOR,
                    [], // this can be left empty, as it is only relevant for external providers
                    isUserProxyModuleWhitelisted
                      ? []
                      : [PROVIDER_MODULE_GNOSIS],
                  ],
                }),
              },
            ],
            {
              value: fundsAlreadyProvided ? 0 : FUNDS_TO_DEPOSIT,
              gasLimit: 5000000,
            }
          );
        }

        // Wait for mining
        console.log("TX:", tx.hash);
        await tx.transactionResponse.wait();

        // Mined !
        // Make sure User is owner of deployed GnosisSafe
        gnosisSafe = await bre.ethers.getContractAt(
          bre.GnosisSafe.abi,
          cpk.address
        );
        expect(await gnosisSafe.isOwner(myUserAddress)).to.be.true;

        // GelatoModule whitelisted on GnosisSafe
        expect(await gnosisSafe.isModuleEnabled(GELATO)).to.be.true;
        console.log(`✅ Gelato GnosisModule whitelisted.`);

        // Provided Funds on Gelato
        expect(await gelatoCore.providerFunds(gnosisSafe.address)).to.be.gte(
          FUNDS_TO_DEPOSIT
        );
        console.log(
          `✅ Deposited ${utils.formatEther(FUNDS_TO_DEPOSIT)} ETH on gelato`
        );
        console.log(
          `Funds on Gelato: ${utils.formatEther(
            await gelatoCore.providerFunds(gnosisSafe.address)
          )} ETH`
        );

        // Gelato Default Executor assigned
        if (!isDefaultExecutorAssigned) {
          expect(
            await gelatoCore.executorByProvider(gnosisSafe.address)
          ).to.be.equal(EXECUTOR);
          console.log(`✅ Selected default execution network: ${EXECUTOR}`);
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
            `✅ Whitelisted ProviderModuleGnosisSafeProxy: ${PROVIDER_MODULE_GNOSIS}`
          );
        }

        // SUCCESS !
        console.log("\nUser Proxy succesfully set up ✅ \n");
      } catch (error) {
        console.error("\n Gelato UserProxy Setup Error ❌  \n", error);
        process.exit(1);
      }
    } else {
      console.log("\n✅ UserProxy ALREADY fully set up on Gelato \n");
    }
  });
});
