// Libraries
const assert = require("assert");
const { utils } = require("ethers");

const GelatoCoreLib = require("@gelatonetwork/core");

// Process Env Variables
require("dotenv").config();
const INFURA_ID = process.env.INFURA_ID;
assert.ok(INFURA_ID, "no Infura ID in process.env");

const INSTA_MASTER = "0xfCD22438AD6eD564a1C26151Df73F6B33B817B56";

// ================================= CONFIG =========================================
module.exports = {
  defaultNetwork: "ganache",
  networks: {
    ganache: {
      // Standard config
      url: "http://localhost:8545",
      fork: `https://mainnet.infura.io/v3/${INFURA_ID}`,
      unlocked_accounts: [INSTA_MASTER],
      // Custom
      GelatoCore: "0x1d681d76ce96E4d70a88A00EBbcfc1E47808d0b8",
      InstaMaster: INSTA_MASTER,
      InstaIndex: "0x2971AdFa57b20E5a416aE5a708A8655A9c74f723",
      InstaList: "0x4c8a1BEb8a87765788946D6B19C6C6355194AbEb",
      InstaConnectors: "0xD6A602C01a023B98Ecfb29Df02FBA380d3B21E0c",
      InstaAccount: "0x939Daad09fC4A9B8f8A9352A485DAb2df4F4B3F8",
      ConnectAuth: "0xd1aFf9f2aCf800C876c409100D6F39AEa93Fc3D9",
      ConnectBasic: "0x6a31c5982C5Bc5533432913cf06a66b6D3333a95",
      ConnectMaker: "0xac02030d8a8F49eD04b2f52C394D3F901A10F8A9",
      ConnectCompound: "0x07F81230d73a78f63F0c2A3403AD281b067d28F8",
      DAI: "0x6b175474e89094c44da98b954eedeac495271d0f",
      DAI_UNISWAP: "0x2a1530C4C41db0B0b2bB646CB5Eb1A67b7158667",
    },
  },
  solc: {
    version: "0.6.12",
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
