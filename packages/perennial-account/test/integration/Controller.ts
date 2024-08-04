import HRE from 'hardhat'
import { expect } from 'chai'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { Address } from 'hardhat-deploy/dist/types'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { currentBlockTimestamp } from '../../../common/testutil/time'
import { parse6decimal } from '../../../common/testutil/types'
import { Account, Account__factory, Controller, IERC20Metadata } from '../../types/generated'
import { IAccountVerifier } from '../../types/generated/contracts/interfaces'
import { IAccountVerifier__factory } from '../../types/generated/factories/contracts/interfaces'
import {
  IKeeperOracle,
  IOracleFactory,
  IOracleProvider,
  PythFactory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { IMarket, IMarketFactory } from '@equilibria/perennial-v2/types/generated'
import { signDeployAccount, signMarketTransfer, signRebalanceConfigChange, signWithdrawal } from '../helpers/erc712'
import { advanceToPrice, getEventArguments } from '../helpers/setupHelpers'
import {
  createFactories,
  createMarketBTC,
  createMarketETH,
  deployAndInitializeController,
  fundWalletDSU,
  fundWalletUSDC,
} from '../helpers/arbitrumHelpers'

const { ethers } = HRE

// hack around intermittent issues estimating gas
const TX_OVERRIDES = { gasLimit: 3_000_000, maxFeePerGas: 200_000_000 }

describe('ControllerBase', () => {
  let dsu: IERC20Metadata
  let usdc: IERC20Metadata
  let controller: Controller
  let verifier: IAccountVerifier
  let oracleFactory: IOracleFactory
  let pythOracleFactory: PythFactory
  let marketFactory: IMarketFactory
  let ethMarket: IMarket
  let ethKeeperOracle: IKeeperOracle
  let accountA: Account
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let keeper: SignerWithAddress
  let receiver: SignerWithAddress
  let lastNonce = 0
  let lastPrice: BigNumber
  let currentTime: BigNumber

  // create a default action for the specified user with reasonable fee and expiry
  function createAction(
    userAddress: Address,
    signerAddress = userAddress,
    maxFee = utils.parseEther('14'),
    expiresInSeconds = 60,
  ) {
    return {
      action: {
        maxFee: maxFee,
        common: {
          account: userAddress,
          signer: signerAddress,
          domain: controller.address,
          nonce: nextNonce(),
          group: 0,
          expiry: currentTime.add(expiresInSeconds),
        },
      },
    }
  }

  // updates the oracle (optionally changing price) and settles the market
  async function advanceAndSettle(
    user: SignerWithAddress,
    receiver: SignerWithAddress,
    timestamp = currentTime,
    price = lastPrice,
    keeperOracle = ethKeeperOracle,
  ) {
    await advanceToPrice(keeperOracle, receiver, timestamp, price, TX_OVERRIDES)
    await ethMarket.settle(user.address, TX_OVERRIDES)
  }

  // ensures user has expected amount of collateral in a market
  async function expectMarketCollateralBalance(user: SignerWithAddress, amount: BigNumber) {
    const local = await ethMarket.locals(user.address)
    expect(local.collateral).to.equal(amount)
  }

  // funds specified wallet with 50k collateral
  async function fundWallet(wallet: SignerWithAddress): Promise<undefined> {
    await fundWalletDSU(wallet, utils.parseEther('50000'))
  }

  // create a serial nonce for testing purposes; real users may choose a nonce however they please
  function nextNonce(): BigNumber {
    lastNonce += 1
    return BigNumber.from(lastNonce)
  }

  // updates the market and returns the version timestamp
  async function changePosition(
    user: SignerWithAddress,
    newMaker = constants.MaxUint256,
    newLong = constants.MaxUint256,
    newShort = constants.MaxUint256,
  ): Promise<BigNumber> {
    const tx = await ethMarket
      .connect(user)
      ['update(address,uint256,uint256,uint256,int256,bool)'](
        user.address,
        newMaker,
        newLong,
        newShort,
        0,
        false,
        TX_OVERRIDES,
      )
    return (await getEventArguments(tx, 'OrderCreated')).order.timestamp
  }

  // performs a market transfer, returning the timestamp of the order produced
  async function transfer(
    amount: BigNumber,
    user: SignerWithAddress,
    market = ethMarket,
    signer = user,
  ): Promise<BigNumber> {
    const marketTransferMessage = {
      market: market.address,
      amount: amount,
      ...createAction(user.address, signer.address),
    }
    const signature = await signMarketTransfer(signer, verifier, marketTransferMessage)

    // determine expected event parameters
    let expectedFrom: Address, expectedTo: Address, expectedAmount: BigNumber
    if (amount.gt(constants.Zero)) {
      // deposits transfer from collateral account into market
      expectedFrom = accountA.address
      expectedTo = market.address
      if (amount === constants.MaxInt256) expectedAmount = await dsu.balanceOf(accountA.address)
      else expectedAmount = amount.mul(1e12)
    } else {
      // withdrawals transfer from market into account
      expectedFrom = market.address
      expectedTo = accountA.address
      if (amount === constants.MinInt256) expectedAmount = (await market.locals(user.address)).collateral.mul(1e12)
      else expectedAmount = amount.mul(-1e12)
    }

    // perform transfer
    await expect(
      await controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
    )
      .to.emit(dsu, 'Transfer')
      .withArgs(expectedFrom, expectedTo, expectedAmount)
      .to.emit(market, 'OrderCreated')
      .withArgs(userA.address, anyValue, anyValue, constants.AddressZero, constants.AddressZero, constants.AddressZero)

    const order = await market.pendingOrders(user.address, (await market.global()).currentId)
    return order.timestamp
  }

  const fixture = async () => {
    // set up users
    ;[owner, userA, userB, keeper, receiver] = await ethers.getSigners()

    // deploy controller
    ;[oracleFactory, marketFactory, pythOracleFactory] = await createFactories(owner)
    ;[dsu, usdc, controller] = await deployAndInitializeController(owner, marketFactory)
    verifier = IAccountVerifier__factory.connect(await controller.verifier(), owner)

    // create oracle, market, and set initial price
    let oracle: IOracleProvider
    ;[ethMarket, oracle, ethKeeperOracle] = await createMarketETH(
      owner,
      oracleFactory,
      pythOracleFactory,
      marketFactory,
      dsu,
      TX_OVERRIDES,
    )
    await advanceToPrice(ethKeeperOracle, receiver, currentTime, parse6decimal('3116.734999'), TX_OVERRIDES)
    lastPrice = (await oracle.status())[0].price

    // create a collateral account for userA with 15k collateral in it
    await fundWallet(userA)
    const accountAddressA = await controller.getAccountAddress(userA.address)
    await dsu.connect(userA).transfer(accountAddressA, utils.parseEther('15000'))
    const deployAccountMessage = {
      ...createAction(userA.address),
    }
    const signature = await signDeployAccount(userA, verifier, deployAccountMessage)
    await controller.connect(keeper).deployAccountWithSignature(deployAccountMessage, signature)
    accountA = Account__factory.connect(accountAddressA, userA)

    // approve the collateral account as operator
    await marketFactory.connect(userA).updateOperator(accountA.address, true)
  }

  beforeEach(async () => {
    currentTime = BigNumber.from(await currentBlockTimestamp())
    await loadFixture(fixture)
  })

  describe('#rebalance', () => {
    let btcMarket: IMarket

    beforeEach(async () => {
      // create another market, including requisite oracles, and set initial price
      let btcKeeperOracle
      ;[btcMarket, , btcKeeperOracle] = await createMarketBTC(
        owner,
        oracleFactory,
        pythOracleFactory,
        marketFactory,
        dsu,
      )
      await advanceToPrice(btcKeeperOracle, receiver, currentTime, parse6decimal('60606.369'), TX_OVERRIDES)

      // configure a group with both markets
      const message = {
        group: 1,
        markets: [ethMarket.address, btcMarket.address],
        configs: [
          { target: parse6decimal('0.65'), threshold: parse6decimal('0.04') },
          { target: parse6decimal('0.35'), threshold: parse6decimal('0.03') },
        ],
        maxFee: constants.Zero,
        ...(await createAction(userA.address)),
      }
      const signature = await signRebalanceConfigChange(userA, verifier, message)
      await expect(controller.connect(keeper).changeRebalanceConfigWithSignature(message, signature)).to.not.be.reverted
    })

    it('checks a group within targets', async () => {
      // transfer funds to the markets
      await transfer(parse6decimal('9700'), userA, ethMarket)
      await transfer(parse6decimal('5000'), userA, btcMarket)

      // check the group
      const [groupCollateral, canRebalance] = await controller.callStatic.checkGroup(userA.address, 1)
      expect(groupCollateral).to.equal(parse6decimal('14700'))
      expect(canRebalance).to.be.false
    })

    it('checks a group outside of targets', async () => {
      // transfer funds to the markets
      await transfer(parse6decimal('5000'), userA, ethMarket)
      await transfer(parse6decimal('5000'), userA, btcMarket)

      // check the group
      const [groupCollateral, canRebalance] = await controller.callStatic.checkGroup(userA.address, 1)
      expect(groupCollateral).to.equal(parse6decimal('10000'))
      expect(canRebalance).to.be.true
    })

    it('should not rebalance an already-balanced group', async () => {
      // transfer funds to the markets
      await transfer(parse6decimal('9700'), userA, ethMarket)
      await transfer(parse6decimal('5000'), userA, btcMarket)

      // attempt rebalance
      await expect(controller.rebalanceGroup(userA.address, 1, TX_OVERRIDES)).to.be.revertedWithCustomError(
        controller,
        'ControllerGroupBalancedError',
      )
    })

    it('rebalances group outside of threshold', async () => {
      // transfer funds to the markets
      await transfer(parse6decimal('7500'), userA, ethMarket)
      await transfer(parse6decimal('7500'), userA, btcMarket)

      await expect(controller.rebalanceGroup(userA.address, 1, TX_OVERRIDES))
        .to.emit(dsu, 'Transfer')
        .withArgs(btcMarket.address, accountA.address, utils.parseEther('2250'))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, ethMarket.address, utils.parseEther('2250'))
        .to.emit(controller, 'GroupRebalanced')
        .withArgs(userA.address, 1)

      // ensure group collateral unchanged and cannot rebalance
      const [groupCollateral, canRebalance] = await controller.callStatic.checkGroup(userA.address, 1)
      expect(groupCollateral).to.equal(parse6decimal('15000'))
      expect(canRebalance).to.be.false
    })

    it('handles groups with no collateral', async () => {
      await expect(controller.rebalanceGroup(userA.address, 1, TX_OVERRIDES)).to.be.revertedWithCustomError(
        controller,
        'ControllerGroupBalancedError',
      )
    })

    it('rebalances markets with no collateral', async () => {
      // transfer funds to one of the markets
      await transfer(parse6decimal('15000'), userA, btcMarket)

      await expect(controller.rebalanceGroup(userA.address, 1, TX_OVERRIDES))
        .to.emit(dsu, 'Transfer')
        .withArgs(btcMarket.address, accountA.address, utils.parseEther('9750'))
        .to.emit(dsu, 'Transfer')
        .withArgs(accountA.address, ethMarket.address, utils.parseEther('9750'))
        .to.emit(controller, 'GroupRebalanced')
        .withArgs(userA.address, 1)

      // ensure group collateral unchanged and cannot rebalance
      const [groupCollateral, canRebalance] = await controller.callStatic.checkGroup(userA.address, 1)
      expect(groupCollateral).to.equal(parse6decimal('15000'))
      expect(canRebalance).to.be.false
    })
  })

  describe('#transfer', () => {
    it('can deposit funds to a market', async () => {
      // sign a message to deposit 6k from the collateral account to the market
      const transferAmount = parse6decimal('6000')
      await transfer(transferAmount, userA)

      // verify balances
      await expectMarketCollateralBalance(userA, transferAmount)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('9000')) // 15k-6k
    })

    it('implicitly unwraps funds to deposit to a market', async () => {
      // account starts with 15k DSU
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('15000'))
      // deposit 5k USDC into the account
      const depositAmount = parse6decimal('5000')
      await fundWalletUSDC(userA, depositAmount)
      await usdc.connect(userA).transfer(accountA.address, depositAmount)
      expect(await usdc.balanceOf(accountA.address)).to.equal(depositAmount)

      // deposit all 20k into the market
      const transferAmount = parse6decimal('20000')
      await transfer(transferAmount, userA)

      // verify balances
      await expectMarketCollateralBalance(userA, parse6decimal('20000'))
      expect(await dsu.balanceOf(accountA.address)).to.equal(0)
      expect(await usdc.balanceOf(accountA.address)).to.equal(0)
    })

    it('delegated signer can transfer funds', async () => {
      // configure a delegate
      await marketFactory.connect(userA).updateSigner(userB.address, true)

      // sign a message to deposit 4k from the collateral account to the market
      const transferAmount = parse6decimal('4000')
      await transfer(transferAmount, userA, ethMarket, userB)

      // verify balances
      await expectMarketCollateralBalance(userA, transferAmount)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('11000')) // 15k-4k
    })

    it('can make multiple deposits to same market', async () => {
      for (let i = 0; i < 8; ++i) {
        currentTime = await transfer(parse6decimal('100'), userA)
        await advanceAndSettle(userA, receiver, currentTime)
      }
      await expectMarketCollateralBalance(userA, parse6decimal('800'))
    })

    it('can withdraw funds from a market', async () => {
      // perform an initial deposit
      await transfer(parse6decimal('10000'), userA)

      // withdraw 3k from the the market
      const transferAmount = parse6decimal('-3000')
      await transfer(transferAmount, userA)

      // verify balances
      await expectMarketCollateralBalance(userA, parse6decimal('7000')) // 10k-3k
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('8000')) // 15k-10k+3k
    })

    it('can fully withdraw from a market', async () => {
      // deposit 8k
      const depositAmount = parse6decimal('8000')
      await transfer(depositAmount, userA)

      // sign a message to fully withdraw from the market
      await transfer(constants.MinInt256, userA)

      // verify balances
      await expectMarketCollateralBalance(userA, constants.Zero)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('15000'))
    })

    it('cannot fully withdraw with position', async () => {
      // deposit 7k
      const depositAmount = parse6decimal('7000')
      await transfer(depositAmount, userA)

      // create a maker position
      currentTime = await changePosition(userA, parse6decimal('1.5'))
      await advanceAndSettle(userA, receiver)
      expect((await ethMarket.positions(userA.address)).maker).to.equal(parse6decimal('1.5'))

      // sign a message to fully withdraw from the market
      const marketTransferMessage = {
        market: ethMarket.address,
        amount: constants.MinInt256,
        ...createAction(userA.address),
      }
      const signature = await signMarketTransfer(userA, verifier, marketTransferMessage)

      // ensure transfer reverts
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      ).to.be.revertedWithCustomError(ethMarket, 'MarketInsufficientMarginError')

      await expectMarketCollateralBalance(userA, parse6decimal('7000'))
    })

    it('rejects withdrawal from unauthorized signer', async () => {
      // deposit 6k
      await transfer(parse6decimal('6000'), userA)

      // unauthorized user signs transfer message
      expect(await marketFactory.signers(accountA.address, userB.address)).to.be.false
      const marketTransferMessage = {
        market: ethMarket.address,
        amount: constants.MinInt256,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signMarketTransfer(userB, verifier, marketTransferMessage)

      // ensure withdrawal fails
      await expect(
        controller.connect(keeper).marketTransferWithSignature(marketTransferMessage, signature, TX_OVERRIDES),
      ).to.be.revertedWithCustomError(controller, 'ControllerInvalidSignerError')
    })
  })

  describe('#withdrawal', () => {
    it('can unwrap and partially withdraw funds from a signed message', async () => {
      // sign message to perform a partial withdrawal
      const withdrawalAmount = parse6decimal('6000')
      const withdrawalMessage = {
        amount: withdrawalAmount,
        unwrap: true,
        ...createAction(userA.address),
      }
      const signature = await signWithdrawal(userA, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature))
        .to.emit(usdc, 'Transfer')
        .withArgs(accountA.address, userA.address, withdrawalAmount)

      // ensure owner was credited the USDC and account's DSU was debited
      expect(await usdc.balanceOf(userA.address)).to.equal(withdrawalAmount)
      expect(await dsu.balanceOf(accountA.address)).to.equal(utils.parseEther('9000')) // 15k-9k
      expect(await usdc.balanceOf(accountA.address)).to.equal(0) // no USDC was deposited
    })

    it('can fully withdraw from a delegated signer', async () => {
      // configure userB as delegated signer
      await marketFactory.connect(userA).updateSigner(userB.address, true)

      // delegate signs message for full withdrawal
      const withdrawalMessage = {
        amount: constants.MaxUint256,
        unwrap: true,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // perform withdrawal and check balance
      await expect(controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature)).to.not.be.reverted

      // ensure owner was credit all the USDC and account is empty
      expect(await usdc.balanceOf(userA.address)).to.equal(parse6decimal('15000'))
      expect(await dsu.balanceOf(accountA.address)).to.equal(0) // all DSU was withdrawan
      expect(await usdc.balanceOf(accountA.address)).to.equal(0) // no USDC was deposited
    })

    it('rejects withdrawals from unauthorized signer', async () => {
      expect(await marketFactory.signers(accountA.address, userB.address)).to.be.false

      // unauthorized user signs message for withdrawal
      const withdrawalMessage = {
        amount: parse6decimal('2000'),
        unwrap: false,
        ...createAction(userA.address, userB.address),
      }
      const signature = await signWithdrawal(userB, verifier, withdrawalMessage)

      // ensure withdrawal fails
      await expect(
        controller.connect(keeper).withdrawWithSignature(withdrawalMessage, signature),
      ).to.be.revertedWithCustomError(controller, 'ControllerInvalidSignerError')
    })
  })
})
