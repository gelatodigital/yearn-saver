// Libraries
const assert = require("assert");
const { utils } = require("ethers");

const GelatoCoreLib = require("@gelatonetwork/core");
const gelatoManagerAbi = require("./artifacts/GelatoManager.json").abi;

// Process Env Variables
require("dotenv").config();
const INFURA_ID = process.env.INFURA_ID;
const ALCHEMY_ID = process.env.ALCHEMY_ID;
const PRIV_KEY = process.env.PRIV_KEY;
assert.ok(INFURA_ID, "no Infura ID in process.env");

// const INSTA_MASTER = "0xfCD22438AD6eD564a1C26151Df73F6B33B817B56";
const GELATO_EXEC_NETWORK = "0xd70D5fb9582cC3b5B79BBFAECbb7310fd0e3B582";
const GELATO_EXEC_NODE = "0x4d671cd743027fb5af1b2d2a3ccbafa97b5b1b80";
const GELATO_SYS_ADMIN = "0x2464e6E2c963CC1810FAF7c2B3205819C93833f7";
// const GELATO_EXEC_NETWORK = "0xd70d5fb9582cc3b5b79bbfaecbb7310fd0e3b582";

const contracts = {
  GelatoCore: "0x1d681d76ce96E4d70a88A00EBbcfc1E47808d0b8",
  StrategyMKRVaultDAIDelegate: "0x932fc4fd0eEe66F22f1E23fBA74D7058391c0b15",
  DAI_UNISWAP: "0x2a1530C4C41db0B0b2bB646CB5Eb1A67b7158667",
  GelatoUserProxyProviderModule: "0x4372692C2D28A8e5E15BC2B91aFb62f5f8812b93",
  GelatoExecNetwork: GELATO_EXEC_NETWORK,
  GelatoExecNode: GELATO_EXEC_NODE,
  GelatoSysAdmin: GELATO_SYS_ADMIN,
  ConditionYETHStratRepay: "0xa6904358015f4EAc5808420d1C1f7985fB5A4CAd",
  YearnGelatoManager: "0x20C45334e4035AE411655eF7360116Cf627e4d06",
};

// ================================= CONFIG =========================================
module.exports = {
  defaultNetwork: "ganache",
  etherscan: {
    // The url for the Etherscan API you want to use.
    // For example, here we're using the one for the Rinkeby test network
    url: "https://api-rinkeby.etherscan.io/api",
    // Your API key for Etherscan (Obtain one at https://etherscan.io/)
    apiKey: process.env.ETHERSCAN_KEY,
  },
  networks: {
    ganache: {
      // Standard config
      url: "http://localhost:8545",
      fork: `https://mainnet.infura.io/v3/${INFURA_ID}`,
      // fork: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_ID}`,
      unlocked_accounts: [
        GELATO_EXEC_NETWORK,
        GELATO_EXEC_NODE,
        GELATO_SYS_ADMIN,
      ],
      // Custom
      ...contracts,
    },
    mainnet: {
      // Standard
      chainId: 1,
      gas: "auto",
      gasPrice: parseInt(utils.parseUnits("120", "gwei")),
      gasMultiplier: 1.5,
      url: `https://mainnet.infura.io/v3/${INFURA_ID}`,
      // Custom
      ...contracts,
    },
  },
  solc: {
    version: "0.6.10",
    optimizer: { enabled: true },
  },
};

// ================================= PLUGINS =========================================
usePlugin("@nomiclabs/buidler-ethers");
usePlugin("@nomiclabs/buidler-ganache");
usePlugin("@nomiclabs/buidler-waffle");

// ================================= TASKS =========================================
task("abi-encode-withselector")
  .addPositionalParam(
    "abi",
    "Contract ABI in array form",
    undefined,
    types.json
  )
  .addPositionalParam("functionname")
  .addOptionalVariadicPositionalParam(
    "inputs",
    "Array of function params",
    undefined,
    types.json
  )
  .addFlag("log")
  .setAction(async (taskArgs) => {
    try {
      if (taskArgs.log) console.log(taskArgs);

      if (!taskArgs.abi)
        throw new Error("abi-encode-withselector: no abi passed");

      const interFace = new utils.Interface(taskArgs.abi);

      let functionFragment;
      try {
        functionFragment = interFace.getFunction(taskArgs.functionname);
      } catch (error) {
        throw new Error(
          `\n ❌ abi-encode-withselector: functionname "${taskArgs.functionname}" not found`
        );
      }

      let payloadWithSelector;

      if (taskArgs.inputs) {
        let iterableInputs;
        try {
          iterableInputs = [...taskArgs.inputs];
        } catch (error) {
          iterableInputs = [taskArgs.inputs];
        }
        payloadWithSelector = interFace.encodeFunctionData(
          functionFragment,
          iterableInputs
        );
      } else {
        payloadWithSelector = interFace.encodeFunctionData(
          functionFragment,
          []
        );
      }

      if (taskArgs.log)
        console.log(`\nEncodedPayloadWithSelector:\n${payloadWithSelector}\n`);
      return payloadWithSelector;
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });

task(
  "fetchGelatoGasPrice",
  `Returns the current gelato gas price used for calling canExec and exec`
)
  .addOptionalParam("gelatocoreaddress")
  .addFlag("log", "Logs return values to stdout")
  .setAction(async (taskArgs) => {
    try {
      const gelatoCore = await ethers.getContractAt(
        GelatoCoreLib.GelatoCore.abi,
        taskArgs.gelatocoreaddress
          ? taskArgs.gelatocoreaddress
          : network.config.GelatoCore
      );

      const oracleAbi = ["function latestAnswer() view returns (int256)"];

      const gelatoGasPriceOracleAddress = await gelatoCore.gelatoGasPriceOracle();

      // Get gelatoGasPriceOracleAddress
      const gelatoGasPriceOracle = await ethers.getContractAt(
        oracleAbi,
        gelatoGasPriceOracleAddress
      );

      // lastAnswer is used by GelatoGasPriceOracle as well as the Chainlink Oracle
      const gelatoGasPrice = await gelatoGasPriceOracle.latestAnswer();

      if (taskArgs.log) {
        console.log(
          `\ngelatoGasPrice: ${utils.formatUnits(
            gelatoGasPrice.toString(),
            "gwei"
          )} gwei\n`
        );
      }

      return gelatoGasPrice;
    } catch (error) {
      console.error(error, "\n");
      process.exit(1);
    }
  });

task("setup-yearn-saver", `Setup Yearn Saver`)
  .addFlag("log", "Logs return values to stdout")
  .setAction(async (taskArgs) => {
    try {
      const gelatoCore = await ethers.getContractAt(
        GelatoCoreLib.GelatoCore.abi,
        network.config.GelatoCore
      );

      // Start
      const gelatoSysAdmin = new ethers.Wallet(PRIV_KEY, ethers.provider);

      // Deploy GelatoManager to local testnet
      const gelatoManager = await ethers.getContractAt(
        gelatoManagerAbi,
        network.config.YearnGelatoManager
      );

      // submit Task to Gelato
      // ConditionYETHStratRepay.sol
      const condition = {
        inst: network.config.ConditionYETHStratRepay,
        data: ethers.constants.HashZero,
      };

      const stratInterface = new ethers.utils.Interface(["function repay()"]);

      const sighash = stratInterface.getSighash("repay()");

      // 0x932fc4fd0eEe66F22f1E23fBA74D7058391c0b15
      const action = {
        addr: network.config.StrategyMKRVaultDAIDelegate,
        data: sighash,
        operation: GelatoCoreLib.Operation.Call,
        dataFlow: GelatoCoreLib.DataFlow.None,
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
        module: network.config.GelatoUserProxyProviderModule,
      };

      const assignExecTx = await gelatoManager
        .connect(gelatoSysAdmin)
        .assignExecutor(network.config.GelatoExecNetwork);

      console.log(assignExecTx.hash);
      // await assignExecTx.wait();

      const whitelistProvideModuleTx = await gelatoManager
        .connect(gelatoSysAdmin)
        .addProviderModules([network.config.GelatoUserProxyProviderModule]);
      // await whitelistProvideModuleTx.wait();

      console.log(whitelistProvideModuleTx.hash);

      const submitTx = await gelatoManager
        .connect(gelatoSysAdmin)
        .submitTaskCycle(provider, [task], 0, 0);
      // await submitTx.wait();

      console.log(submitTx.hash);
    } catch (error) {
      console.error(error, "\n");
      process.exit(1);
    }
  });
