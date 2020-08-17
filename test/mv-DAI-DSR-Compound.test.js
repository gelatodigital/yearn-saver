// running `npx buidler test` automatically makes use of buidler-waffle plugin
// => only dependency we need is "chai"
const { expect } = require("chai");
const bre = require("@nomiclabs/buidler");
const { ethers } = bre;
const GelatoCoreLib = require("@gelatonetwork/core");

// Constants
const INSTA_MASTER = "0xfCD22438AD6eD564a1C26151Df73F6B33B817B56";
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DAI_100 = ethers.utils.parseUnits("100", 18);

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

  before(async function () {
    // Get Test Wallet for local testnet
    [userWallet] = await ethers.getSigners();
    userAddress = await userWallet.getAddress();
    const instaMaster = await ethers.provider.getSigner(INSTA_MASTER);

    // Ganache default accounts prefilled with 100 ETH
    expect(await userWallet.getBalance()).to.be.equal(
      ethers.utils.parseEther("100")
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
    const connectGelato = await ConnectGelato.deploy(
      connectorId,
      gelatoCore.address
    );
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

  it("#1: Deploys a DSA with user as authority", async function () {
    expect(await dsa.isAuth(userAddress)).to.be.true;
  });
});
