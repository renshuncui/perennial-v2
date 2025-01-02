import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  CheckpointLib,
  CheckpointLib__factory,
  CheckpointStorageLib,
  CheckpointStorageLib__factory,
  CheckpointTester,
  CheckpointTester__factory,
  IMarket__factory,
} from '../../../types/generated'
import { BigNumber } from 'ethers'
import {
  CheckpointStruct,
  PositionStruct,
  VersionStruct,
  OrderStruct,
  GuaranteeStruct,
} from '../../../types/generated/contracts/Market'
import {
  DEFAULT_ORDER,
  DEFAULT_CHECKPOINT,
  DEFAULT_VERSION,
  DEFAULT_POSITION,
  DEFAULT_GUARANTEE,
  DEFAULT_CONTEXT,
  DEFAULT_SETTLEMENT_CONTEXT,
  parse6decimal,
} from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

const ORDER_ID = BigNumber.from(17)

const accumulateWithReturn = async (
  checkpoint: CheckpointTester,
  account: string,
  orderId: BigNumber,
  order: OrderStruct,
  guarantee: GuaranteeStruct,
  fromPosition: PositionStruct,
  fromVersion: VersionStruct,
  toVersion: VersionStruct,
) => {
  const marketInterface = new ethers.utils.Interface(IMarket__factory.abi)
  const accumulationResult = await checkpoint.callStatic.accumulate(
    { ...DEFAULT_CONTEXT, account, latestPositionLocal: fromPosition },
    { ...DEFAULT_SETTLEMENT_CONTEXT },
    orderId,
    order,
    guarantee,
    fromVersion,
    toVersion,
  )
  const tx = await checkpoint.accumulate(
    { ...DEFAULT_CONTEXT, account, latestPositionLocal: fromPosition },
    { ...DEFAULT_SETTLEMENT_CONTEXT },
    orderId,
    order,
    guarantee,
    fromVersion,
    toVersion,
  )
  const result = await tx.wait()
  const value = await checkpoint.read()
  return {
    ret: marketInterface.parseLog(result.events![0]).args.accumulationResult,
    value,
    rsp: accumulationResult[1],
  }
}

describe('Checkpoint', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let checkpointLib: CheckpointLib
  let checkpointStorageLib: CheckpointStorageLib
  let checkpoint: CheckpointTester

  const VALID_CHECKPOINT: CheckpointStruct = {
    tradeFee: 3,
    settlementFee: 4,
    transfer: 6,
    collateral: 5,
  }

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    checkpointLib = await new CheckpointLib__factory(owner).deploy()
    checkpointStorageLib = await new CheckpointStorageLib__factory(owner).deploy()
    checkpoint = await new CheckpointTester__factory(
      {
        'contracts/libs/CheckpointLib.sol:CheckpointLib': checkpointLib.address,
        'contracts/types/Checkpoint.sol:CheckpointStorageLib': checkpointStorageLib.address,
      },
      owner,
    ).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await checkpoint.store(VALID_CHECKPOINT)

      const value = await checkpoint.read()
      expect(value.tradeFee).to.equal(3)
      expect(value.settlementFee).to.equal(4)
      expect(value.transfer).to.equal(6)
      expect(value.collateral).to.equal(5)
    })

    describe('.tradeFee', async () => {
      const STORAGE_SIZE = 47
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.tradeFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.tradeFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if tradeFee out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            tradeFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })

      it('reverts if tradeFee out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            tradeFee: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })
    })

    describe('.settlementFee', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          settlementFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.settlementFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if settlementFee out of range)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            settlementFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })
    })

    describe('.transfer', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          transfer: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.transfer).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          transfer: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.transfer).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if delta out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            transfer: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })

      it('reverts if delta out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            transfer: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })
    })

    describe('.collateral', async () => {
      const STORAGE_SIZE = 63
      it('saves if in range (above)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await checkpoint.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('saves if in range (below)', async () => {
        await checkpoint.store({
          ...VALID_CHECKPOINT,
          collateral: BigNumber.from(2).pow(STORAGE_SIZE).mul(-1),
        })
        const value = await checkpoint.read()
        expect(value.collateral).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).mul(-1))
      })

      it('reverts if collateral out of range (above)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })

      it('reverts if collateral out of range (below)', async () => {
        await expect(
          checkpoint.store({
            ...VALID_CHECKPOINT,
            collateral: BigNumber.from(2).pow(STORAGE_SIZE).add(1).mul(-1),
          }),
        ).to.be.revertedWithCustomError(checkpointStorageLib, 'CheckpointStorageInvalidError')
      })
    })
  })

  describe('#accumulate', () => {
    context('zero initial values', () => {
      beforeEach(async () => {
        await checkpoint.store({
          ...DEFAULT_CHECKPOINT,
        })
      })

      it('accumulates transfer', async () => {
        const { value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, collateral: parse6decimal('123') },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION },
        )

        expect(value.transfer).to.equal(parse6decimal('123'))
      })

      it('accumulates price override pnl (long)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, longPos: parse6decimal('10'), longNeg: parse6decimal('5') },
          {
            ...DEFAULT_GUARANTEE,
            longPos: parse6decimal('5'),
            longNeg: parse6decimal('2'),
            notional: parse6decimal('300'),
          },
          { ...DEFAULT_POSITION, long: parse6decimal('5') },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, price: parse6decimal('123') },
        )
        expect(ret.priceOverride).to.equal(parse6decimal('69')) // open 3 long @ 100 w/ 123 price

        expect(value.collateral).to.equal(parse6decimal('69'))
      })

      it('accumulates price override pnl (short)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, shortPos: parse6decimal('10'), shortNeg: parse6decimal('5') },
          {
            ...DEFAULT_GUARANTEE,
            shortPos: parse6decimal('5'),
            shortNeg: parse6decimal('2'),
            notional: parse6decimal('-300'),
          },
          { ...DEFAULT_POSITION, short: parse6decimal('5') },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, price: parse6decimal('123') },
        )
        expect(ret.priceOverride).to.equal(parse6decimal('-69')) // open 3 short @ 100 w/ 123 price

        expect(value.collateral).to.equal(parse6decimal('-69'))
      })

      it('accumulates pnl (maker)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, maker: parse6decimal('10') },
          { ...DEFAULT_VERSION, makerPreValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, makerPreValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates pnl (long)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, long: parse6decimal('10') },
          { ...DEFAULT_VERSION, longPreValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, longPreValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates pnl (short)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, short: parse6decimal('10') },
          { ...DEFAULT_VERSION, shortPreValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, shortPreValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates received spread (maker close)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, maker: parse6decimal('10') },
          { ...DEFAULT_VERSION, makerCloseValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, makerCloseValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates received spread (long close)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, long: parse6decimal('10') },
          { ...DEFAULT_VERSION, longCloseValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, longCloseValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates received spread (short close)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, short: parse6decimal('10') },
          { ...DEFAULT_VERSION, shortCloseValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, shortCloseValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates received spread (long post)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, long: parse6decimal('10') },
          { ...DEFAULT_VERSION, longPostValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, longPostValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates received spread (short post)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, short: parse6decimal('10') },
          { ...DEFAULT_VERSION, shortPostValue: { _value: parse6decimal('100') } },
          { ...DEFAULT_VERSION, shortPostValue: { _value: parse6decimal('200') } },
        )
        expect(ret.collateral).to.equal(parse6decimal('1000'))

        expect(value.collateral).to.equal(parse6decimal('1000'))
      })

      it('accumulates fees (maker)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, makerPos: parse6decimal('10') },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, makerFee: { _value: parse6decimal('-2') } },
        )
        expect(ret.tradeFee).to.equal(parse6decimal('20'))

        expect(value.tradeFee).to.equal(parse6decimal('20'))
      })

      it('accumulates fees (taker)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, longPos: parse6decimal('10') },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, takerFee: { _value: parse6decimal('-2') } },
        )
        expect(ret.tradeFee).to.equal(parse6decimal('20'))

        expect(value.tradeFee).to.equal(parse6decimal('20'))
      })

      it('accumulates charged price impact (spread pos)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, longPos: parse6decimal('10') },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, spreadPos: { _value: parse6decimal('-2') }, longPosExposure: parse6decimal('1') },
        )
        expect(ret.spread).to.equal(parse6decimal('20'))

        expect(value.tradeFee).to.equal(parse6decimal('20'))
      })

      it('accumulates charged price impact (spread neg)', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, longNeg: parse6decimal('10') },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION, long: parse6decimal('10') },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, spreadNeg: { _value: parse6decimal('-2') }, longNegExposure: parse6decimal('-1') },
        )
        expect(ret.spread).to.equal(parse6decimal('20'))

        expect(value.tradeFee).to.equal(parse6decimal('20'))
      })

      it('accumulates settlement fee', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, orders: 2 },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, settlementFee: { _value: parse6decimal('-4') } },
        )
        expect(ret.settlementFee).to.equal(parse6decimal('8'))

        expect(value.settlementFee).to.equal(parse6decimal('8'))
      })

      it('accumulates liquidation fee', async () => {
        const { ret, value } = await accumulateWithReturn(
          checkpoint,
          user.address,
          ORDER_ID,
          { ...DEFAULT_ORDER, protection: 1 },
          { ...DEFAULT_GUARANTEE },
          { ...DEFAULT_POSITION },
          { ...DEFAULT_VERSION },
          { ...DEFAULT_VERSION, liquidationFee: { _value: parse6decimal('-4') } },
        )
        expect(ret.liquidationFee).to.equal(parse6decimal('4'))

        expect(value.settlementFee).to.equal(parse6decimal('4'))
      })
    })
  })
})
