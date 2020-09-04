// SPDX-License-Identifier: GPLv3
pragma solidity 0.6.10;


contract MockStrategy {

    uint256 public amount;

    constructor(uint256 _amount) public {
        setRepayAmount(_amount);
    }

    function repayAmount() public view returns(uint256) {
        return amount;
    }

    function setRepayAmount(uint256 _amount) public {
        amount = _amount;
    }
}