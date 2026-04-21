// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * Stub Chainlink-style aggregator. Satisfies BlinkReserve.getLatestPrice()
 * for BlinkReserve.test.js. Test-only.
 */
contract MockAggregatorSettlement is AggregatorV3Interface {
    int256 private _price;

    constructor(int256 initial) {
        _price = initial;
    }

    function setPrice(int256 p) external {
        _price = p;
    }

    function decimals() external pure returns (uint8) { return 8; }
    function description() external pure returns (string memory) { return "mock"; }
    function version() external pure returns (uint256) { return 1; }

    function getRoundData(uint80)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }
}
