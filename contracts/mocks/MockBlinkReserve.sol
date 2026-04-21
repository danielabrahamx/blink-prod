// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Minimal mock of the BlinkReserve payout path for the claims integration
// test. It tracks USDC pool state and emits a PayoutTriggered event when an
// admin-approved claim is paid. Only the admin can trigger payouts.
contract MockBlinkReserve {
    address public immutable admin;
    IERC20 public immutable usdc;
    uint256 public usdcPool;

    event ReserveFunded(address indexed from, uint256 amount);
    event PayoutTriggered(
        bytes32 indexed claimId,
        address indexed recipient,
        uint256 amount
    );

    constructor(address _admin, address _usdc) {
        admin = _admin;
        usdc = IERC20(_usdc);
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "only_admin");
        _;
    }

    function fundReserve(uint256 amount) external {
        require(amount > 0, "amount_zero");
        usdc.transferFrom(msg.sender, address(this), amount);
        usdcPool += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    function payoutClaim(bytes32 claimId, address recipient, uint256 amount)
        external
        onlyAdmin
        returns (bool)
    {
        require(recipient != address(0), "no_recipient");
        require(amount > 0, "amount_zero");
        require(usdcPool >= amount, "insufficient_pool");
        usdcPool -= amount;
        usdc.transfer(recipient, amount);
        emit PayoutTriggered(claimId, recipient, amount);
        return true;
    }
}
