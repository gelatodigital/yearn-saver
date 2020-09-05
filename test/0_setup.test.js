// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
const { expect } = require("chai");
const bre = require("@nomiclabs/buidler");
const { ethers } = bre;
const GelatoCoreLib = require("@gelatonetwork/core");
const { sleep } = GelatoCoreLib;
const executoNetworkAbi = require("../pre-compiles/PermissionedExecutors.json")
  .abi;

// Constants

// Contracts

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
  let yearnSaverBot;
  let executor;
  let executorAddress;
  let executorNode;
  let executorContract;

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
    const ConditionYETHStratRepay = await ethers.getContractFactory(
      "ConditionYETHStratRepay"
    );
    conditionYETHStratRepay = await ConditionYETHStratRepay.deploy(
      bre.network.config.StrategyMKRVaultDAIDelegate,
      gelatoCore.address
    );
    await conditionYETHStratRepay.deployed();

    // Deploy YearnSaverBot to local testnet
    const YearnSaverBot = await ethers.getContractFactory("YearnSaverBot", gov);
    yearnSaverBot = await YearnSaverBot.deploy(
      gelatoCore.address,
      bre.network.config.StrategyMKRVaultDAIDelegate,
      [bre.network.config.GelatoUserProxyProviderModule],
      conditionYETHStratRepay.address,
      {
        value: ethers.utils.parseEther("1"),
      }
    );
    await yearnSaverBot.deployed();
  });

  it("#1: Condition should return: 'ConditionYETHStratRepay: No repay necessary' if Strategy is sufficiently collateralized", async function () {
    const result = await conditionYETHStratRepay.shouldRepay();
    console.log(result);
    expect(result).to.be.equal(false);
  });

  it("#2: Random address can fund YearnSaverBot", async function () {
    const yearnDeganEthBalance = await yearnDegan.provider.getBalance(
      await yearnDegan.getAddress()
    );

    const botGelatoBalancePre = await gelatoCore.providerFunds(
      yearnSaverBot.address
    );
    const newFunds = ethers.utils.parseEther("5");
    const tx = await yearnSaverBot.connect(yearnDegan).provideFunds({
      value: newFunds,
    });
    await tx.wait();

    const botGelatoBalancePost = await gelatoCore.providerFunds(
      yearnSaverBot.address
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
    const YearnSaverBot = await ethers.getContractFactory("YearnSaverBot");
    const yearnSaverBot2 = await YearnSaverBot.deploy(
      gelatoCore.address,
      bre.network.config.StrategyMKRVaultDAIDelegate,
      [bre.network.config.GelatoUserProxyProviderModule],
      conditionYETHStratRepay2.address
    );
    await yearnSaverBot2.deployed();

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

    console.log(taskReceipt.userProxy);

    console.log(yearnSaverBot2.address);

    // fund yearnSaverBot2
    const newFunds = ethers.utils.parseEther("5");
    const tx = await yearnSaverBot2.connect(yearnDegan).provideFunds({
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

    canExecResult = await gelatoCore
      .connect(executor)
      .canExec(
        taskReceipt,
        taskReceipt.tasks[0].selfProviderGasLimit,
        gelatoGasPrice
      );

    console.log(canExecResult);

    // Get Task Receipt Object from event
    topics = gelatoCore.filters.LogExecSuccess(executorAddress).topics;
    filter = {
      address: gelatoCore.address.toLowerCase(),
      topics,
    };

    iface = new ethers.utils.Interface(GelatoCoreLib.GelatoCore.abi);

    logs = await gov.provider.getLogs(filter);

    console.log(logs);

    log = logs[logs.length - 1];

    event = iface.parseLog(log);

    const taskReceiptId = event.args.taskReceiptId;

    expect(taskReceiptId).to.be.equal(currentGelatoId);
  });

  it("#4: Governance should be able to withdraw funds", async function () {
    // If not governance, tx should revert
    await expect(
      yearnSaverBot
        .connect(yearnDegan)
        .withdrawFunds(ethers.utils.parseEther("0.5"), yearnDeganAddress)
    ).to.be.reverted;

    // If not governance, tx should succeed
    await expect(
      yearnSaverBot
        .connect(gov)
        .withdrawFunds(ethers.utils.parseEther("0.5"), yearnDeganAddress)
    );
  });
});
