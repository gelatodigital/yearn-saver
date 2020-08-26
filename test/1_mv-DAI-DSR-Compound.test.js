// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
const { expect } = require("chai");
const bre = require("@nomiclabs/buidler");
const { ethers } = bre;
const GelatoCoreLib = require("@gelatonetwork/core");
const { sleep } = GelatoCoreLib;

// Constants
const INSTA_MASTER = "0xfCD22438AD6eD564a1C26151Df73F6B33B817B56";
const DAI_100 = ethers.utils.parseUnits("100", 18);
const APY_2_PERCENT_IN_SECONDS = ethers.BigNumber.from(
  "1000000000627937192491029810"
);

// Contracts
const InstaIndex = require("../pre-compiles/InstaIndex.json");
const InstaConnectors = require("../pre-compiles/InstaConnectors.json");
const InstaList = require("../pre-compiles/InstaList.json");
const InstaAccount = require("../pre-compiles/InstaAccount.json");
const ConnectAuth = require("../pre-compiles/ConnectAuth.json");
const ConnectMaker = require("../pre-compiles/ConnectMaker.json");
const ConnectCompound = require("../pre-compiles/ConnectCompound.json");
const IERC20 = require("../pre-compiles/IERC20.json");
const IUniswapExchange = require("../pre-compiles/IUniswapExchange.json");

describe("Move DAI lending from DSR to Compound", function () {
  this.timeout(0);
  if (bre.network.name !== "ganache") {
    console.error("Test Suite is meant to be run on ganache only");
    process.exit(1);
  }

  // Wallet to use for local testing
  let userWallet;
  let userAddress;
  let dsaAddress;

  // Deployed instances
  let connectMaker;
  let connectCompound;
  let gelatoCore;
  let dai;

  // Contracts to deploy and use for local testing
  let dsa;
  let mockDSR;
  let mockCDAI;
  let conditionCompareUints;
  let connectGelato;

  before(async function () {
    // Get Test Wallet for local testnet
    [userWallet] = await ethers.getSigners();
    userAddress = await userWallet.getAddress();
    const instaMaster = await ethers.provider.getSigner(INSTA_MASTER);

    // Ganache default accounts prefilled with 100 ETH
    expect(await userWallet.getBalance()).to.be.gt(
      ethers.utils.parseEther("10")
    );

    // ===== DSA SETUP ==================
    const instaIndex = await ethers.getContractAt(
      InstaIndex.abi,
      bre.network.config.InstaIndex
    );
    const instaList = await ethers.getContractAt(
      InstaList.abi,
      bre.network.config.InstaList
    );
    const instaConnectors = await ethers.getContractAt(
      InstaConnectors.abi,
      bre.network.config.InstaConnectors
    );
    connectMaker = await ethers.getContractAt(
      ConnectMaker.abi,
      bre.network.config.ConnectMaker
    );
    connectCompound = await ethers.getContractAt(
      ConnectCompound.abi,
      bre.network.config.ConnectCompound
    );

    // Deploy DSA and get and verify ID of newly deployed DSA
    const dsaIDPrevious = await instaList.accounts();
    await expect(instaIndex.build(userAddress, 1, userAddress)).to.emit(
      instaIndex,
      "LogAccountCreated"
    );
    const dsaID = dsaIDPrevious.add(1);
    await expect(await instaList.accounts()).to.be.equal(dsaID);

    // Instantiate the DSA
    dsaAddress = await instaList.accountAddr(dsaID);
    dsa = await ethers.getContractAt(InstaAccount.abi, dsaAddress);

    // ===== GELATO SETUP ==================
    gelatoCore = await ethers.getContractAt(
      GelatoCoreLib.GelatoCore.abi,
      bre.network.config.GelatoCore
    );

    // Add GelatoCore as auth on DSA
    const addAuthData = await bre.run("abi-encode-withselector", {
      abi: ConnectAuth.abi,
      functionname: "add",
      inputs: [gelatoCore.address],
    });
    await dsa.cast(
      [bre.network.config.ConnectAuth],
      [addAuthData],
      userAddress
    );
    expect(await dsa.isAuth(gelatoCore.address)).to.be.true;

    // Deploy ConnectGelato to local testnet
    // first query the correct connectorID
    const connectorLength = await instaConnectors.connectorLength();
    const connectorId = connectorLength.add(1);

    const ConnectGelato = await ethers.getContractFactory("ConnectGelato");
    connectGelato = await ConnectGelato.deploy(connectorId, gelatoCore.address);
    await connectGelato.deployed();

    // Enable ConnectGelato on InstaConnectors via InstaMaster multisig
    // Send some ETH to the InstaMaster multi_sig
    await userWallet.sendTransaction({
      to: INSTA_MASTER,
      value: ethers.utils.parseEther("0.1"),
    });
    await instaConnectors.connect(instaMaster).enable(connectGelato.address);
    expect(
      await instaConnectors.isConnector([connectGelato.address])
    ).to.be.true;

    // Deploy ProviderModuleDSA to local testnet
    const ProviderModuleDSA = await ethers.getContractFactory(
      "ProviderModuleDSA"
    );
    providerModuleDSA = await ProviderModuleDSA.deploy(
      instaIndex.address,
      gelatoCore.address
    );
    await providerModuleDSA.deployed();

    // Deploy Mocks for Testing
    const MockCDAI = await ethers.getContractFactory("MockCDAI");
    mockCDAI = await MockCDAI.deploy(APY_2_PERCENT_IN_SECONDS);
    await providerModuleDSA.deployed();

    const MockDSR = await ethers.getContractFactory("MockDSR");
    mockDSR = await MockDSR.deploy(APY_2_PERCENT_IN_SECONDS);
    await mockDSR.deployed();

    // Deploy Gelato Conditions for Testing
    const ConditionCompareUintsFromTwoSources = await ethers.getContractFactory(
      "ConditionCompareUintsFromTwoSources"
    );
    conditionCompareUints = await ConditionCompareUintsFromTwoSources.deploy();
    await conditionCompareUints.deployed();

    // ===== Dapp Dependencies SETUP ==================
    // This test assumes our user has 100 DAI deposited in Maker DSR
    dai = await ethers.getContractAt(IERC20.abi, bre.network.config.DAI);
    expect(await dai.balanceOf(userAddress)).to.be.equal(0);

    // Let's get the test user 100 DAI++ from Kyber
    const daiUniswapExchange = await ethers.getContractAt(
      IUniswapExchange.abi,
      bre.network.config.DAI_UNISWAP
    );
    await daiUniswapExchange.ethToTokenTransferInput(
      1,
      2525644800, // random timestamp in the future (year 2050)
      userAddress,
      {
        value: ethers.utils.parseEther("2"),
      }
    );
    expect(await dai.balanceOf(userAddress)).to.be.gte(DAI_100);

    // Next we transfer the 100 DAI into our DSA
    await dai.transfer(dsa.address, DAI_100);
    expect(await dai.balanceOf(dsa.address)).to.be.eq(DAI_100);

    // Next we deposit the 100 DAI into the DSR
    const depositDai = await bre.run("abi-encode-withselector", {
      abi: ConnectMaker.abi,
      functionname: "depositDai",
      inputs: [DAI_100, 0, 0],
    });

    await expect(
      dsa.cast([bre.network.config.ConnectMaker], [depositDai], userAddress)
    )
      .to.emit(dsa, "LogCast")
      .withArgs(userAddress, userAddress, 0);
    expect(await dai.balanceOf(dsa.address)).to.be.eq(0);
  });

  it("#1: Gelato refinances DAI from DSR=>Compound, if better rate", async function () {
    // ======= Condition setup ======
    // We instantiate the Rebalance Condition:
    // Compound APY needs to be 10000000 per second points higher than DSR
    const MIN_SPREAD = "10000000";
    const rebalanceCondition = new GelatoCoreLib.Condition({
      inst: conditionCompareUints.address,
      data: await conditionCompareUints.getConditionData(
        mockCDAI.address, // We are in DSR so we compare against CDAI => SourceA=CDAI
        mockDSR.address, // SourceB=DSR
        await bre.run("abi-encode-withselector", {
          abi: require("../artifacts/MockCDAI.json").abi,
          functionname: "supplyRatePerSecond",
        }), // CDAI data feed first (sourceAData)
        await bre.run("abi-encode-withselector", {
          abi: require("../artifacts/MockDSR.json").abi,
          functionname: "dsr",
        }), // DSR data feed second (sourceBData)
        MIN_SPREAD
      ),
    });

    // ======= Action/Spells setup ======
    // To assimilate to DSA SDK
    const spells = [];

    // We instantiate target1: Withdraw DAI from DSR and setId 1 for
    // target2 Compound deposit to fetch DAI amount.
    const connectorWithdrawFromDSR = new GelatoCoreLib.Action({
      addr: connectMaker.address,
      data: await bre.run("abi-encode-withselector", {
        abi: ConnectMaker.abi,
        functionname: "withdrawDai",
        inputs: [ethers.constants.MaxUint256, 0, 1],
      }),
      operation: GelatoCoreLib.Operation.Delegatecall,
    });
    spells.push(connectorWithdrawFromDSR);

    // We instantiate target2: Deposit DAI to CDAI and getId 1
    const connectorDepositCompound = new GelatoCoreLib.Action({
      addr: connectCompound.address,
      data: await bre.run("abi-encode-withselector", {
        abi: ConnectCompound.abi,
        functionname: "deposit",
        inputs: [dai.address, 0, 1, 0],
      }),
      operation: GelatoCoreLib.Operation.Delegatecall,
    });
    spells.push(connectorDepositCompound);

    // ======= Gelato Task Setup =========
    // A Gelato Task just combines Conditions with Actions
    // You also specify how much GAS a Task consumes at max and the ceiling
    // gas price under which you are willing to auto-transact. There is only
    // one gas price in the current Gelato system: fast gwei read from Chainlink.
    const GAS_LIMIT = "4000000";
    const GAS_PRICE_CEIL = ethers.utils.parseUnits("400", "gwei");
    const taskRebalanceDSRToCDAIifBetter = new GelatoCoreLib.Task({
      conditions: [rebalanceCondition],
      actions: spells,
      selfProviderGasLimit: GAS_LIMIT,
      selfProviderGasPriceCeil: GAS_PRICE_CEIL,
    });

    // ======= Gelato Provider setup ======
    // Someone needs to pay for gas for automatic Task execution on Gelato.
    // Gelato has the concept of a "Provider" to denote who is providing (depositing)
    // ETH on Gelato in order to pay for automation gas. In our case, the User
    // is paying for his own automation gas. Therefore, the User is a "Self-Provider".
    // But since Gelato only talks to smart contract accounts, the User's DSA proxy
    // plays the part of the "Self-Provider" on behalf of the User behind the DSA.
    // A GelatoProvider is an object with the address of the provider - in our case
    // the DSA address - and the address of the "ProviderModule". This module
    // fulfills certain functions like encoding the execution payload for the Gelato
    // protocol. Check out ./contracts/ProviderModuleDSA.sol to see what it does.
    const gelatoSelfProvider = new GelatoCoreLib.GelatoProvider({
      addr: dsa.address,
      module: providerModuleDSA.address,
    });

    // ======= Executor Setup =========
    // For local Testing purposes our test User account will play the role of the Gelato
    // Executor network because this logic is non-trivial to fork into a local instance
    await gelatoCore.stakeExecutor({
      value: await gelatoCore.minExecutorStake(),
    });
    expect(await gelatoCore.isExecutorMinStaked(userAddress)).to.be.true;

    // ======= Gelato Task Provision =========
    // Gelato requires some initial setup via its multiProvide API
    // We must 1) provide ETH to pay for future automation gas, 2) we must
    // assign an Executor network to the Task, 3) we must tell Gelato what
    // "ProviderModule" we want to use for our Task.
    // Since our DSA proxy is the one through which we interact with Gelato,
    // we must do this setup via the DSA proxy by using ConnectGelato
    const TASK_AUTOMATION_FUNDS = await gelatoCore.minExecProviderFunds(
      GAS_LIMIT,
      GAS_PRICE_CEIL
    );
    await dsa.cast(
      [connectGelato.address], // targets
      [
        await bre.run("abi-encode-withselector", {
          abi: require("../artifacts/ConnectGelato.json").abi,
          functionname: "multiProvide",
          inputs: [userAddress, [], [providerModuleDSA.address]],
        }),
      ], // datas
      userAddress, // origin
      {
        value: TASK_AUTOMATION_FUNDS,
        gasLimit: 5000000,
      }
    );
    expect(await gelatoCore.providerFunds(dsa.address)).to.be.gte(
      TASK_AUTOMATION_FUNDS
    );
    expect(
      await gelatoCore.isProviderLiquid(dsa.address, GAS_LIMIT, GAS_PRICE_CEIL)
    );
    expect(await gelatoCore.executorByProvider(dsa.address)).to.be.equal(
      userAddress
    );
    expect(
      await gelatoCore.isModuleProvided(dsa.address, providerModuleDSA.address)
    ).to.be.true;

    // ======= 📣 TASK SUBMISSION 📣 =========
    // In Gelato world our DSA is the User. So we must submit the Task
    // to Gelato via our DSA and hence use ConnectGelato again.
    const expiryDate = 0;
    await expect(
      dsa.cast(
        [connectGelato.address], // targets
        [
          await bre.run("abi-encode-withselector", {
            abi: require("../artifacts/ConnectGelato.json").abi,
            functionname: "submitTask",
            inputs: [
              gelatoSelfProvider,
              taskRebalanceDSRToCDAIifBetter,
              expiryDate,
            ],
          }),
        ], // datas
        userAddress, // origin
        {
          gasLimit: 5000000,
        }
      )
    ).to.emit(gelatoCore, "LogTaskSubmitted");

    // Task Receipt: a successfully submitted Task in Gelato
    // is wrapped in a TaskReceipt. For testing we instantiate the TaskReceipt
    // for our to be submitted Task.
    const taskReceiptId = await gelatoCore.currentTaskReceiptId();
    const taskReceipt = new GelatoCoreLib.TaskReceipt({
      id: taskReceiptId,
      userProxy: dsa.address,
      provider: gelatoSelfProvider,
      tasks: [taskRebalanceDSRToCDAIifBetter],
      expiryDate,
    });

    // ======= 📣 TASK EXECUTION 📣 =========
    // This stuff is normally automated by the Gelato Network and Dapp Developers
    // and their Users don't have to take care of it. However, for local testing
    // we simulate the Gelato Execution logic.

    // Let's first check if our Task is executable. Since both MockDSR and MockCDAI
    // start with a normalized per second rate of APY_2_PERCENT_IN_SECONDS
    // (1000000000627937192491029810 in 10**27 precision) in both of them, we
    // expect ConditionNotOk because ANotGreaterOrEqualToBbyMinspread.
    // Check out contracts/ConditionCompareUintsFromTwoSources.sol to see how
    // how the comparison of MockDSR and MockCDAI is implemented in Condition code.
    expect(
      await gelatoCore.canExec(taskReceipt, GAS_LIMIT, GAS_PRICE_CEIL)
    ).to.be.equal("ConditionNotOk:ANotGreaterOrEqualToBbyMinspread");

    // We defined a MIN_SPREAD of 10000000 points in the per second rate
    // for our ConditionCompareUintsFromTwoSources. So we now
    // set the CDAI.supplyRatePerSecond to be 10000000 higher than MockDSR.dsr
    // and expect it to mean that our Task becomes executable.
    await mockCDAI.setSupplyRatePerSecond(
      (await mockDSR.dsr()).add(MIN_SPREAD)
    );
    expect(
      await gelatoCore.canExec(taskReceipt, GAS_LIMIT, GAS_PRICE_CEIL)
    ).to.be.equal("OK");

    // To verify whether the execution of DSR=>CDAI has been successful in this Testing
    // we look at changes in the CDAI balance of the DSA
    const cDAI = await ethers.getContractAt(
      IERC20.abi,
      bre.network.config.CDAI
    );
    const dsaCDAIBefore = await cDAI.balanceOf(dsa.address);

    // For testing we now simulate automatic Task Execution ❗
    const gelatoGasPrice = await bre.run("fetchGelatoGasPrice");
    await expect(
      gelatoCore.exec(taskReceipt, {
        gasPrice: gelatoGasPrice, // Exectutor must use gelatoGasPrice (Chainlink fast gwei)
        gasLimit: taskRebalanceDSRToCDAIifBetter.selfProviderGasLimit,
      })
    ).to.emit(gelatoCore, "LogExecSuccess");

    // Since the Execution was successful, we now expect our DSA to hold more
    // CDAI then before. This concludes our testing.
    expect(await cDAI.balanceOf(dsa.address)).to.be.gt(dsaCDAIBefore);
  });
});
