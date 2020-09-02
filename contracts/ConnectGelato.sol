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
import {Stores} from "./instadapp/Stores.sol";

interface ConnectorInterface {
    function name() external pure returns (string memory);
}

/// @title ConnectGelato
/// @notice Allows InstaDapp DSA to enter and exit Gelato Network
/// @dev Check out https://github.com/gelatodigital/gelato-kyber#how-gelato-works for an explanation
/// @author gitpusha
contract ConnectGelato is ConnectorInterface, Stores {

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
    function connectorID() public view override returns(uint _type, uint _id) {
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

    /**
     * @dev Enables first time users to  pre-fund eth, whitelist an executor & register the
     * ProviderModuleDSA.sol to be able to use Gelato
     * @param _executor address of single execot node or gelato'S decentralized execution market
     * @param _taskSpecs enables external providers to whitelist TaskSpecs on gelato
     * @param _modules address of ProviderModuleDSA
     * @param _ethToDeposit amount of eth to deposit on Gelato, only for self-providers
    */
    function multiProvide(
        address _executor,
        TaskSpec[] calldata _taskSpecs,
        IGelatoProviderModule[] calldata _modules,
        uint256 _ethToDeposit
    )
        public
        payable
        delegatecallOnly("ConnectGelato.multiProvide")
    {
        try IGelatoProviders(gelatoCore).multiProvide{value: _ethToDeposit}(
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

    /**
     * @dev Submits a single, one-time task to Gelato
     * @param _provider Consists of proxy module address (DSA) and provider address ()
     * who will pay for the transaction execution
     * @param _task Task specifying the condition and the action connectors
     * @param _expiryDate Default 0, othweise timestamp after which the task expires
    */
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

    /**
     * @dev Submits single or mulitple Task Sequences to Gelato
     * @param _provider Consists of proxy module address (DSA) and provider address ()
     * who will pay for the transaction execution
     * @param _tasks A sequence of Tasks, can be a single or multiples
     * @param _expiryDate Default 0, othweise timestamp after which the task expires
     * @param _cycles How often the Task List should be executed, e.g. 5 times
    */
    function submitTaskCycle(
        Provider calldata _provider,
        Task[] memory _tasks,
        uint256 _expiryDate,
        uint256 _cycles
    )
        public
        delegatecallOnly("ConnectGelato.submitTaskCycle")
    {
        try IGelatoCore(gelatoCore).submitTaskCycle(
            _provider,
            _tasks,
            _expiryDate,
            _cycles
        ) {
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.submitTaskCycle:", error)));
        } catch {
            revert("ConnectGelato.submitTaskCycle: unknown error");
        }
    }

    /**
     * @dev Submits single or mulitple Task Chains to Gelato
     * @param _provider Consists of proxy module address (DSA) and provider address ()
     * who will pay for the transaction execution
     * @param _tasks A sequence of Tasks, can be a single or multiples
     * @param _expiryDate Default 0, othweise timestamp after which the task expires
     * @param _sumOfRequestedTaskSubmits The TOTAL number of Task auto-submits
     * that should have occured once the cycle is complete
    */
    function submitTaskChain(
        Provider calldata _provider,
        Task[] memory _tasks,
        uint256 _expiryDate,
        uint256 _sumOfRequestedTaskSubmits
    )
        public
        delegatecallOnly("ConnectGelato.submitTaskChain")
    {
        try IGelatoCore(gelatoCore).submitTaskChain(
            _provider,
            _tasks,
            _expiryDate,
            _sumOfRequestedTaskSubmits
        ) {
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.submitTaskChain:", error)));
        } catch {
            revert("ConnectGelato.submitTaskChain: unknown error");
        }
    }




    // ===== Gelato EXIT APIs ======

    /**
     * @dev Withdraws funds from Gelato, de-whitelists TaskSpecs and Provider Modules
     * in one tx
     * @param _withdrawAmount Amount of ETH to withdraw from Gelato
     * @param _taskSpecs List of Task Specs to de-whitelist, default empty []
     * @param _modules List of Provider Modules to de-whitelist, default empty []
    */
    function multiUnprovide(
        uint256 _withdrawAmount,
        TaskSpec[] memory _taskSpecs,
        IGelatoProviderModule[] memory _modules,
        uint256 _setId
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
            setUint(_setId, address(this).balance.sub(balanceBefore));
        } catch Error(string memory error) {
            revert(string(abi.encodePacked("ConnectGelato.multiUnprovide:", error)));
        } catch {
            revert("ConnectGelato.multiUnprovide: unknown error");
        }
    }

    /**
     * @dev Cancels outstanding Tasks
     * @param _taskReceipts List of Task Receipts to cancel
    */
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