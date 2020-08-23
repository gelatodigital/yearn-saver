// "SPDX-License-Identifier: UNLICENSED"
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {
    IGelatoCore,
    Provider,
    Task,
    TaskReceipt
} from "@gelatonetwork/core/contracts/gelato_core/interfaces/IGelatoCore.sol";
import {
    IGelatoProviders,
    TaskSpec
} from "@gelatonetwork/core/contracts/gelato_core/interfaces/IGelatoProviders.sol";
import {
    IGelatoProviderModule
} from "@gelatonetwork/core/contracts/provider_modules/IGelatoProviderModule.sol";
import {Address} from  "@gelatonetwork/core/contracts/external/Address.sol";
import {SafeMath} from "@gelatonetwork/core/contracts/external/SafeMath.sol";

interface ConnectorInterface {
    function connectorID() external view returns(uint _type, uint _id);
    function name() external pure returns (string memory);
}

/// @title ConnectGelato
/// @notice Allows InstaDapp DSA to enter and exit Gelato Network
/// @author gitpusha
contract ConnectGelato is ConnectorInterface {

    using Address for address payable;
    using SafeMath for uint256;

    string constant public override name = "ConnectGelato-v1";

    address public immutable connectGelatoAddress;
    uint256 public immutable id;
    address public immutable gelatoCore;

    constructor(uint256 _id, address _gelatoCore) public payable {
        connectGelatoAddress = address(this);
        id = _id;
        gelatoCore = _gelatoCore;
    }

    /// @dev needed for unproviding funds from GelatoCore
    receive() external payable {
        require(msg.sender == gelatoCore, "ConnectGelato.receive");
    }

    /// @dev _id must be InstaConnectors.connectorLength+1
    function connectorID() external view override returns(uint _type, uint _id) {
        (_type, _id) = (1, id);
    }

    modifier delegatecallOnly(string memory _tracingInfo) {
        require(
            connectGelatoAddress != address(this),
            string(abi.encodePacked(_tracingInfo, ":delegatecallOnly"))
        );
        _;
    }

    // ===== Gelato ENTRY APIs ======
    function multiProvide(
        address _executor,
        TaskSpec[] calldata _taskSpecs,
        IGelatoProviderModule[] calldata _modules
    )
        public
        payable
        delegatecallOnly("ConnectGelato.multiProvide")
    {
        try IGelatoProviders(gelatoCore).multiProvide{value: msg.value}(
            _executor,
            _taskSpecs,
            _modules
        ) {
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.multiProvide:", error)));
        } catch {
            revert("ConnectGelato.multiProvide: unknown error");
        }
    }

    function submitTask(
        Provider calldata _provider,
        Task calldata _task,
        uint256 _expiryDate
    )
        public
        delegatecallOnly("ConnectGelato.submitTask")
    {
        try IGelatoCore(gelatoCore).submitTask(_provider, _task, _expiryDate) {
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.submitTask:", error)));
        } catch {
            revert("ConnectGelato.submitTask: unknown error");
        }
    }

    // ===== Gelato EXIT APIs ======
    function multiUnprovide(
        uint256 _withdrawAmount,
        TaskSpec[] memory _taskSpecs,
        IGelatoProviderModule[] memory _modules
    )
        external
        delegatecallOnly("ConnectGelato.multiUnprovide")
    {
        uint256 balanceBefore = address(this).balance;
        try IGelatoProviders(gelatoCore).multiUnprovide(
            _withdrawAmount,
            _taskSpecs,
            _modules
        ) {
            msg.sender.sendValue(address(this).balance.sub(balanceBefore));
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.multiUnprovide:", error)));
        } catch {
            revert("ConnectGelato.multiUnprovide: unknown error");
        }
    }

    function multiCancelTasks(TaskReceipt[] calldata _taskReceipts)
        external
        delegatecallOnly("ConnectGelato.multiCancelTasks")
    {
        try IGelatoCore(gelatoCore).multiCancelTasks(_taskReceipts) {
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.multiCancelTasks:", error)));
        } catch {
            revert("ConnectGelato.multiCancelTasks: unknown error");
        }
    }
}