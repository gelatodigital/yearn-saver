// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
const { expect } = require("chai");
const bre = require("@nomiclabs/buidler");
const { ethers } = bre;
const GelatoCoreLib = require("@gelatonetwork/core");
const { sleep } = GelatoCoreLib;

// Constants

// Contracts

describe("Setup", function () {
  this.timeout(500000);
  if (bre.network.name !== "ganache") {
    console.error("Test Suite is meant to be run on ganache only");
    process.exit(1);
  }

  let userWallet;
  let userAddress;
  let yearnDegan;
  let gelatoCore;
  let conditionYETHStratRepay;
  let yearnSaverBot;
  let executor;

  before(async function () {
    // Get Test Wallet for local testnet
    [userWallet, yearnDegan] = await ethers.getSigners();

    userAddress = await userWallet.getAddress();

    executor = await ethers.provider.getSigner(
      bre.network.config.GelatoExecNetwork
    );

    // ===== GELATO LOCAL SETUP ==================
    gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      bre.network.config.GelatoCore
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
    const YearnSaverBot = await ethers.getContractFactory("YearnSaverBot");
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
    console.log(yearnDeganEthBalance.toString());

    const botGelatoBalancePre = await gelatoCore.providerFunds(
      yearnSaverBot.address
    );
    console.log(botGelatoBalancePre.toString());
    const newFunds = ethers.utils.parseEther("5");
    const tx = await yearnSaverBot.connect(yearnDegan).provideFunds({
      value: newFunds,
    });
    await tx.wait();

    const botGelatoBalancePost = await gelatoCore.providerFunds(
      yearnSaverBot.address
    );
    console.log(botGelatoBalancePost.toString());
    expect(botGelatoBalancePre.add(newFunds)).to.be.equal(botGelatoBalancePost);
  });

  it("#3: Test if action executes if condition returns true", async function () {
    // Deploy new Condition
    const MockStrategy = await ethers.getContractFactory("MockStrategy");
    const mockStrategy = await MockStrategy.deploy(0);
    await mockStrategy.deployed();

    // Deploy new yearnSaver with Mock Strategy
    const YearnSaverBot = await ethers.getContractFactory("YearnSaverBot");
    yearnSaverBot = await YearnSaverBot.deploy(
      gelatoCore.address,
      mockStrategy.address,
      [bre.network.config.GelatoUserProxyProviderModule],
      conditionYETHStratRepay.address
    );
    await yearnSaverBot.deployed();

    // fund yearnSaverBot
    const newFunds = ethers.utils.parseEther("5");
    const tx = await yearnSaverBot.connect(yearnDegan).provideFunds({
      value: newFunds,
    });
    await tx.wait();

    const currentGelatoId = await gelatoCore.currentTaskReceiptId();
    // Get Task Receipt Object from event
    const topics = gelatoCore.filters.LogTaskSubmitted(currentGelatoId).topics;
    const filter = {
      address: gelatoCore.address.toLowerCase(),
      topics,
    };

    let iface = new ethers.utils.Interface(GelatoCoreLib.GelatoCore.abi);

    const logs = await userWallet.provider.getLogs(filter);

    const log = logs[logs.length - 1];

    let event = iface.parseLog(log);

    const taskReceipt = event.args.taskReceipt[0];

    console.log(taskReceipt);

    const gelatoGasPrice = await bre.run("fetchGelatoGasPrice");

    // ======= 📣 TASK EXECUTION 📣 =========
    // This stuff is normally automated by the Gelato Network and Dapp Developers
    // and their Users don't have to take care of it. However, for local testing
    // we simulate the Gelato Execution logic.

    const canExecResult = await gelatoCore
      .connect(executor)
      .canExec(
        taskReceipt,
        taskReceipt.tasks[0].selfProviderGasLimit,
        gelatoGasPrice
      );

    console.log(canExecResult);
  });
});
