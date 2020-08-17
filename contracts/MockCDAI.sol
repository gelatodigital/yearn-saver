// "SPDX-License-Identifier: UNLICENSED"
pragma solidity 0.6.12;

contract MockCDAI {
    // DSR
    // https://compound.finance/docs#protocol-math
    // CDAI uses supplyRatePerBlock with 10**18 precision
    // Because MakerDAO dsr is rate per second with 10**27 precision,
    // we also adopt this for CDAI.
    uint256 public supplyRatePerSecond = 1000000000627937192491029810;  // per second==2% annually

    /// @dev Use this during tests to simulate changing CDAI.supplyRatePerBlock conditions
    /// @param _rate CDAI.supplyRatePerBlock but in seconds and 10**27 precision
    function setSupplyRatePerSecond(uint256 _rate) external virtual {
        supplyRatePerSecond = _rate;
    }
}