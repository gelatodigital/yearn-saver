// "SPDX-License-Identifier: UNLICENSED"
pragma solidity 0.6.12;

contract MockDSR {
    // DSR
    // https://github.com/makerdao/dss/blob/master/src/pot.sol
    // https://docs.makerdao.com/smart-contract-modules/rates-module#a-note-on-setting-rates
    // - is the rate per second
    // - can be set by Maker governance on the Pot contract in the RatesModule.
    // - returns annual percentage value as 10**27 [ray]
    // - e.g. dsr=1000000000627937192491029810 == 2 % annually
    /// uint256 public dsr = 1000000000627937192491029810;  // per second==2% annually

    uint256 public dsr;
    constructor(uint256 _dsr) public { dsr = _dsr; }

    /// @dev Use this during tests to simulate changing DSR conditions
    /// @param _dsr The dsr to set.
    function setDSR(uint256 _dsr) external virtual {
        dsr = _dsr;
    }
}