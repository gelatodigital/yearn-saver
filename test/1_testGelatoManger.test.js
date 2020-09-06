// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
const { expect } = require("chai");
const bre = require("@nomiclabs/buidler");
const { ethers } = bre;
const GelatoCoreLib = require("@gelatonetwork/core");
const { sleep, Operation, DataFlow } = GelatoCoreLib;
const executoNetworkAbi = require("../pre-compiles/PermissionedExecutors.json")
  .abi;
const conditionAbi = require("../artifacts/ConditionYETHStratRepay.json").abi;
const gelatoManagerAbi = require("../artifacts/GelatoManager.json").abi;

describe("Setup", function () {
  this.timeout(500000);
  if (bre.network.name !== "ganache") {
    console.error("Test Suite is meant to be run on ganache only");
    process.exit(1);
  }

  let gov;
  let userAddress;
  let yearnDegan;
  let yearnDeganAddress;
  let gelatoCore;
  let conditionYETHStratRepay;
  let gelatoManager;
  let executor;
  let executorAddress;
  let executorNode;
  let executorContract;
  let sighash;

  before(async function () {
    // Get Test Wallet for local testnet
    [gov, yearnDegan] = await ethers.getSigners();

    yearnDeganAddress = await yearnDegan.getAddress();

    executor = await ethers.provider.getSigner(
      bre.network.config.GelatoExecNetwork
    );

    executorNode = await ethers.provider.getSigner(
      bre.network.config.GelatoExecNode
    );

    executorAddress = await executor.getAddress();

    gelatoSysAdmin = await ethers.provider.getSigner(
      bre.network.config.GelatoSysAdmin
    );

    // ===== GELATO LOCAL SETUP ==================
    gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      bre.network.config.GelatoCore
    );

    executorContract = await ethers.getContractAt(
      executoNetworkAbi,
      bre.network.config.GelatoExecNetwork
    );

    // Deploy ConditionYETHStratRepay to local testnet
    conditionYETHStratRepay = await ethers.getContractAt(
      conditionAbi,
      bre.network.config.ConditionYETHStratRepay
    );

    // Deploy GelatoManager to local testnet
    gelatoManager = await ethers.getContractAt(
      gelatoManagerAbi,
      bre.network.config.YearnGelatoManager
    );

    // submit Task to Gelato
    // ConditionYETHStratRepay.sol
    const condition = {
      inst: conditionYETHStratRepay.address,
      data: ethers.constants.HashZero,
    };

    const stratInterface = new ethers.utils.Interface(["function repay()"]);

    sighash = stratInterface.getSighash("repay()");

    // 0x932fc4fd0eEe66F22f1E23fBA74D7058391c0b15
    const action = {
      addr: bre.network.config.StrategyMKRVaultDAIDelegate,
      data: sighash,
      operation: Operation.Call,
      dataFlow: DataFlow.None,
      value: 0,
      termsOkCheck: false,
    };

    const task = {
      conditions: [condition],
      actions: [action],
      selfProviderGasLimit: 0,
      selfProviderGasPriceCeil: 0,
    };

    const provider = {
      addr: gelatoManager.address,
      module: bre.network.config.GelatoUserProxyProviderModule,
    };

    // Submit the Task to Gelato
    expect(bre.network.config.GelatoSysAdmin).to.be.equal(
      await gelatoManager.governance()
    );

    const submitTx = await gelatoManager
      .connect(gelatoSysAdmin)
      .submitTaskCycle(provider, [task], 0, 0);
    await submitTx.wait();
  });

  it("#1: Condition should return: 'ConditionYETHStratRepay: No repay necessary' if Strategy is sufficiently collateralized", async function () {
    const result = await conditionYETHStratRepay.shouldRepay();

    expect(result).to.be.equal(false);
  });

  it("#2: Random address can fund GelatoManager", async function () {
    const yearnDeganEthBalance = await yearnDegan.provider.getBalance(
      await yearnDegan.getAddress()
    );

    const botGelatoBalancePre = await gelatoCore.providerFunds(
      gelatoManager.address
    );
    const newFunds = ethers.utils.parseEther("5");
    const tx = await gelatoManager.connect(yearnDegan).provideFunds({
      value: newFunds,
    });
    await tx.wait();

    const botGelatoBalancePost = await gelatoCore.providerFunds(
      gelatoManager.address
    );
    expect(botGelatoBalancePre.add(newFunds)).to.be.equal(botGelatoBalancePost);
  });

  it("#3: Test if action executes if condition returns true", async function () {
    // Deploy new Condition
    const MockStrategy = await ethers.getContractFactory("MockStrategy");
    const mockStrategy = await MockStrategy.deploy(0);
    await mockStrategy.deployed();

    const ConditionYETHStratRepay2 = await ethers.getContractFactory(
      "ConditionYETHStratRepay"
    );
    const conditionYETHStratRepay2 = await ConditionYETHStratRepay2.deploy(
      mockStrategy.address,
      gelatoCore.address
    );
    await conditionYETHStratRepay2.deployed();

    // Deploy new yearnSaver with Mock Strategy
    const GelatoManager = await ethers.getContractFactory(
      "GelatoManager",
      gelatoSysAdmin
    );
    const gelatoManagerTwo = await GelatoManager.deploy(gelatoCore.address);
    await gelatoManagerTwo.deployed();

    // Submit Task with New Manager
    // submit Task to Gelato
    // ConditionYETHStratRepay.sol
    const condition = {
      inst: conditionYETHStratRepay2.address,
      data: ethers.constants.HashZero,
    };

    // 0x932fc4fd0eEe66F22f1E23fBA74D7058391c0b15
    const action = {
      addr: bre.network.config.StrategyMKRVaultDAIDelegate,
      data: sighash,
      operation: Operation.Call,
      dataFlow: DataFlow.None,
      value: 0,
      termsOkCheck: false,
    };

    const task = {
      conditions: [condition],
      actions: [action],
      selfProviderGasLimit: 0,
      selfProviderGasPriceCeil: 0,
    };

    const provider = {
      addr: gelatoManagerTwo.address,
      module: bre.network.config.GelatoUserProxyProviderModule,
    };

    const assignExecTx = await gelatoManagerTwo
      .connect(gelatoSysAdmin)
      .assignExecutor(executorAddress);

    await assignExecTx.wait();

    const whitelistProvideModuleTx = await gelatoManagerTwo
      .connect(gelatoSysAdmin)
      .addProviderModules([bre.network.config.GelatoUserProxyProviderModule]);
    await whitelistProvideModuleTx.wait();

    const submitTx = await gelatoManagerTwo
      .connect(gelatoSysAdmin)
      .submitTaskCycle(provider, [task], 0, 0);
    await submitTx.wait();

    const currentGelatoId = await gelatoCore.currentTaskReceiptId();
    // Get Task Receipt Object from event
    let topics = gelatoCore.filters.LogTaskSubmitted(currentGelatoId).topics;
    let filter = {
      address: gelatoCore.address.toLowerCase(),
      topics,
    };

    let iface = new ethers.utils.Interface(GelatoCoreLib.GelatoCore.abi);

    let logs = await gov.provider.getLogs(filter);

    let log = logs[logs.length - 1];

    let event = iface.parseLog(log);

    const taskReceipt = event.args.taskReceipt;

    // fund gelatoManagerTwo
    const newFunds = ethers.utils.parseEther("5");
    const tx = await gelatoManagerTwo.connect(yearnDegan).provideFunds({
      value: newFunds,
    });
    await tx.wait();

    const gelatoGasPrice = await bre.run("fetchGelatoGasPrice");

    // ======= 📣 TASK EXECUTION 📣 =========
    // This stuff is normally automated by the Gelato Network and Dapp Developers
    // and their Users don't have to take care of it. However, for local testing
    // we simulate the Gelato Execution logic.

    let canExecResult = await gelatoCore
      .connect(executor)
      .canExec(
        taskReceipt,
        taskReceipt.tasks[0].selfProviderGasLimit,
        gelatoGasPrice
      );

    // Make Mock Strategy return that repay is necessarey

    const setTx = await mockStrategy.setRepayAmount(
      ethers.utils.parseUnits("100", "18")
    );
    await setTx.wait();

    canExecResult = await gelatoCore
      .connect(executor)
      .canExec(
        taskReceipt,
        taskReceipt.tasks[0].selfProviderGasLimit,
        gelatoGasPrice
      );

    expect(canExecResult).to.be.equal("OK");

    // Fund Executor to execute tx's

    await expect(
      executorContract.connect(executorNode).exec(taskReceipt, {
        gasPrice: gelatoGasPrice,
        gasLimit: 6000000,
      })
    );

    // Get Task Receipt Object from event
    topics = gelatoCore.filters.LogExecSuccess(executorAddress).topics;
    filter = {
      address: gelatoCore.address.toLowerCase(),
      topics,
    };

    iface = new ethers.utils.Interface(GelatoCoreLib.GelatoCore.abi);

    logs = await gov.provider.getLogs(filter);

    log = logs[logs.length - 1];

    event = iface.parseLog(log);

    const taskReceiptId = event.args.taskReceiptId;

    expect(taskReceiptId).to.be.equal(currentGelatoId);
  });

  it("#4: Governance should be able to withdraw funds", async function () {
    // If not governance, tx should revert
    await expect(
      gelatoManager
        .connect(yearnDegan)
        .withdrawFunds(ethers.utils.parseEther("0.5"), yearnDeganAddress)
    ).to.be.reverted;

    // If not governance, tx should succeed
    await expect(
      gelatoManager
        .connect(gov)
        .withdrawFunds(ethers.utils.parseEther("0.5"), yearnDeganAddress)
    );
  });
});
