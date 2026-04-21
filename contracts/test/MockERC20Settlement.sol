// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Minimal mintable ERC20 used only by BlinkReserve.test.js. Lives under
 * contracts/test/ so Hardhat picks it up automatically but it is never shipped
 * to mainnet / Arc testnet.
 */
contract MockERC20Settlement is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 dec) ERC20(name_, symbol_) {
        _decimals = dec;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
