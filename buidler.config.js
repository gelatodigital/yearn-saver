// Libraries
const assert = require("assert");
const { utils } = require("ethers");

const GelatoCoreLib = require("@gelatonetwork/core");

// Process Env Variables
require("dotenv").config();
const INFURA_ID = process.env.INFURA_ID;
const ALCHEMY_ID = process.env.ALCHEMY_ID;
assert.ok(INFURA_ID, "no Infura ID in process.env");

// const INSTA_MASTER = "0xfCD22438AD6eD564a1C26151Df73F6B33B817B56";
const GELATO_EXEC_NETWORK = "0xd70D5fb9582cC3b5B79BBFAECbb7310fd0e3B582";

// ================================= CONFIG =========================================
module.exports = {
  defaultNetwork: "ganache",
  networks: {
    ganache: {
      // Standard config
      url: "http://localhost:8545",
      fork: `https://mainnet.infura.io/v3/${INFURA_ID}`,
      // fork: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_ID}`,
      unlocked_accounts: [GELATO_EXEC_NETWORK],
      // Custom
      GelatoCore: "0x1d681d76ce96E4d70a88A00EBbcfc1E47808d0b8",
      StrategyMKRVaultDAIDelegate: "0x932fc4fd0eEe66F22f1E23fBA74D7058391c0b15",
      DAI_UNISWAP: "0x2a1530C4C41db0B0b2bB646CB5Eb1A67b7158667",
      GelatoUserProxyProviderModule:
        "0x4372692C2D28A8e5E15BC2B91aFb62f5f8812b93",
      // GelatoExecNetwork: GELATO_EXEC_NETWORK,
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
