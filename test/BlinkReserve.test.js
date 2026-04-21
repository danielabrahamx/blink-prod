// BlinkReserve parity tests against the retired Paramify contract ABI.
// Uses OpenZeppelin AccessControl's DEFAULT_ADMIN_ROLE behavior.
// Exercises deposit, withdraw USDC/USYC, triggerPayout, threshold admin.

const { expect } = require("chai");
const { ethers } = require("hardhat");

const MOCK_PRICE_BELOW = 1_000_000_000_000n; // 10 ft
const MOCK_PRICE_ABOVE = 1_500_000_000_000n; // 15 ft (threshold is 12 ft)

describe("BlinkReserve", function () {
  async function deployFixture() {
    const [admin, customer, other] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("MockERC20Settlement");
    const usdc = await USDC.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const usyc = await USDC.deploy("USYC", "USYC", 6);
    await usyc.waitForDeployment();

    const Oracle = await ethers.getContractFactory("MockAggregatorSettlement");
    const oracle = await Oracle.deploy(MOCK_PRICE_BELOW);
    await oracle.waitForDeployment();

    const BlinkReserve = await ethers.getContractFactory("BlinkReserve");
    const reserve = await BlinkReserve.deploy(
      await oracle.getAddress(),
      await usdc.getAddress(),
      await usyc.getAddress()
    );
    await reserve.waitForDeployment();

    await usdc.mint(await customer.getAddress(), 10_000_000n); // 10 USDC
    await usyc.mint(await admin.getAddress(), 1_000_000_000n); // 1000 USYC

    return { reserve, usdc, usyc, oracle, admin, customer, other };
  }

  it("constructor wires token + oracle immutables", async function () {
    const { reserve, usdc, usyc, oracle } = await deployFixture();
    expect(await reserve.usdc()).to.equal(await usdc.getAddress());
    expect(await reserve.usyc()).to.equal(await usyc.getAddress());
    expect(await reserve.priceFeed()).to.equal(await oracle.getAddress());
  });

  it("admin can deposit USYC into the reserve", async function () {
    const { reserve, usyc, admin } = await deployFixture();
    await usyc.connect(admin).approve(await reserve.getAddress(), 500_000_000n);
    await expect(reserve.connect(admin).depositReserve(500_000_000n))
      .to.emit(reserve, "ReserveDeposited")
      .withArgs(500_000_000n);
    expect(await reserve.usycReserve()).to.equal(500_000_000n);
  });

  it("non-admin cannot depositReserve", async function () {
    const { reserve, usyc, other } = await deployFixture();
    await usyc.mint(await other.getAddress(), 1_000_000n);
    await usyc.connect(other).approve(await reserve.getAddress(), 1_000_000n);
    await expect(reserve.connect(other).depositReserve(1_000_000n))
      .to.be.reverted;
  });

  it("buyInsurance pulls premium and tracks the policy", async function () {
    const { reserve, usdc, customer } = await deployFixture();
    await usdc.connect(customer).approve(await reserve.getAddress(), 10_000_000n);
    await reserve.connect(customer).buyInsurance(10_000_000n);
    const policy = await reserve.policies(await customer.getAddress());
    expect(policy.active).to.equal(true);
    expect(policy.coverage).to.equal(10_000_000n);
    expect(policy.premium).to.equal(1_000_000n);
    expect(await reserve.usdcPool()).to.equal(1_000_000n);
  });

  it("triggerPayout reverts below threshold", async function () {
    const { reserve, usdc, customer } = await deployFixture();
    await usdc.connect(customer).approve(await reserve.getAddress(), 10_000_000n);
    await reserve.connect(customer).buyInsurance(10_000_000n);
    await expect(reserve.connect(customer).triggerPayout()).to.be.revertedWith(
      "Flood level below threshold"
    );
  });

  it("triggerPayout pays the full coverage when pool is sufficient", async function () {
    const { reserve, usdc, usyc, oracle, admin, customer } = await deployFixture();
    // fund reserve + buy policy
    await usyc.connect(admin).approve(await reserve.getAddress(), 100_000_000n);
    await reserve.connect(admin).depositReserve(100_000_000n);
    await usdc.mint(await admin.getAddress(), 50_000_000n);
    await usdc.connect(admin).approve(await reserve.getAddress(), 50_000_000n);
    await usdc.connect(customer).approve(await reserve.getAddress(), 10_000_000n);
    await reserve.connect(customer).buyInsurance(10_000_000n); // premium 1_000_000

    // Pad USDC pool so payout >= coverage: deposit extra directly via admin withdraw path (simulated)
    // buy more policies under other senders to enlarge pool
    const [, , , whale] = await ethers.getSigners();
    await usdc.mint(await whale.getAddress(), 100_000_000n);
    await usdc.connect(whale).approve(await reserve.getAddress(), 100_000_000n);
    await reserve.connect(whale).buyInsurance(100_000_000n); // premium 10_000_000

    await oracle.setPrice(MOCK_PRICE_ABOVE);
    await expect(reserve.connect(customer).triggerPayout())
      .to.emit(reserve, "PayoutTriggered");
    const policy = await reserve.policies(await customer.getAddress());
    expect(policy.paidOut).to.equal(true);
  });

  it("withdrawUSDC and withdrawUSYC require admin role", async function () {
    const { reserve, other } = await deployFixture();
    await expect(reserve.connect(other).withdrawUSDC(1n)).to.be.reverted;
    await expect(reserve.connect(other).withdrawUSYC(1n)).to.be.reverted;
  });

  it("setThreshold rejects absurd values", async function () {
    const { reserve } = await deployFixture();
    await expect(reserve.setThreshold(0)).to.be.revertedWith("Invalid threshold");
    await expect(reserve.setThreshold(1000)).to.be.revertedWith("Invalid threshold");
    await reserve.setThreshold(8);
    expect(await reserve.floodThreshold()).to.equal(800_000_000_000n);
  });
});
