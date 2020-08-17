// We require the Buidler Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `buidler run <script>` you'll find the Buidler
// Runtime Environment's members available in the global scope.
const bre = require("@nomiclabs/buidler");
const ethers = bre.ethers;
const { utils } = require("ethers");
const fetch = require("node-fetch");

// CPK Library
const CPK = require("contract-proxy-kit");

// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chaFi"
const { expect } = require("chai");

const GelatoCoreLib = require("@gelatonetwork/core");

const GELATO = bre.network.config.deployments.GelatoCore;

// Current Gelato Gas Price
let currentGelatoGasPrice;

// TRIGGER GAS PRICE
let triggerGasPrice;

// The Graph query
const taskWrapperQuery = (proxyAddress) => {
  return `
    {
        taskReceiptWrappers(where: {user: "${proxyAddress}"}) {
          taskReceipt {
            id
            userProxy
            provider {
              addr
              module
            }
            index
            tasks {
              conditions {
                inst
                data
              }
              actions {
                addr
                data
                operation
                dataFlow
                value
                termsOkCheck
              }
              selfProviderGasLimit
              selfProviderGasPriceCeil
            }
            expiryDate
            cycleId
            submissionsLeft
          }
          submissionHash
          status
          submissionDate
          executionDate
          executionHash
          selfProvided
        }
    }`;
};

describe("Canceling ActionCHIMint Task on Gelato via GnosisSafe", function () {
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

    const codeAtProxy = bre.ethers.provider.getCode(cpk.address);
    const proxyDeployed = codeAtProxy === "0x" ? false : true;

    console.log(`
      \n Network:           ${bre.network.name}\
      \n CPK Proxy address: ${cpk.address}\
      \n Proxy deployed?:  ${proxyDeployed}\n
    `);

    gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      network.config.deployments.GelatoCore // the Rinkeby Address of the deployed GelatoCore
    );

    currentGelatoGasPrice = await bre.run("fetchGelatoGasPrice");

    // FOR TESTING WE SET IT EQUAL TO CURRENT SO WE CAN CHECK FOR EXECUTION
    triggerGasPrice = currentGelatoGasPrice;
  });

  // Submit your Task to Gelato via your GelatoUserProxy
  it("User cancels Task as SelfProvider", async function () {
    // 1. Fetch all taskReceipts that the UserProxy has submitted
    const response = await fetch(
      `https://api.thegraph.com/subgraphs/name/gelatodigital/gelato-network-rinkeby`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: taskWrapperQuery(cpk.address.toLowerCase()),
        }),
      }
    );

    // 2. Convert Response to Json and get taskReceiptWrappers
    const json = await response.json();
    const taskReceiptWrappers = json.data.taskReceiptWrappers;
    console.log(taskReceiptWrappers);

    // 3. Select only the CHi Tasks
    let actionChiMint = await deployments.get("ActionChiMint");
    const chiActionWrappers = taskReceiptWrappers.filter(
      (wrapper) =>
        utils.getAddress(wrapper.taskReceipt.tasks[0].actions[0].addr) ===
        utils.getAddress(actionChiMint.address)
    );
    // console.log(chiActionWrappers);

    // 4. Get first Chi Task where status == 'awaitingExec'
    const taskReceiptWrapper = chiActionWrappers.find(
      (wrapper) => wrapper.status === "awaitingExec"
    );

    console.log(taskReceiptWrapper);

    if (taskReceiptWrapper) {
      try {
        // 5. Decode Task Receipt
        const chiActionInputs = ethers.utils.defaultAbiCoder.decode(
          ["address", "uint256"],
          ethers.utils.hexDataSlice(
            taskReceiptWrapper.taskReceipt.tasks[0].actions[0].data,
            4
          )
        );

        console.log(`Recipient: ${chiActionInputs[0]}`);
        console.log(`Chi Amount: ${chiActionInputs[1]}`);

        // 6. Cancel Task on gelato if there is a pending task to cancel
        const tx = await cpk.execTransactions([
          {
            operation: CPK.CALL,
            to: GELATO,
            value: 0,
            data: await bre.run("abi-encode-withselector", {
              abi: GelatoCoreLib.GelatoCore.abi,
              functionname: "cancelTask",
              inputs: [taskReceiptWrapper.taskReceipt],
            }),
          },
        ]);
        // Wait for mining
        console.log(`Cancel Task Receipt Tx Hash: ${tx.hash}`);
        await tx.transactionResponse.wait();
        console.log(`Cancel Task Receipt Success!`);
      } catch (error) {
        console.error("\n PRE Cancel Task Receipt error ❌  \n", error);
        process.exit(1);
      }
    }
  });
});
