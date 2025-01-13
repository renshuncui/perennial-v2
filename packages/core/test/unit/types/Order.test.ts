import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  OrderGlobalTester,
  OrderLocalTester,
  OrderGlobalTester__factory,
  OrderLocalTester__factory,
} from '../../../types/generated'
import { BigNumber, BigNumberish } from 'ethers'
import { OrderStruct } from '../../../types/generated/contracts/Market'
import { parse6decimal } from '../../../../common/testutil/types'
import { VALID_ORACLE_VERSION } from './Position.test'
import { VALID_MARKET_PARAMETER } from './MarketParameter.test'
import { DEFAULT_POSITION, DEFAULT_ORDER } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Order', () => {
  let owner: SignerWithAddress

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()
  })

  describe('global', () => {
    const VALID_STORED_ORDER: OrderStruct = {
      timestamp: 10,
      orders: 2,
      makerPos: 3,
      makerNeg: 4,
      longPos: 5,
      longNeg: 6,
      shortPos: 7,
      shortNeg: 8,
      collateral: 9,
      protection: 1,
      invalidation: 13,
      makerReferral: 11,
      takerReferral: 12,
    }

    let orderGlobal: OrderGlobalTester

    beforeEach(async () => {
      orderGlobal = await new OrderGlobalTester__factory(owner).deploy()
    })

    describe('common behavoir', () => {
      shouldBehaveLike(() => ({ order: orderGlobal, validStoredOrder: VALID_STORED_ORDER }))
    })
  })

  describe('local', () => {
    const VALID_STORED_ORDER: OrderStruct = {
      timestamp: 10,
      orders: 2,
      makerPos: 3,
      makerNeg: 4,
      longPos: 0,
      longNeg: 0,
      shortPos: 0,
      shortNeg: 0,
      collateral: 9,
      protection: 1,
      invalidation: 13,
      makerReferral: 11,
      takerReferral: 12,
    }

    let orderLocal: OrderLocalTester

    beforeEach(async () => {
      orderLocal = await new OrderLocalTester__factory(owner).deploy()
    })

    describe('common behavior', () => {
      shouldBehaveLike(() => ({ order: orderLocal, validStoredOrder: VALID_STORED_ORDER }))
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await orderLocal.store(VALID_STORED_ORDER)

        const value = await orderLocal.read()
        expect(value.makerPos).to.equal(3)
        expect(value.makerNeg).to.equal(4)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(1)
        expect(value.invalidation).to.equal(13)
      })

      context('.protection', async () => {
        const STORAGE_SIZE = 1
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            protection: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.protection).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              protection: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })

      context('.invalidation', async () => {
        const STORAGE_SIZE = 8
        it('saves if in range', async () => {
          await orderLocal.store({
            ...DEFAULT_ORDER,
            invalidation: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await orderLocal.read()
          expect(value.invalidation).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            orderLocal.store({
              ...DEFAULT_ORDER,
              invalidation: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(orderLocal, 'OrderStorageInvalidError')
        })
      })
    })

    describe('#from', () => {
      it('opens a new maker order without referral fee', async () => {
        const makerAmount = parse6decimal('1')
        await orderLocal.from(0, DEFAULT_POSITION, makerAmount, 0, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(parse6decimal('1'))
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new maker order with referral fee', async () => {
        const makerAmount = parse6decimal('1')
        await orderLocal.from(0, DEFAULT_POSITION, makerAmount, 0, 0, false, true, parse6decimal('0.02'))
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(parse6decimal('1'))
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(parse6decimal('0.02'))
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new long order without referral fee', async () => {
        const takerAmount = parse6decimal('1')
        await orderLocal.from(0, DEFAULT_POSITION, 0, takerAmount, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(parse6decimal('1'))
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new long order with referral fee', async () => {
        const takerAmount = parse6decimal('1')
        await orderLocal.from(0, DEFAULT_POSITION, 0, takerAmount, 0, false, true, parse6decimal('0.02'))
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(parse6decimal('1'))
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(parse6decimal('0.02'))
        expect(value.collateral).to.equal(0)
      })

      it('opens a new short order without referral fee', async () => {
        const takerAmount = parse6decimal('-1')
        await orderLocal.from(0, DEFAULT_POSITION, 0, takerAmount, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(parse6decimal('1'))
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new short order with referral fee', async () => {
        const takerAmount = parse6decimal('-1')
        await orderLocal.from(0, DEFAULT_POSITION, 0, takerAmount, 0, false, true, parse6decimal('0.02'))
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(parse6decimal('1'))
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(parse6decimal('0.02'))
        expect(value.collateral).to.equal(0)
      })

      it('opens a new order with protection', async () => {
        await orderLocal.from(0, DEFAULT_POSITION, 0, 0, 0, true, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(0)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(1)
        expect(value.invalidation).to.equal(0) // empty
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new maker order with existing maker position', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          maker: parse6decimal('10'),
        }
        const makerAmount = parse6decimal('1')
        await orderLocal.from(0, POSITION, makerAmount, 0, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(parse6decimal('1'))
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('closes a new maker order with existing maker position', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          maker: parse6decimal('10'),
        }
        const makerAmount = parse6decimal('-1')
        await orderLocal.from(0, POSITION, makerAmount, 0, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(parse6decimal('1'))
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new long order with existing long position', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          long: parse6decimal('10'),
        }
        const takerAmount = parse6decimal('1')
        await orderLocal.from(0, POSITION, 0, takerAmount, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(parse6decimal('1'))
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('closes a new long order with existing long position', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          long: parse6decimal('10'),
        }
        const takerAmount = parse6decimal('-1')
        await orderLocal.from(0, POSITION, 0, takerAmount, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(parse6decimal('1'))
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new short order with existing short position', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          short: parse6decimal('10'),
        }
        const takerAmount = parse6decimal('-1')
        await orderLocal.from(0, POSITION, 0, takerAmount, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(parse6decimal('1'))
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('closes a new short order with existing short position', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          short: parse6decimal('10'),
        }
        const takerAmount = parse6decimal('1')
        await orderLocal.from(0, POSITION, 0, takerAmount, 0, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(parse6decimal('1'))
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(1)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })

      it('opens a new order for depositing collateral', async () => {
        const collateral = parse6decimal('1')
        await orderLocal.from(0, DEFAULT_POSITION, 0, 0, collateral, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(0)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(0) // empty
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(collateral)
      })

      it('opens a new order for withdrawing collateral', async () => {
        const collateral = parse6decimal('-1')
        await orderLocal.from(0, DEFAULT_POSITION, 0, 0, collateral, false, true, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(0)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(0)
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(0) // empty
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(collateral)
      })

      it('opens an intent order', async () => {
        const POSITION = {
          ...DEFAULT_POSITION,
          long: parse6decimal('10'),
        }
        const takerAmount = parse6decimal('1')
        await orderLocal.from(0, POSITION, 0, takerAmount, 0, false, false, 0)
        const value = await orderLocal.read()
        expect(value.orders).to.equal(1)
        expect(value.makerPos).to.equal(0)
        expect(value.makerNeg).to.equal(0)
        expect(value.longPos).to.equal(parse6decimal('1'))
        expect(value.longNeg).to.equal(0)
        expect(value.shortPos).to.equal(0)
        expect(value.shortNeg).to.equal(0)
        expect(value.protection).to.equal(0)
        expect(value.invalidation).to.equal(0)
        expect(value.makerReferral).to.equal(0)
        expect(value.takerReferral).to.equal(0)
        expect(value.collateral).to.equal(0)
      })
    })
  })

  function shouldBehaveLike(
    getter: () => {
      order: OrderLocalTester | OrderGlobalTester
      validStoredOrder: OrderStruct
    },
  ) {
    let order: OrderLocalTester | OrderGlobalTester
    let validStoredOrder: OrderStruct

    beforeEach(async () => {
      ;({ order, validStoredOrder } = getter())
    })

    describe('#store', () => {
      it('stores a new value', async () => {
        await order.store(validStoredOrder)

        const value = await order.read()
        expect(value.timestamp).to.equal(10)
        expect(value.orders).to.equal(2)
        expect(value.collateral).to.equal(9)
        expect(value.makerReferral).to.equal(11)
        expect(value.takerReferral).to.equal(12)
      })

      context('.timestamp', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            timestamp: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.timestamp).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              timestamp: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.orders', async () => {
        const STORAGE_SIZE = 32
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            orders: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.orders).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              orders: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.collateral', async () => {
        const STORAGE_SIZE = 63
        it('saves if in range (above)', async () => {
          await order.store({
            ...validStoredOrder,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('saves if in range (below)', async () => {
          await order.store({
            ...validStoredOrder,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
          })
          const value = await order.read()
          expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
        })

        it('reverts if collateral out of range (above)', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              collateral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })

        it('reverts if collateral out of range (below)', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.makerPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...DEFAULT_ORDER,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.makerNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.makerNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...DEFAULT_ORDER,
              makerNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.longPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.longPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...DEFAULT_ORDER,
              longPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.longNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.makerPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...DEFAULT_ORDER,
              makerPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.shortPos', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.shortPos).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...DEFAULT_ORDER,
              shortPos: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.shortNeg', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortNeg: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.shortNeg).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...DEFAULT_ORDER,
              shortNeg: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.makerReferral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            makerReferral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.makerReferral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              makerReferral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })

      context('.takerReferral', async () => {
        const STORAGE_SIZE = 64
        it('saves if in range', async () => {
          await order.store({
            ...validStoredOrder,
            takerReferral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
          })
          const value = await order.read()
          expect(value.takerReferral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
        })

        it('reverts if currentId out of range', async () => {
          await expect(
            order.store({
              ...validStoredOrder,
              takerReferral: BigNumber.from(2).pow(STORAGE_SIZE),
            }),
          ).to.be.revertedWithCustomError(order, 'OrderStorageInvalidError')
        })
      })
    })

    describe('#ready', () => {
      context('oracleVersion.timestamp > position.timestamp', () => {
        it('returns true', async () => {
          await order.store({ ...DEFAULT_ORDER, timestamp: 2 })
          expect(await order.ready(VALID_ORACLE_VERSION)).to.be.true
        })
      })

      context('position.timestamp = oracleVersion.timestamp', () => {
        it('returns true', async () => {
          await order.store({ ...DEFAULT_ORDER, timestamp: VALID_ORACLE_VERSION.timestamp })
          expect(await order.ready(VALID_ORACLE_VERSION)).to.be.true
        })
      })

      context('oracleVersion.timestamp < position.timestamp', () => {
        it('returns false', async () => {
          await order.store({ ...DEFAULT_ORDER, timestamp: 12346 })
          expect(await order.ready(VALID_ORACLE_VERSION)).to.be.false
        })
      })
    })

    describe('#increasesPosition', () => {
      context('maker increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          })
          const result = await order.increasesPosition()

          expect(result).to.be.true
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          })
          const result = await order.increasesPosition()

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          })
          const result = await order.increasesPosition()

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.increasesPosition()

          expect(result).to.be.false
        })
      })
    })

    describe('#increasesTaker', () => {
      context('maker increase', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          })
          const result = await order.increasesTaker()

          expect(result).to.be.false
        })
      })

      context('long increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          })
          const result = await order.increasesTaker()

          expect(result).to.be.true
        })
      })

      context('short increase', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          })
          const result = await order.increasesTaker()

          expect(result).to.be.true
        })
      })

      context('no increase', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.increasesTaker()

          expect(result).to.be.false
        })
      })
    })

    describe('#decreasesLiquidity', () => {
      context('maker reduces', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerNeg: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
          })

          expect(result).to.be.true
        })
      })

      context('maker increases', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
          })

          expect(result).to.be.false
        })
      })

      context('maker equal', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.decreasesLiquidity(DEFAULT_POSITION)

          expect(result).to.be.false
        })
      })

      context('decreases net long', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.false
        })
      })

      context('decreases net short', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.false
        })
      })

      context('increases net long', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longNeg: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('0'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.true
        })
      })

      context('increases net short', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortNeg: parse6decimal('10'),
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('0'),
          })

          expect(result).to.be.true
        })
      })

      context('equal net', () => {
        it('returns true', async () => {
          await order.store({
            ...DEFAULT_ORDER,
          })
          const result = await order.decreasesLiquidity({
            ...DEFAULT_POSITION,
            long: parse6decimal('10'),
            short: parse6decimal('10'),
          })

          expect(result).to.be.false
        })
      })
    })

    describe('#liquidityCheckApplicable', () => {
      context('market is closed', () => {
        it('returns false', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.liquidityCheckApplicable({
            ...VALID_MARKET_PARAMETER,
            closed: true,
          })

          expect(result).to.be.false
        })
      })

      context('market is open', () => {
        context('long increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, longPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
            })

            expect(result).to.be.true
          })
        })

        context('short increase', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, shortPos: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
            })

            expect(result).to.be.true
          })
        })

        context('maker decrease', () => {
          it('returns true', async () => {
            await order.store({ ...DEFAULT_ORDER, makerNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
            })

            expect(result).to.be.true
          })
        })

        context('long decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, longNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
            })

            expect(result).to.be.false
          })
        })

        context('short decrease', () => {
          it('returns false', async () => {
            await order.store({ ...DEFAULT_ORDER, shortNeg: 10 })
            const result = await order.liquidityCheckApplicable({
              ...VALID_MARKET_PARAMETER,
            })

            expect(result).to.be.false
          })
        })
      })
    })

    describe('#isEmpty', () => {
      context('order is empty', () => {
        it('returns true', async () => {
          await order.store(DEFAULT_ORDER)
          const result = await order.isEmpty()

          expect(result).to.be.true
        })
      })

      context('order is not empty (makerPos)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerPos: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (makerNeg)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            makerNeg: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (longPos)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longPos: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (longNeg)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            longNeg: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (shortPos)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortPos: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })

      context('order is not empty (shortNeg)', () => {
        it('returns false', async () => {
          await order.store({
            ...DEFAULT_ORDER,
            shortNeg: parse6decimal('1'),
          })
          const result = await order.isEmpty()

          expect(result).to.be.false
        })
      })
    })

    describe('#crossesZero', () => {
      it('crosses zero (long)', async () => {
        await order.store({ ...DEFAULT_ORDER, longPos: 4, shortPos: 7, shortNeg: 8 })
        expect(await order.crossesZero()).to.equal(true)
      })

      it('crosses zero (short)', async () => {
        await order.store({ ...DEFAULT_ORDER, longPos: 4, longNeg: 5, shortPos: 7 })
        expect(await order.crossesZero()).to.equal(true)
      })

      it('doesnt crosses zero (long)', async () => {
        await order.store({ ...DEFAULT_ORDER, longPos: 4, longNeg: 5 })
        expect(await order.crossesZero()).to.equal(false)
      })

      it('doesnt crosses zero (short)', async () => {
        await order.store({ ...DEFAULT_ORDER, longPos: 4, longNeg: 5 })
        expect(await order.crossesZero()).to.equal(false)
      })
    })
  }
})
