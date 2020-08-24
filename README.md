# gelato-instadapp

[![gelatodigital](https://circleci.com/gh/gelatodigital/gelato-instadapp.svg?style=shield)](https://circleci.com/gh/gelatodigital/gelato-instadapp)

<p  align="center">
<img  src="assets/instadapp_filled.svg"  width="150px"/>
<img  src="assets/Gelato_Black.svg"  width="150px"/></p>

This repo contains smart contract prototypes and mocks and a test suite showcasing how the InstaDapp DSA could use Gelato to automate the execution (or casting) of its Spells (connectors) based on arbitrary Conditions.

For the first iteration, we started with a simple spell:
**Move DAI lending from DSR to Compound.**
This reused two existing deployed InstaDapp Connectors: `ConnectMaker.withdrawDai` and `ConnectCompound.deposit`.

Furtheremore the following contracts were added to showcase the automation of the Spell:

- `MockCDAI.sol` and `MockDSR.sol`: to normalize CDAI.supplyRatePerBlock and dsr values to a _per second rate in 10\*\*27 precision_

- `ConditionCompareUintsFromTwoSource`: a generic Gelato Condition that allows you to read and compare data from 2 arbitrary on-chain sources (returndata expected to be uint256 and normalized => hence MockDSR and MockCDAI). This Condition was used to compare DSR to CDAI rates and in the test suite we showcase how a change in the CDAI rate (it going above the DSR) can trigger an automatic rebalancing from DSR to CDAI via DSA Connectors.

- `ProviderModuleDSA`: this is needed for any Gelato integration. It tells Gelato how the execution payload should be formatted. In this prototype, it formats the payload for the `DSA.cast` function.

- `ConnectGelato`: this is a Connector needed for the DSA to be able to submit Tasks to Gelato. In the test suite we unlock the DSA MultiSig Master account at 0xfCD22438AD6eD564a1C26151Df73F6B33B817B56, in order to be able to enable this Connector in our mainnet fork running on the local ganache instance.

To see for yourself check out the [contracts](./contracts) folder and make sure to check out `test/mv-DAI-DSR-Compound.test.js`, to see an end-to-end test showcasing the prototype. To do so follow the steps below:

1. Clone this repo
2. Put your Infura ID in .env
3. yarn install
4. npx buidler test
