// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract BlinkReserve is AccessControl {
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");
    bytes32 public constant INSURANCE_ADMIN_ROLE = keccak256("INSURANCE_ADMIN_ROLE");

    AggregatorV3Interface public priceFeed;
    IERC20 public immutable usdc;
    IERC20 public immutable usyc;

    uint256 public floodThreshold = 1200000000000; // 12 feet * 1e11
    uint256 public constant SCALING_FACTOR = 100_000_000_000; // 1e11
    uint256 public constant MAX_THRESHOLD_FEET = 100;

    uint256 public usdcPool;    // USDC premiums held in contract (6 decimals)
    uint256 public usycReserve; // USYC reserve held in contract (6 decimals)

    address public owner;

    struct Policy {
        address customer;
        uint256 premium;  // USDC units (6 decimals)
        uint256 coverage; // USDC units (6 decimals)
        bool active;
        bool paidOut;
    }

    mapping(address => Policy) public policies;

    event InsurancePurchased(address indexed customer, uint256 premium, uint256 coverage);
    event PayoutTriggered(address indexed customer, uint256 usdcAmount, uint256 usycAmount);
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);
    event OracleAddressUpdated(address indexed oldOracle, address indexed newOracle);
    event ReserveDeposited(uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized: Not owner");
        _;
    }

    constructor(address _priceFeedAddress, address _usdc, address _usyc) {
        owner = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_UPDATER_ROLE, msg.sender);
        _grantRole(INSURANCE_ADMIN_ROLE, msg.sender);
        priceFeed = AggregatorV3Interface(_priceFeedAddress);
        usdc = IERC20(_usdc);
        usyc = IERC20(_usyc);
    }

    function getLatestPrice() public view returns (uint256) {
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid oracle data");
        return uint256(price);
    }

    function buyInsurance(uint256 _coverage) external {
        require(!policies[msg.sender].active, "Already has active policy");
        require(_coverage > 0, "Coverage must be > 0");

        uint256 premium = _coverage / 10;
        require(premium > 0, "Coverage too small");

        usdc.transferFrom(msg.sender, address(this), premium);
        usdcPool += premium;

        policies[msg.sender] = Policy({
            customer: msg.sender,
            premium: premium,
            coverage: _coverage,
            active: true,
            paidOut: false
        });

        emit InsurancePurchased(msg.sender, premium, _coverage);
    }

    function triggerPayout() external {
        Policy storage policy = policies[msg.sender];
        require(policy.active, "No active policy");
        require(!policy.paidOut, "Already paid out");

        uint256 currentLevel = getLatestPrice();
        require(currentLevel >= floodThreshold, "Flood level below threshold");

        uint256 coverage = policy.coverage;
        policy.active = false;
        policy.paidOut = true;

        if (usdcPool >= coverage) {
            usdcPool -= coverage;
            usdc.transfer(msg.sender, coverage);
            emit PayoutTriggered(msg.sender, coverage, 0);
        } else {
            uint256 usdcPaid = usdcPool;
            uint256 usycPaid = coverage - usdcPaid;
            usdcPool = 0;
            usycReserve -= usycPaid;
            if (usdcPaid > 0) usdc.transfer(msg.sender, usdcPaid);
            usyc.transfer(msg.sender, usycPaid);
            emit PayoutTriggered(msg.sender, usdcPaid, usycPaid);
        }
    }

    function depositReserve(uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_amount > 0, "Amount must be > 0");
        usyc.transferFrom(msg.sender, address(this), _amount);
        usycReserve += _amount;
        emit ReserveDeposited(_amount);
    }

    function withdrawUSDC(uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_amount <= usdcPool, "Insufficient USDC pool");
        usdcPool -= _amount;
        usdc.transfer(msg.sender, _amount);
    }

    function withdrawUSYC(uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_amount <= usycReserve, "Insufficient USYC reserve");
        usycReserve -= _amount;
        usyc.transfer(msg.sender, _amount);
    }

    function setOracleAddress(address _oracleAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_oracleAddress != address(0), "Invalid oracle address");
        address oldOracle = address(priceFeed);
        priceFeed = AggregatorV3Interface(_oracleAddress);
        emit OracleAddressUpdated(oldOracle, _oracleAddress);
    }

    function setThreshold(uint256 _thresholdFeet) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_thresholdFeet > 0 && _thresholdFeet <= MAX_THRESHOLD_FEET, "Invalid threshold");
        uint256 oldThreshold = floodThreshold;
        floodThreshold = _thresholdFeet * SCALING_FACTOR;
        emit ThresholdChanged(oldThreshold, floodThreshold);
    }
}
