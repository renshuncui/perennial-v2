import { smock, FakeContract } from '@defi-wonderland/smock'
import { BigNumber, constants, ContractTransaction, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import { impersonate } from '../../../../common/testutil'

import {
  Market,
  Market__factory,
  IOracleProvider,
  IERC20Metadata,
  IMarketFactory,
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
  IVerifier,
  MockToken,
  MockToken__factory,
} from '../../../types/generated'
import {
  DEFAULT_POSITION,
  DEFAULT_LOCAL,
  DEFAULT_ORDER,
  DEFAULT_CHECKPOINT,
  DEFAULT_VERSION,
  expectGlobalEq,
  expectLocalEq,
  expectPositionEq,
  expectVersionEq,
  parse6decimal,
  expectOrderEq,
  expectCheckpointEq,
  DEFAULT_GLOBAL,
  DEFAULT_GUARANTEE,
  DEFAULT_ORACLE_RECEIPT,
  expectGuaranteeEq,
  SynBook,
} from '../../../../common/testutil/types'
import {
  AccountPositionProcessedEventObject,
  IMarket,
  IntentStruct,
  MarketParameterStruct,
  PositionProcessedEventObject,
  RiskParameterStruct,
} from '../../../types/generated/contracts/Market'

const { ethers } = HRE

const POSITION = parse6decimal('10.000')
const COLLATERAL = parse6decimal('10000')
const TIMESTAMP = 1636401093
const PRICE = parse6decimal('123')

const INITIALIZED_ORACLE_RECEIPT = {
  ...DEFAULT_ORACLE_RECEIPT,
  oracleFee: parse6decimal('0.1'), // initialize all tests to 10% oracle fee
}

const DEFAULT_VERSION_ACCUMULATION_RESULT = {
  tradeFee: 0,
  subtractiveFee: 0,

  spreadPos: 0,
  spreadNeg: 0,

  spreadMaker: 0,
  spreadPreLong: 0,
  spreadPreShort: 0,
  spreadCloseLong: 0,
  spreadCloseShort: 0,
  spreadPostLong: 0,
  spreadPostShort: 0,

  fundingMaker: 0,
  fundingLong: 0,
  fundingShort: 0,
  fundingFee: 0,

  interestMaker: 0,
  interestLong: 0,
  interestShort: 0,
  interestFee: 0,

  pnlMaker: 0,
  pnlLong: 0,
  pnlShort: 0,

  settlementFee: 0,
  liquidationFee: 0,
}

const DEFAULT_LOCAL_ACCUMULATION_RESULT = {
  collateral: 0,
  priceOverride: 0,
  tradeFee: 0,
  spread: 0,
  settlementFee: 0,
  liquidationFee: 0,
  subtractiveFee: 0,
  solverFee: 0,
}

const DEFAULT_SYN_BOOK = {
  d0: parse6decimal('0.001'),
  d1: parse6decimal('0.002'),
  d2: parse6decimal('0.004'),
  d3: parse6decimal('0.008'),
  scale: parse6decimal('5'),
}

const ORACLE_VERSION_0 = {
  price: BigNumber.from(0),
  timestamp: 0,
  valid: false,
}

const ORACLE_VERSION_1 = {
  price: PRICE,
  timestamp: TIMESTAMP,
  valid: true,
}

const ORACLE_VERSION_2 = {
  price: PRICE,
  timestamp: TIMESTAMP + 3600,
  valid: true,
}

const ORACLE_VERSION_3 = {
  price: PRICE,
  timestamp: TIMESTAMP + 7200,
  valid: true,
}

const ORACLE_VERSION_4 = {
  price: PRICE,
  timestamp: TIMESTAMP + 10800,
  valid: true,
}

const ORACLE_VERSION_5 = {
  price: PRICE,
  timestamp: TIMESTAMP + 14400,
  valid: true,
}

const ORACLE_VERSION_6 = {
  price: PRICE,
  timestamp: TIMESTAMP + 18000,
  valid: true,
}

// signature verification is mocked in unit tests
const DEFAULT_SIGNATURE =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01'

// rate_0 = 0
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0 + (0 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 3160
const EXPECTED_FUNDING_1_5_123 = BigNumber.from(3160)
const EXPECTED_FUNDING_FEE_1_5_123 = BigNumber.from(320) // (3159 + 157) = 3316 / 5 -> 664 * 5 -> 3320
const EXPECTED_FUNDING_WITH_FEE_1_5_123 = EXPECTED_FUNDING_1_5_123.add(EXPECTED_FUNDING_FEE_1_5_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_1_5_123 = EXPECTED_FUNDING_1_5_123.sub(EXPECTED_FUNDING_FEE_1_5_123.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 9485
const EXPECTED_FUNDING_2_5_123 = BigNumber.from(9480)
const EXPECTED_FUNDING_FEE_2_5_123 = BigNumber.from(950) // (9477 + 473) = 9950 / 5 -> 1990 * 5 -> 9950
const EXPECTED_FUNDING_WITH_FEE_2_5_123 = EXPECTED_FUNDING_2_5_123.add(EXPECTED_FUNDING_FEE_2_5_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_123 = EXPECTED_FUNDING_2_5_123.sub(EXPECTED_FUNDING_FEE_2_5_123.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 2.5 * 123 / (86400 * 365) = 4740
const EXPECTED_FUNDING_2_25_123 = BigNumber.from(4740)
const EXPECTED_FUNDING_FEE_2_25_123 = BigNumber.from(470) // (4738 + 236) = 4974 / 2.5 -> 1990 * 2.5 -> 4975
const EXPECTED_FUNDING_WITH_FEE_2_25_123 = EXPECTED_FUNDING_2_25_123.add(EXPECTED_FUNDING_FEE_2_25_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_25_123 = EXPECTED_FUNDING_2_25_123.sub(EXPECTED_FUNDING_FEE_2_25_123.div(2))

// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 43 / (86400 * 365) = 3315
const EXPECTED_FUNDING_2_5_43 = BigNumber.from(3315)
const EXPECTED_FUNDING_FEE_2_5_43 = BigNumber.from(330) // (3313 + 165) = 3478 / 5 -> 696 * 5 -> (3480 - 3315) * 2 -> 330
const EXPECTED_FUNDING_WITH_FEE_2_5_43 = EXPECTED_FUNDING_2_5_43.add(EXPECTED_FUNDING_FEE_2_5_43.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_43 = EXPECTED_FUNDING_2_5_43.sub(EXPECTED_FUNDING_FEE_2_5_43.div(2))

// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 96 / (86400 * 365) = 7400
const EXPECTED_FUNDING_2_5_96 = BigNumber.from(7400)
const EXPECTED_FUNDING_FEE_2_5_96 = BigNumber.from(740) // (7397 + 369) = 7766 / 5 -> 1554 * 5 -> (7770 - 7400) * 2 -> 1150
const EXPECTED_FUNDING_WITH_FEE_2_5_96 = EXPECTED_FUNDING_2_5_96.add(EXPECTED_FUNDING_FEE_2_5_96.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_96 = EXPECTED_FUNDING_2_5_96.sub(EXPECTED_FUNDING_FEE_2_5_96.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 150 / (86400 * 365) = 11560
const EXPECTED_FUNDING_2_5_150 = BigNumber.from(11560)
const EXPECTED_FUNDING_FEE_2_5_150 = BigNumber.from(1150) // (11558 + 577) = 12135 / 5 -> 2427 * 5 -> (12135 - 11560) * 2 -> 1150
const EXPECTED_FUNDING_WITH_FEE_2_5_150 = EXPECTED_FUNDING_2_5_150.add(EXPECTED_FUNDING_FEE_2_5_150.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_150 = EXPECTED_FUNDING_2_5_150.sub(EXPECTED_FUNDING_FEE_2_5_150.div(2))

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 5 * 203 / (86400 * 365) = 15645
const EXPECTED_FUNDING_2_5_203 = BigNumber.from(15645)
const EXPECTED_FUNDING_FEE_2_5_203 = BigNumber.from(1560) // (15642 + 782) = 16424 / 5 -> 3285 * 5 -> (16425 - 15645) * 2 -> 1560
const EXPECTED_FUNDING_WITH_FEE_2_5_203 = EXPECTED_FUNDING_2_5_203.add(EXPECTED_FUNDING_FEE_2_5_203.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_5_203 = EXPECTED_FUNDING_2_5_203.sub(EXPECTED_FUNDING_FEE_2_5_203.div(2))

// rate_0 = 0.18
// rate_1 = rate_0 + (elapsed * k * skew)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.18 + (0.18 + 3600 * 1.00 / 40000)) / 2 * 3600 * 2.5 * 123 / (86400 * 365) = 7900
const EXPECTED_FUNDING_3_25_123 = BigNumber.from('7900')
const EXPECTED_FUNDING_FEE_3_25_123 = EXPECTED_FUNDING_3_25_123.div(10)
const EXPECTED_FUNDING_WITH_FEE_3_25_123 = EXPECTED_FUNDING_3_25_123.add(EXPECTED_FUNDING_FEE_3_25_123.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_3_25_123 = EXPECTED_FUNDING_3_25_123.sub(EXPECTED_FUNDING_FEE_3_25_123.div(2))

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 43 = 2455
const EXPECTED_INTEREST_5_43 = BigNumber.from(2455)
const EXPECTED_INTEREST_FEE_5_43 = EXPECTED_INTEREST_5_43.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_43 = EXPECTED_INTEREST_5_43.sub(EXPECTED_INTEREST_FEE_5_43)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 96 = 5480
const EXPECTED_INTEREST_5_96 = BigNumber.from(5480)
const EXPECTED_INTEREST_FEE_5_96 = EXPECTED_INTEREST_5_96.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_96 = EXPECTED_INTEREST_5_96.sub(EXPECTED_INTEREST_FEE_5_96)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.066666 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 9360
const EXPECTED_INTEREST_10_123_EFF = BigNumber.from(9360)
const EXPECTED_INTEREST_FEE_10_123_EFF = EXPECTED_INTEREST_10_123_EFF.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF = EXPECTED_INTEREST_10_123_EFF.sub(EXPECTED_INTEREST_FEE_10_123_EFF)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.1 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 14040
const EXPECTED_INTEREST_10_123_EFF_2 = BigNumber.from(14040)
const EXPECTED_INTEREST_FEE_10_123_EFF_2 = EXPECTED_INTEREST_10_123_EFF_2.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF_2 = EXPECTED_INTEREST_10_123_EFF_2.sub(
  EXPECTED_INTEREST_FEE_10_123_EFF_2,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 7020
const EXPECTED_INTEREST_5_123 = BigNumber.from(7020)
const EXPECTED_INTEREST_FEE_5_123 = EXPECTED_INTEREST_5_123.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_123 = EXPECTED_INTEREST_5_123.sub(EXPECTED_INTEREST_FEE_5_123)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 150 = 8565
const EXPECTED_INTEREST_5_150 = BigNumber.from(8565)
const EXPECTED_INTEREST_FEE_5_150 = EXPECTED_INTEREST_5_150.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_150 = EXPECTED_INTEREST_5_150.sub(EXPECTED_INTEREST_FEE_5_150)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.10 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 203 = 11586
const EXPECTED_INTEREST_5_203 = BigNumber.from(11590)
const EXPECTED_INTEREST_FEE_5_203 = EXPECTED_INTEREST_5_203.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_5_203 = EXPECTED_INTEREST_5_203.sub(EXPECTED_INTEREST_FEE_5_203)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.05 / 365 / 24 / 60 / 60 ) * 3600 * 2.5 * 123 = 1755
const EXPECTED_INTEREST_25_123 = BigNumber.from(1755)
const EXPECTED_INTEREST_FEE_25_123 = EXPECTED_INTEREST_25_123.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_25_123 = EXPECTED_INTEREST_25_123.sub(EXPECTED_INTEREST_FEE_25_123)

// rate_0 = 0
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0 + (0 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 123 / (86400 * 365) = 3160
const EXPECTED_FUNDING_1_10_123_ALL = BigNumber.from(3160)
const EXPECTED_FUNDING_FEE_1_10_123_ALL = BigNumber.from(320) // (3159 + 157) = 3316 / 5 -> 664 * 5 -> 3320
const EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL = EXPECTED_FUNDING_1_10_123_ALL.add(
  EXPECTED_FUNDING_FEE_1_10_123_ALL.div(2),
)
const EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL = EXPECTED_FUNDING_1_10_123_ALL.sub(
  EXPECTED_FUNDING_FEE_1_10_123_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.75 / 40000)) / 2 * 3600 * 10 * 123 / (86400 * 365) = 11060
const EXPECTED_FUNDING_2_10_123_ALL = BigNumber.from(11060)
const EXPECTED_FUNDING_FEE_2_10_123_ALL = BigNumber.from(1100) // (11057 + 552) = 11609 / 10 -> 1161 * 10 -> 11610 - 11060 -> 550 * 2 -> 1100
const EXPECTED_FUNDING_WITH_FEE_2_10_123_ALL = EXPECTED_FUNDING_2_10_123_ALL.add(
  EXPECTED_FUNDING_FEE_2_10_123_ALL.div(2),
)
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL = EXPECTED_FUNDING_2_10_123_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_123_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 45 / (86400 * 365) = 3470
const EXPECTED_FUNDING_2_10_45_ALL = BigNumber.from(3470)
const EXPECTED_FUNDING_FEE_2_10_45_ALL = BigNumber.from(350)
const EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL = EXPECTED_FUNDING_2_10_45_ALL.add(EXPECTED_FUNDING_FEE_2_10_45_ALL.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL = EXPECTED_FUNDING_2_10_45_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_45_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 33 / (86400 * 365) = 2550
const EXPECTED_FUNDING_2_10_33_ALL = BigNumber.from(2550)
const EXPECTED_FUNDING_FEE_2_10_33_ALL = BigNumber.from(255)
const EXPECTED_FUNDING_WITH_FEE_2_10_33_ALL = EXPECTED_FUNDING_2_10_33_ALL.add(EXPECTED_FUNDING_FEE_2_10_33_ALL.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_33_ALL = EXPECTED_FUNDING_2_10_33_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_33_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.045 + (0.045 + 3600 * 0.50 / 40000)) / 2 * 3600 * 10 * 96 / (86400 * 365) = 7400
const EXPECTED_FUNDING_2_10_96_ALL = BigNumber.from(7400)
const EXPECTED_FUNDING_FEE_2_10_96_ALL = BigNumber.from(740)
const EXPECTED_FUNDING_WITH_FEE_2_10_96_ALL = EXPECTED_FUNDING_2_10_96_ALL.add(EXPECTED_FUNDING_FEE_2_10_96_ALL.div(2))
const EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL = EXPECTED_FUNDING_2_10_96_ALL.sub(
  EXPECTED_FUNDING_FEE_2_10_96_ALL.div(2),
)

// rate_0 = 0.09
// rate_1 = rate_0 + (elapsed * skew / k)
// funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
// (0.09 + (0.09 + 3600 * 0.50 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 7900
const EXPECTED_FUNDING_3_10_123_ALL = BigNumber.from(7900)
const EXPECTED_FUNDING_FEE_3_10_123_ALL = BigNumber.from(790)
const EXPECTED_FUNDING_WITH_FEE_3_10_123_ALL = EXPECTED_FUNDING_3_10_123_ALL.add(
  EXPECTED_FUNDING_FEE_3_10_123_ALL.div(2),
)
const EXPECTED_FUNDING_WITHOUT_FEE_3_10_123_ALL = EXPECTED_FUNDING_3_10_123_ALL.sub(
  EXPECTED_FUNDING_FEE_3_10_123_ALL.div(2),
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 56170
const EXPECTED_INTEREST_10_67_123_ALL = BigNumber.from(56170)
const EXPECTED_INTEREST_FEE_10_67_123_ALL = EXPECTED_INTEREST_10_67_123_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL = EXPECTED_INTEREST_10_67_123_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_123_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.64 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 89870
const EXPECTED_INTEREST_10_80_123_ALL = BigNumber.from(89870)
const EXPECTED_INTEREST_FEE_10_80_123_ALL = EXPECTED_INTEREST_10_80_123_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_80_123_ALL = EXPECTED_INTEREST_10_80_123_ALL.sub(
  EXPECTED_INTEREST_FEE_10_80_123_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 45 = 20550
const EXPECTED_INTEREST_10_67_45_ALL = BigNumber.from(20550)
const EXPECTED_INTEREST_FEE_10_67_45_ALL = EXPECTED_INTEREST_10_67_45_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL = EXPECTED_INTEREST_10_67_45_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_45_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 33 = 15070
const EXPECTED_INTEREST_10_67_33_ALL = BigNumber.from(15070)
const EXPECTED_INTEREST_FEE_10_67_33_ALL = EXPECTED_INTEREST_10_67_33_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_33_ALL = EXPECTED_INTEREST_10_67_33_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_33_ALL,
)

// rate * elapsed * utilization * min(maker, taker) * price
// (0.4 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 96 = 43840
const EXPECTED_INTEREST_10_67_96_ALL = BigNumber.from(43840)
const EXPECTED_INTEREST_FEE_10_67_96_ALL = EXPECTED_INTEREST_10_67_96_ALL.div(10)
const EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL = EXPECTED_INTEREST_10_67_96_ALL.sub(
  EXPECTED_INTEREST_FEE_10_67_96_ALL,
)

async function settle(market: Market, account: SignerWithAddress, sender?: SignerWithAddress) {
  const local = await market.locals(account.address)
  return await market.connect(sender || account).settle(account.address)
}

async function deposit(market: Market, amount: BigNumber, account: SignerWithAddress, sender?: SignerWithAddress) {
  const accountPositions = await market.positions(account.address)
  return await market
    .connect(sender || account)
    ['update(address,int256,int256,address)'](account.address, 0, amount, constants.AddressZero)
}

/*
wolfram example formulas for price impact

positive exposure
- integral(0.001 + 0.002 * x + 0.004 * x^2 + 0.008 * x^3, 0.5, 1.0) * 123 * 10

negtive exposure
- integral(0.001 - 0.002 * x + 0.004 * x^2 - 0.008 * x^3, -1.0, -0.5) * 123 * 10
*/

async function updateSynBook(market: Market, synBook: SynBook) {
  const riskParameter = { ...(await market.riskParameter()) }
  const riskParameterSynBook = { ...riskParameter.synBook }
  riskParameterSynBook.d0 = BigNumber.from(synBook.d0.toString())
  riskParameterSynBook.d1 = BigNumber.from(synBook.d1.toString())
  riskParameterSynBook.d2 = BigNumber.from(synBook.d2.toString())
  riskParameterSynBook.d3 = BigNumber.from(synBook.d3.toString())
  riskParameter.synBook = riskParameterSynBook
  await market.updateRiskParameter(riskParameter)
}

async function getOrderProcessingEvents(
  tx: ContractTransaction,
): Promise<[Array<AccountPositionProcessedEventObject>, Array<PositionProcessedEventObject>]> {
  const txEvents = (await tx.wait()).events!
  const accountProcessEvents: Array<AccountPositionProcessedEventObject> = txEvents
    .filter(e => e.event === 'AccountPositionProcessed')
    .map(e => e.args as unknown as AccountPositionProcessedEventObject)
  const positionProcessEvents: Array<PositionProcessedEventObject> = txEvents
    .filter(e => e.event === 'PositionProcessed')
    .map(e => e.args as unknown as PositionProcessedEventObject)
  return [accountProcessEvents, positionProcessEvents]
}

describe('Market', () => {
  let protocolTreasury: SignerWithAddress
  let owner: SignerWithAddress
  let beneficiary: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let userD: SignerWithAddress
  let liquidator: SignerWithAddress
  let operator: SignerWithAddress
  let coordinator: SignerWithAddress
  let factorySigner: SignerWithAddress
  let oracleSigner: SignerWithAddress
  let oracleFactorySigner: SignerWithAddress
  let verifier: FakeContract<IVerifier>
  let factory: FakeContract<IMarketFactory>
  let oracle: FakeContract<IOracleProvider>
  let dsu: FakeContract<IERC20Metadata>

  let market: Market
  let marketDefinition: IMarket.MarketDefinitionStruct
  let riskParameter: RiskParameterStruct
  let marketParameter: MarketParameterStruct

  const fixture = async () => {
    ;[
      protocolTreasury,
      owner,
      beneficiary,
      user,
      userB,
      userC,
      userD,
      liquidator,
      operator,
      coordinator,
      oracleFactorySigner,
    ] = await ethers.getSigners()
    oracle = await smock.fake<IOracleProvider>('IOracleProvider')
    oracleSigner = await impersonate.impersonateWithBalance(oracle.address, utils.parseEther('10'))
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')

    verifier = await smock.fake<IVerifier>('IVerifier')
    factory = await smock.fake<IMarketFactory>('IMarketFactory')
    factorySigner = await impersonate.impersonateWithBalance(factory.address, utils.parseEther('10'))
    factory.owner.returns(owner.address)
    factory.parameter.returns({
      maxPendingIds: 5,
      protocolFee: parse6decimal('0.50'),
      maxFee: parse6decimal('0.01'),
      maxLiquidationFee: parse6decimal('20'),
      maxCut: parse6decimal('0.50'),
      maxRate: parse6decimal('10.00'),
      minMaintenance: parse6decimal('0.01'),
      minEfficiency: parse6decimal('0.1'),
      referralFee: 0,
      minScale: parse6decimal('0.001'),
      maxStaleAfter: 14400,
      minMinMaintenance: 0,
    })
    factory.oracleFactory.returns(oracleFactorySigner.address)

    marketDefinition = {
      token: dsu.address,
      oracle: oracle.address,
    }
    riskParameter = {
      margin: parse6decimal('0.35'),
      maintenance: parse6decimal('0.3'),
      synBook: {
        d0: 0,
        d1: 0,
        d2: 0,
        d3: 0,
        scale: parse6decimal('5.000'),
      },
      makerLimit: parse6decimal('1000'),
      efficiencyLimit: parse6decimal('0.2'),
      liquidationFee: parse6decimal('10.00'),
      utilizationCurve: {
        minRate: parse6decimal('0.0'),
        maxRate: parse6decimal('1.00'),
        targetRate: parse6decimal('0.10'),
        targetUtilization: parse6decimal('0.50'),
      },
      pController: {
        k: parse6decimal('40000'),
        min: parse6decimal('-1.20'),
        max: parse6decimal('1.20'),
      },
      minMargin: parse6decimal('120'),
      minMaintenance: parse6decimal('100'),
      staleAfter: 7200,
      makerReceiveOnly: false,
    }
    marketParameter = {
      fundingFee: parse6decimal('0.1'),
      interestFee: parse6decimal('0.1'),
      riskFee: parse6decimal('0.111111'),
      makerFee: 0,
      takerFee: 0,
      maxPendingGlobal: 5,
      maxPendingLocal: 3,
      maxPriceDeviation: parse6decimal('0.1'),
      closed: false,
      settle: false,
    }
    market = await new Market__factory(
      {
        'contracts/libs/CheckpointLib.sol:CheckpointLib': (await new CheckpointLib__factory(owner).deploy()).address,
        'contracts/libs/InvariantLib.sol:InvariantLib': (await new InvariantLib__factory(owner).deploy()).address,
        'contracts/libs/VersionLib.sol:VersionLib': (await new VersionLib__factory(owner).deploy()).address,
        'contracts/types/Checkpoint.sol:CheckpointStorageLib': (
          await new CheckpointStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Global.sol:GlobalStorageLib': (await new GlobalStorageLib__factory(owner).deploy()).address,
        'contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
          await new MarketParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageGlobalLib': (
          await new PositionStorageGlobalLib__factory(owner).deploy()
        ).address,
        'contracts/types/Position.sol:PositionStorageLocalLib': (
          await new PositionStorageLocalLib__factory(owner).deploy()
        ).address,
        'contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
          await new RiskParameterStorageLib__factory(owner).deploy()
        ).address,
        'contracts/types/Version.sol:VersionStorageLib': (await new VersionStorageLib__factory(owner).deploy()).address,
      },
      owner,
    ).deploy(verifier.address)

    // allow users to update their own accounts w/o signer or referrer
    factory.authorization
      .whenCalledWith(user.address, user.address, constants.AddressZero, constants.AddressZero)
      .returns([true, false, BigNumber.from(0)])
    factory.authorization
      .whenCalledWith(userB.address, userB.address, constants.AddressZero, constants.AddressZero)
      .returns([true, false, BigNumber.from(0)])
    factory.authorization
      .whenCalledWith(userC.address, userC.address, constants.AddressZero, constants.AddressZero)
      .returns([true, false, BigNumber.from(0)])
    factory.authorization
      .whenCalledWith(userD.address, userD.address, constants.AddressZero, constants.AddressZero)
      .returns([true, false, BigNumber.from(0)])
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      await market.connect(factorySigner).initialize(marketDefinition)

      expect(await market.factory()).to.equal(factory.address)
      expect(await market.token()).to.equal(dsu.address)
      expect(await market.oracle()).to.equal(marketDefinition.oracle)

      const riskParameterResult = await market.riskParameter()
      expect(riskParameterResult.margin).to.equal(0)
      expect(riskParameterResult.maintenance).to.equal(0)
      expect(riskParameterResult.synBook.d0).to.equal(0)
      expect(riskParameterResult.synBook.d1).to.equal(0)
      expect(riskParameterResult.synBook.d2).to.equal(0)
      expect(riskParameterResult.synBook.d3).to.equal(0)
      expect(riskParameterResult.synBook.scale).to.equal(0)
      expect(riskParameterResult.makerLimit).to.equal(0)
      expect(riskParameterResult.efficiencyLimit).to.equal(0)
      expect(riskParameterResult.liquidationFee).to.equal(0)
      expect(riskParameterResult.utilizationCurve.minRate).to.equal(0)
      expect(riskParameterResult.utilizationCurve.targetRate).to.equal(0)
      expect(riskParameterResult.utilizationCurve.maxRate).to.equal(0)
      expect(riskParameterResult.utilizationCurve.targetUtilization).to.equal(0)
      expect(riskParameterResult.pController.k).to.equal(0)
      expect(riskParameterResult.pController.max).to.equal(0)
      expect(riskParameterResult.minMargin).to.equal(0)
      expect(riskParameterResult.minMaintenance).to.equal(0)
      expect(riskParameterResult.staleAfter).to.equal(0)
      expect(riskParameterResult.makerReceiveOnly).to.equal(false)

      const marketParameterResult = await market.parameter()
      expect(marketParameterResult.fundingFee).to.equal(0)
      expect(marketParameterResult.interestFee).to.equal(0)
      expect(marketParameterResult.makerFee).to.equal(0)
      expect(marketParameterResult.takerFee).to.equal(0)
      expect(marketParameterResult.maxPendingGlobal).to.equal(0)
      expect(marketParameterResult.maxPendingLocal).to.equal(0)
      expect(marketParameterResult.closed).to.equal(false)
    })

    it('reverts if already initialized', async () => {
      await market.initialize(marketDefinition)
      await expect(market.initialize(marketDefinition))
        .to.be.revertedWithCustomError(market, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  context('already initialized', async () => {
    beforeEach(async () => {
      await market.connect(factorySigner).initialize(marketDefinition)
      await market.connect(owner).updateBeneficiary(beneficiary.address)
      await market.connect(owner).updateCoordinator(coordinator.address)
      await market.connect(owner).updateRiskParameter(riskParameter)
    })

    describe('#updateBeneficiary', async () => {
      it('updates the beneficiary', async () => {
        await expect(market.connect(owner).updateBeneficiary(beneficiary.address))
          .to.emit(market, 'BeneficiaryUpdated')
          .withArgs(beneficiary.address)

        expect(await market.beneficiary()).to.equal(beneficiary.address)
      })

      it('reverts if not owner (user)', async () => {
        await expect(market.connect(user).updateBeneficiary(beneficiary.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })

      it('reverts if not owner (coordinator)', async () => {
        await market.connect(owner).updateBeneficiary(beneficiary.address)
        await expect(market.connect(coordinator).updateBeneficiary(beneficiary.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateCoordinator', async () => {
      it('updates the parameters', async () => {
        await expect(market.connect(owner).updateCoordinator(coordinator.address))
          .to.emit(market, 'CoordinatorUpdated')
          .withArgs(coordinator.address)

        expect(await market.coordinator()).to.equal(coordinator.address)
      })

      it('reverts if not owner (user)', async () => {
        await expect(market.connect(user).updateCoordinator(coordinator.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })

      it('reverts if not owner (coordinator)', async () => {
        await market.connect(owner).updateCoordinator(coordinator.address)
        await expect(market.connect(coordinator).updateCoordinator(coordinator.address)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateParameter', async () => {
      const defaultMarketParameter = {
        fundingFee: parse6decimal('0.03'),
        interestFee: parse6decimal('0.02'),
        makerFee: parse6decimal('0.01'),
        takerFee: parse6decimal('0.01'),
        riskFee: parse6decimal('0.05'),
        maxPendingGlobal: 5,
        maxPendingLocal: 3,
        maxPriceDeviation: parse6decimal('0.1'),
        closed: true,
        settle: true,
      }

      it('updates the parameters', async () => {
        await expect(market.connect(owner).updateParameter(defaultMarketParameter))
          .to.emit(market, 'ParameterUpdated')
          .withArgs(defaultMarketParameter)

        const marketParameter = await market.parameter()
        expect(marketParameter.fundingFee).to.equal(defaultMarketParameter.fundingFee)
        expect(marketParameter.interestFee).to.equal(defaultMarketParameter.interestFee)
        expect(marketParameter.makerFee).to.equal(defaultMarketParameter.makerFee)
        expect(marketParameter.takerFee).to.equal(defaultMarketParameter.takerFee)
        expect(marketParameter.maxPendingGlobal).to.equal(defaultMarketParameter.maxPendingGlobal)
        expect(marketParameter.maxPendingLocal).to.equal(defaultMarketParameter.maxPendingLocal)
        expect(marketParameter.maxPriceDeviation).to.equal(defaultMarketParameter.maxPriceDeviation)
        expect(marketParameter.closed).to.equal(defaultMarketParameter.closed)
        expect(marketParameter.settle).to.equal(defaultMarketParameter.settle)
      })

      it('reverts if not owner (user)', async () => {
        await expect(market.connect(user).updateParameter(marketParameter)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })

      it('reverts if not owner (coordinator)', async () => {
        await market.connect(owner).updateParameter(await market.parameter())
        await expect(market.connect(coordinator).updateParameter(marketParameter)).to.be.revertedWithCustomError(
          market,
          'InstanceNotOwnerError',
        )
      })
    })

    describe('#updateRiskParameter', async () => {
      const defaultRiskParameter = {
        margin: parse6decimal('0.5'),
        maintenance: parse6decimal('0.4'),
        synBook: {
          d0: parse6decimal('0.001'),
          d1: parse6decimal('0.002'),
          d2: parse6decimal('0.004'),
          d3: parse6decimal('0.008'),
          scale: parse6decimal('50.00'),
        },
        makerLimit: parse6decimal('2000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('5.00'),
        utilizationCurve: {
          minRate: parse6decimal('0.20'),
          maxRate: parse6decimal('0.20'),
          targetRate: parse6decimal('0.20'),
          targetUtilization: parse6decimal('0.75'),
        },
        pController: {
          k: parse6decimal('40000'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
        minMargin: parse6decimal('60'),
        minMaintenance: parse6decimal('50'),
        staleAfter: 9600,
        makerReceiveOnly: true,
      }

      it('updates the parameters (owner)', async () => {
        await expect(market.connect(owner).updateRiskParameter(defaultRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        const riskParameter = await market.riskParameter()
        expect(riskParameter.margin).to.equal(defaultRiskParameter.margin)
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.synBook.d0).to.equal(defaultRiskParameter.synBook.d0)
        expect(riskParameter.synBook.d1).to.equal(defaultRiskParameter.synBook.d1)
        expect(riskParameter.synBook.d2).to.equal(defaultRiskParameter.synBook.d2)
        expect(riskParameter.synBook.d3).to.equal(defaultRiskParameter.synBook.d3)
        expect(riskParameter.synBook.scale).to.equal(defaultRiskParameter.synBook.scale)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMargin).to.equal(defaultRiskParameter.minMargin)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      it('updates the parameters (coordinator)', async () => {
        await market.connect(owner).updateParameter(await market.parameter())
        await expect(market.connect(coordinator).updateRiskParameter(defaultRiskParameter)).to.emit(
          market,
          'RiskParameterUpdated',
        )

        const riskParameter = await market.riskParameter()
        expect(riskParameter.margin).to.equal(defaultRiskParameter.margin)
        expect(riskParameter.maintenance).to.equal(defaultRiskParameter.maintenance)
        expect(riskParameter.synBook.d0).to.equal(defaultRiskParameter.synBook.d0)
        expect(riskParameter.synBook.d1).to.equal(defaultRiskParameter.synBook.d1)
        expect(riskParameter.synBook.d2).to.equal(defaultRiskParameter.synBook.d2)
        expect(riskParameter.synBook.d3).to.equal(defaultRiskParameter.synBook.d3)
        expect(riskParameter.synBook.scale).to.equal(defaultRiskParameter.synBook.scale)
        expect(riskParameter.makerLimit).to.equal(defaultRiskParameter.makerLimit)
        expect(riskParameter.efficiencyLimit).to.equal(defaultRiskParameter.efficiencyLimit)
        expect(riskParameter.liquidationFee).to.equal(defaultRiskParameter.liquidationFee)
        expect(riskParameter.utilizationCurve.minRate).to.equal(defaultRiskParameter.utilizationCurve.minRate)
        expect(riskParameter.utilizationCurve.targetRate).to.equal(defaultRiskParameter.utilizationCurve.targetRate)
        expect(riskParameter.utilizationCurve.maxRate).to.equal(defaultRiskParameter.utilizationCurve.maxRate)
        expect(riskParameter.utilizationCurve.targetUtilization).to.equal(
          defaultRiskParameter.utilizationCurve.targetUtilization,
        )
        expect(riskParameter.pController.k).to.equal(defaultRiskParameter.pController.k)
        expect(riskParameter.pController.max).to.equal(defaultRiskParameter.pController.max)
        expect(riskParameter.minMargin).to.equal(defaultRiskParameter.minMargin)
        expect(riskParameter.minMaintenance).to.equal(defaultRiskParameter.minMaintenance)
        expect(riskParameter.staleAfter).to.equal(defaultRiskParameter.staleAfter)
        expect(riskParameter.makerReceiveOnly).to.equal(defaultRiskParameter.makerReceiveOnly)
      })

      it('reverts if not owner or coordinator', async () => {
        await expect(market.connect(user).updateRiskParameter(defaultRiskParameter)).to.be.revertedWithCustomError(
          market,
          'MarketNotCoordinatorError',
        )
      })
    })

    describe('#settle', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateCoordinator(coordinator.address)
        await market.connect(owner).updateBeneficiary(beneficiary.address)
        await market.connect(owner).updateParameter(marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns([ORACLE_VERSION_0, INITIALIZED_ORACLE_RECEIPT])
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
      })

      it('opens the position and settles', async () => {
        await expect(
          market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
        )
          .to.emit(market, 'PositionProcessed')
          .withArgs(0, { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp }, DEFAULT_VERSION_ACCUMULATION_RESULT)
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            0,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'OrderCreated')
          .withArgs(
            user.address,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            },
            { ...DEFAULT_GUARANTEE },
            constants.AddressZero,
            constants.AddressZero,
            constants.AddressZero,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await expect(await market.settle(user.address))
          .to.emit(market, 'PositionProcessed')
          .withArgs(
            1,
            {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_VERSION_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            1,
            {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 1,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrders(user.address, 1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          ...DEFAULT_GLOBAL,
          ...DEFAULT_GLOBAL,
          currentId: 1,
          latestId: 1,
          latestPrice: PRICE,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrder(1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          price: PRICE,
        })
      })

      it('settles when market is in settle-only mode, but doesnt sync', async () => {
        await expect(
          market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
        )
          .to.emit(market, 'PositionProcessed')
          .withArgs(0, { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp }, DEFAULT_VERSION_ACCUMULATION_RESULT)
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            0,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'OrderCreated')
          .withArgs(
            user.address,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            },
            { ...DEFAULT_GUARANTEE },
            constants.AddressZero,
            constants.AddressZero,
            constants.AddressZero,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
        oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        const marketParameter = { ...(await market.parameter()) }
        marketParameter.settle = true
        await market.connect(owner).updateParameter(marketParameter)

        await expect(await market.settle(user.address))
          .to.emit(market, 'PositionProcessed')
          .withArgs(
            1,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_VERSION_ACCUMULATION_RESULT,
          )
          .to.emit(market, 'AccountPositionProcessed')
          .withArgs(
            user.address,
            1,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            },
            DEFAULT_LOCAL_ACCUMULATION_RESULT,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 1,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrders(user.address, 1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          ...DEFAULT_GLOBAL,
          ...DEFAULT_GLOBAL,
          currentId: 1,
          latestId: 1,
          latestPrice: PRICE,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrder(1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          price: PRICE,
        })
      })

      it('reverts when paused', async () => {
        factory.paused.returns(true)

        await expect(
          market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
        ).to.revertedWithCustomError(market, 'InstancePausedError')

        factory.paused.returns(false)
      })
    })

    describe('#update', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateCoordinator(coordinator.address)
        await market.connect(owner).updateBeneficiary(beneficiary.address)
        await market.connect(owner).updateParameter(marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns([ORACLE_VERSION_0, INITIALIZED_ORACLE_RECEIPT])
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()
      })

      context('no position', async () => {
        it('deposits and withdraws (immediately)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, collateral: COLLATERAL },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL.mul(-1), false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                collateral: -COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
        })

        it('deposits and withdraws (next)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, collateral: COLLATERAL },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL.mul(-1), false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, collateral: COLLATERAL.mul(-1) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            collateral: -COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            collateral: -COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
        })

        it('deposits and withdraws (next - stale)', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, collateral: COLLATERAL },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          dsu.transfer.whenCalledWith(user.address, COLLATERAL.mul(1e12)).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL.mul(-1), false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_6.timestamp, collateral: COLLATERAL.mul(-1) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
            collateral: -COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_2.timestamp,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_6.timestamp,
            collateral: -COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
        })
      })

      context('make position', async () => {
        context('open', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          it('opens the position', async () => {
            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  collateral: COLLATERAL,
                  makerPos: POSITION,
                },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
            })
            expectGuaranteeEq(await market.guarantee((await market.global()).currentId), {
              ...DEFAULT_GUARANTEE,
            })
            expectGuaranteeEq(await market.guarantees(user.address, (await market.locals(user.address)).currentId), {
              ...DEFAULT_GUARANTEE,
            })
            expectOrderEq(await market.pending(), {
              ...DEFAULT_ORDER,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            })
            expectOrderEq(await market.pendings(user.address), {
              ...DEFAULT_ORDER,
              orders: 1,
              collateral: COLLATERAL,
              makerPos: POSITION,
            })
          })

          it('opens the position and settles', async () => {
            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                0,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
                DEFAULT_VERSION_ACCUMULATION_RESULT,
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                0,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_1.timestamp },
                DEFAULT_LOCAL_ACCUMULATION_RESULT,
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(await settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  collateral: COLLATERAL,
                  makerPos: POSITION,
                },
                DEFAULT_VERSION_ACCUMULATION_RESULT,
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  collateral: COLLATERAL,
                  makerPos: POSITION,
                },
                DEFAULT_LOCAL_ACCUMULATION_RESULT,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
            })
          })

          it('opens a second position (same version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, makerPos: POSITION },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              collateral: COLLATERAL,
              makerPos: POSITION.mul(2),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_1.timestamp,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              collateral: COLLATERAL,
              makerPos: POSITION.mul(2),
            })
          })

          it('opens a second position and settles (same version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, makerPos: POSITION },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 2,
              makerPos: POSITION.mul(2),
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 2,
              makerPos: POSITION.mul(2),
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
            })
          })

          it('opens a second position (next version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerPos: POSITION },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              makerPos: POSITION,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              makerPos: POSITION,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
            })
          })

          it('opens a second position and settles (next version)', async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.mul(2), 0, 0, 0, false),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerPos: POSITION },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
              long: 0,
              short: 0,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
            })
          })

          it('opens the position and settles later', async () => {
            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
            })
          })

          it('opens the position and settles later with fee', async () => {
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const MAKER_FEE = parse6decimal('0') //no skew
            const SETTLEMENT_FEE = parse6decimal('0.50')

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(MAKER_FEE).sub(SETTLEMENT_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = MAKER_FEE
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10),
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE),
              riskFee: totalFee.div(10),
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 1,
              makerPos: POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              collateral: COLLATERAL,
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })
        })

        context('close', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
          })

          context('settles first', async () => {
            beforeEach(async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
            })

            it('closes the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 2,
                makerNeg: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 2,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                orders: 2,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                orders: 2,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, makerNeg: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 3,
                latestId: 2,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false)

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, makerNeg: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 3,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION.div(2),
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 3,
                latestId: 3,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrder(3), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION.div(2),
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes the position and settles later', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('closes the position and settles later with fee', async () => {
              await updateSynBook(market, DEFAULT_SYN_BOOK)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.makerFee = parse6decimal('0.01')
              await market.updateParameter(marketParameter)

              const MAKER_OFFSET = parse6decimal('0') // no skew
              const MAKER_FEE = parse6decimal('12.3') // position * (0.01) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL.sub(MAKER_FEE).sub(MAKER_OFFSET).add(MAKER_OFFSET).sub(SETTLEMENT_FEE),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = MAKER_FEE
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
                oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                orders: 1,
                makerNeg: POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: { _value: MAKER_OFFSET.div(10) },
                price: PRICE,
                liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
              })
            })
          })
        })
      })

      context('long position', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('position delta', async () => {
          context('open', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('opens the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    collateral: COLLATERAL,
                    orders: 1,
                    longPos: POSITION,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                collateral: COLLATERAL.mul(2),
                orders: 2,
                makerPos: POSITION,
                longPos: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION,
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                makerPos: POSITION,
                longPos: POSITION,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                collateral: COLLATERAL.mul(2),
                makerPos: POSITION,
                longPos: POSITION,
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                longPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                longPos: POSITION,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                orders: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                price: PRICE,
              })
            })

            it('opens the position and settles later', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                orders: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                makerPos: POSITION,
                longPos: POSITION.div(2),
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                price: PRICE,
              })
            })

            it('opens the position and settles later with fee', async () => {
              await updateSynBook(market, DEFAULT_SYN_BOOK)

              const PRICE_IMPACT = parse6decimal('3.28') // skew 0.0 -> 1.0, price 123, position 5
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .add(PRICE_IMPACT) // maker pays due to ordering
                  .sub(SETTLEMENT_FEE.div(2)),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(PRICE_IMPACT) // maker pays due to ordering
                  .sub(SETTLEMENT_FEE.div(2))
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                orders: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                makerPos: POSITION,
                longPos: POSITION.div(2),
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                longPostValue: { _value: PRICE_IMPACT.div(5) },
                price: PRICE,
                liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              await updateSynBook(market, DEFAULT_SYN_BOOK)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerFee = parse6decimal('0.01')
              await market.updateParameter(marketParameter)

              const PRICE_IMPACT = parse6decimal('3.28') // skew 0.0 -> 1.0, price 123, position 5
              const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(TAKER_FEE)
                  .sub(PRICE_IMPACT)
                  .sub(SETTLEMENT_FEE),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: 0,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(PRICE_IMPACT)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                orders: 1,
                timestamp: ORACLE_VERSION_2.timestamp,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
                oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
                makerCloseValue: { _value: PRICE_IMPACT.div(10) },
                price: PRICE,
                liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at
                  .whenCalledWith(ORACLE_VERSION_2.timestamp)
                  .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 1,
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  price: PRICE,
                })
              })

              it('closes the position and settles', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes a second position (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 1,
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  price: PRICE,
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes a second position (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  long: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes a second position and settles (next version)', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                riskParameter.makerLimit = parse6decimal('100')
                const riskParameterSynBook = { ...riskParameter.synBook }
                riskParameterSynBook.scale = POSITION.div(4)
                riskParameter.synBook = riskParameterSynBook
                await market.updateRiskParameter(riskParameter)

                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_FUNDING_WITH_FEE_2_25_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_INTEREST_25_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                  .add(EXPECTED_INTEREST_FEE_5_123)
                  .add(EXPECTED_INTEREST_FEE_25_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 3,
                  latestId: 3,
                  protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                      .div(5)
                      .add(EXPECTED_FUNDING_WITH_FEE_2_25_123.add(EXPECTED_INTEREST_25_123).mul(2).div(5))
                      .mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes the position and settles later', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes the position and settles later with fee', async () => {
                await updateSynBook(market, DEFAULT_SYN_BOOK)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.takerFee = parse6decimal('0.01')
                await market.updateParameter(marketParameter)

                const PRICE_IMPACT = parse6decimal('-0.41') // skew 0.5 -> 0, price 123, position 5
                const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
                const SETTLEMENT_FEE = parse6decimal('0.50')

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(TAKER_FEE)
                    .sub(PRICE_IMPACT)
                    .sub(SETTLEMENT_FEE),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(PRICE_IMPACT)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  orders: 1,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerCloseValue: { _value: PRICE_IMPACT.div(10) },
                  price: PRICE,
                  liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('same price same timestamp settle', async () => {
            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              valid: true,
            }

            oracle.at
              .whenCalledWith(oracleVersionSameTimestamp.timestamp)
              .returns([oracleVersionSameTimestamp, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionSameTimestamp, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 2,
              timestamp: ORACLE_VERSION_2.timestamp,
              longPos: POSITION.div(2),
              makerPos: POSITION,
              collateral: COLLATERAL.mul(2),
            })
          })

          it('lower price same rate settle', async () => {
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))

            const EXPECTED_PNL = parse6decimal('2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionLowerPrice = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionLowerPrice.timestamp)
              .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(2).div(5)),
                  fundingLong: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(3).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestLong: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlLong: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
              oracleFee: totalFee.div(10).sub(1), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: parse6decimal('121'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 2,
              timestamp: ORACLE_VERSION_2.timestamp,
              longPos: POSITION.div(2),
              makerPos: POSITION,
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10),
              },
              longPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              price: oracleVersionLowerPrice.price,
            })
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('-2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice.timestamp)
              .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(2).div(5)),
                  fundingLong: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(3).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestLong: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlLong: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              orders: 1,
              timestamp: ORACLE_VERSION_2.timestamp,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
              oracleFee: totalFee.div(10).sub(1), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: parse6decimal('125'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              orders: 2,
              timestamp: ORACLE_VERSION_2.timestamp,
              longPos: POSITION.div(2),
              makerPos: POSITION,
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10)
                  .sub(1),
              }, // loss of precision
              longPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              price: oracleVersionHigherPrice.price,
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  parse6decimal('450'),
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('with socialization to zero', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([oracleVersionHigherPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_5_150)
                  .sub(5), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('450')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(22), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
                oracleFee: totalFee.div(10).add(EXPECTED_SETTLEMENT_FEE),
                riskFee: totalFee.div(10),
                latestPrice: parse6decimal('150'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: oracleVersionHigherPrice2.price,
              })
            })

            it('with partial socialization', async () => {
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  POSITION.div(4),
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userC)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([oracleVersionHigherPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 5620
              const EXPECTED_INTEREST_1 = BigNumber.from(5620)
              const EXPECTED_INTEREST_FEE_1 = EXPECTED_INTEREST_1.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_1 = EXPECTED_INTEREST_1.sub(EXPECTED_INTEREST_FEE_1)

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 150 = 6850
              const EXPECTED_INTEREST_2 = BigNumber.from(6850)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 * 0.5 = 35105
              const EXPECTED_INTEREST_3 = BigNumber.from(35105)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_2)
                  .sub(EXPECTED_FUNDING_WITH_FEE_3_25_123)
                  .sub(EXPECTED_INTEREST_3)
                  .add(EXPECTED_PNL)
                  .sub(5), // loss of precision
              })
              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('450')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).mul(4).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2).mul(4).div(5))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(16), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userC.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).div(5),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3))
                  .sub(EXPECTED_PNL)
                  .sub(12), // loss of precision
              })
              expectPositionEq(await market.positions(userC.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
              })
              expectOrderEq(await market.pendingOrders(userC.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION.div(4),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_5_150.add(EXPECTED_INTEREST_FEE_2))
                .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
                oracleFee: totalFee.div(10).sub(2).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: parse6decimal('150'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(2)
                    .div(25)
                    .sub(1),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150.add(EXPECTED_INTEREST_2))
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3).mul(2).div(5))
                    .sub(EXPECTED_PNL.mul(2).div(5))
                    .sub(4), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150.add(EXPECTED_INTEREST_2))
                    .add(EXPECTED_FUNDING_WITH_FEE_3_25_123.add(EXPECTED_INTEREST_3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: oracleVersionHigherPrice2.price,
              })
            })

            it('with shortfall', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              factory.parameter.returns({
                maxPendingIds: 5,
                protocolFee: parse6decimal('0.50'),
                maxFee: parse6decimal('0.01'),
                maxLiquidationFee: parse6decimal('100'),
                maxCut: parse6decimal('0.50'),
                maxRate: parse6decimal('10.00'),
                minMaintenance: parse6decimal('0.01'),
                minEfficiency: parse6decimal('0.1'),
                referralFee: 0,
                minScale: parse6decimal('0.001'),
                maxStaleAfter: 14400,
                minMinMaintenance: 0,
              })

              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.liquidationFee = parse6decimal('100')
              await market.connect(owner).updateRiskParameter(riskParameter)

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('100')

              const oracleVersionHigherPrice = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .add(EXPECTED_PNL),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: parse6decimal('203'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                shortPreValue: { _value: 0 },
                price: oracleVersionHigherPrice.price,
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([
                  oracleVersionHigherPrice2,
                  { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
                ])
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('450')
                .sub(EXPECTED_SETTLEMENT_FEE)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_203)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_203)
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(24) // loss of precision

              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userB.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, collateral: shortfall.mul(-1) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: 0,
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })

          context('long', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  parse6decimal('216'),
                  false,
                )
            })

            it('default', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice.timestamp)
                .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    longNeg: POSITION.div(2),
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice2.timestamp)
                .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                  .sub(EXPECTED_LIQUIDATION_FEE),
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                  .sub(20), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
                EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
              )
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(3), // loss of precision
                oracleFee: totalFee.div(10).sub(2).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: parse6decimal('96'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                shortPreValue: { _value: 0 },
                price: oracleVersionLowerPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                shortPreValue: { _value: 0 },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                shortPreValue: { _value: 0 },
                price: oracleVersionLowerPrice2.price,
              })
            })

            it('with shortfall', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.minMaintenance = parse6decimal('50')
              await market.connect(owner).updateRiskParameter(riskParameter)

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice.timestamp)
                .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    longNeg: POSITION.div(2),
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                  .sub(EXPECTED_PNL),
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123),
                )
                  .add(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: parse6decimal('43'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                shortPreValue: { _value: 0 },
                price: oracleVersionLowerPrice.price,
              })

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice2.timestamp)
                .returns([
                  oracleVersionLowerPrice2,
                  { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
                ])
              oracle.status.returns([oracleVersionLowerPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('216')
                .sub(EXPECTED_SETTLEMENT_FEE)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
                .sub(EXPECTED_FUNDING_WITH_FEE_2_5_43.add(EXPECTED_INTEREST_5_43))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, collateral: shortfall.mul(-1) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: 0,
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(marketParameter)

            const oracleVersionHigherPrice_0 = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            const oracleVersionHigherPrice_1 = {
              price: parse6decimal('128'),
              timestamp: TIMESTAMP + 10800,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice_0.timestamp)
              .returns([oracleVersionHigherPrice_0, INITIALIZED_ORACLE_RECEIPT])

            oracle.at
              .whenCalledWith(oracleVersionHigherPrice_1.timestamp)
              .returns([oracleVersionHigherPrice_1, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice_1, ORACLE_VERSION_5.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: parse6decimal('128'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_VERSION,
              price: oracleVersionHigherPrice_1.price,
            })
          })
        })
      })

      context('short position', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('position delta', async () => {
          context('open', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('opens the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    collateral: COLLATERAL,
                    orders: 1,
                    shortPos: POSITION,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                collateral: COLLATERAL,
                shortPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                collateral: COLLATERAL.mul(2),
                orders: 2,
                makerPos: POSITION,
                shortPos: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    shortPos: POSITION,
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                makerPos: POSITION,
                shortPos: POSITION,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, shortPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                collateral: COLLATERAL,
                shortPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                collateral: COLLATERAL.mul(2),
                makerPos: POSITION,
                shortPos: POSITION,
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, shortPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                shortPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                shortPos: POSITION,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                },
                price: PRICE,
              })
            })

            it('opens the position and settles later', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.staleAfter = BigNumber.from(9600)
              await market.connect(owner).updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION.div(2),
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    shortPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                makerPos: POSITION,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                },
                price: PRICE,
              })
            })

            it('opens the position and settles later with fee', async () => {
              await updateSynBook(market, DEFAULT_SYN_BOOK)

              const PRICE_IMPACT = parse6decimal('3.28') // skew 0 -> -0.5, price 123, position -5
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION.div(2),
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    shortPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .add(PRICE_IMPACT) // maker pays due to ordering
                  .sub(SETTLEMENT_FEE.div(2)),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(PRICE_IMPACT) // maker pays due to ordering
                  .sub(SETTLEMENT_FEE.div(2))
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                makerPos: POSITION,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                },
                shortPostValue: { _value: PRICE_IMPACT.div(5) },
                price: PRICE,
                liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
              })
            })

            it('settles opens the position and settles later with fee', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)

              await updateSynBook(market, DEFAULT_SYN_BOOK)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerFee = parse6decimal('0.01')
              await market.updateParameter(marketParameter)

              const PRICE_IMPACT = parse6decimal('3.28') // skew 0 -> -0.5, price 123, position -5
              const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    POSITION.div(2),
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_3.timestamp,
                    orders: 1,
                    shortPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(PRICE_IMPACT)
                  .sub(TAKER_FEE)
                  .sub(SETTLEMENT_FEE),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(PRICE_IMPACT)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
                oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                },
                makerCloseValue: { _value: PRICE_IMPACT.div(10) },
                price: PRICE,
                liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at
                  .whenCalledWith(ORACLE_VERSION_2.timestamp)
                  .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 1,
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  price: PRICE,
                })
              })

              it('closes the position and settles', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes a second position (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 1,
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  short: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  price: PRICE,
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes a second position (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, shortNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  short: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes a second position and settles (next version)', async () => {
                const riskParameter = { ...(await market.riskParameter()) }
                riskParameter.makerLimit = parse6decimal('100')
                const riskParameterSynBook = { ...riskParameter.synBook }
                riskParameterSynBook.scale = POSITION.div(4)
                riskParameter.synBook = riskParameterSynBook
                await market.updateRiskParameter(riskParameter)

                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, false)

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, shortNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 3,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_FUNDING_WITH_FEE_2_25_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_INTEREST_25_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_FUNDING_FEE_2_25_123)
                  .add(EXPECTED_INTEREST_FEE_5_123)
                  .add(EXPECTED_INTEREST_FEE_25_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 3,
                  latestId: 3,
                  protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_2_25_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_25_123)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                      .div(5)
                      .add(EXPECTED_FUNDING_WITH_FEE_2_25_123.add(EXPECTED_INTEREST_25_123).mul(2).div(5))
                      .mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes the position and settles later', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  price: PRICE,
                })
              })

              it('closes the position and settles later with fee', async () => {
                await updateSynBook(market, DEFAULT_SYN_BOOK)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.takerFee = parse6decimal('0.01')
                await market.updateParameter(marketParameter)

                const PRICE_IMPACT = parse6decimal('-0.41') // skew 0.5 -> 0, price 123, position 5
                const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
                const SETTLEMENT_FEE = parse6decimal('0.50')

                // dsu.transferFrom.whenCalledWith(user.address, market.address, TAKER_FEE.mul(1e12)).returns(true)
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.whenCalledWith(user.address).returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                    .sub(EXPECTED_INTEREST_5_123)
                    .sub(PRICE_IMPACT)
                    .sub(TAKER_FEE)
                    .sub(SETTLEMENT_FEE),
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(PRICE_IMPACT)
                    .sub(8), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(TAKER_FEE)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                  oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
                  riskFee: totalFee.div(10).sub(1), // loss of precision
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
                  },
                  longPreValue: { _value: 0 },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
                  },
                  makerCloseValue: { _value: PRICE_IMPACT.div(10) },
                  price: PRICE,
                  liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('same price same timestamp settle', async () => {
            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              valid: true,
            }

            oracle.at
              .whenCalledWith(oracleVersionSameTimestamp.timestamp)
              .returns([oracleVersionSameTimestamp, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionSameTimestamp, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
          })

          it('lower price same rate settle', async () => {
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))

            const EXPECTED_PNL = parse6decimal('-2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionLowerPrice = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionLowerPrice.timestamp)
              .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(1).div(5)),
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(4).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestShort: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlShort: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
              oracleFee: totalFee.div(10).sub(1), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: parse6decimal('121'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10)
                  .sub(1),
              }, // loss of precision
              longPreValue: { _value: 0 },
              shortPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              price: oracleVersionLowerPrice.price,
            })
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('2').mul(5) // maker pnl
            const EXPECTED_FUNDING_PRECISION_LOSS = BigNumber.from('5') // total funding precision loss due to accumulation division and multiplication

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice.timestamp)
              .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_FUNDING_PRECISION_LOSS.mul(1).div(5)),
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_5_123.mul(-1).add(
                    EXPECTED_FUNDING_PRECISION_LOSS.mul(4).div(5),
                  ),
                  fundingFee: EXPECTED_FUNDING_FEE_1_5_123.sub(EXPECTED_FUNDING_PRECISION_LOSS),
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_5_123,
                  interestShort: EXPECTED_INTEREST_5_123.mul(-1),
                  interestFee: EXPECTED_INTEREST_FEE_5_123,
                  pnlMaker: EXPECTED_PNL,
                  pnlShort: EXPECTED_PNL.mul(-1),
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.mul(-1).sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(8),
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_PNL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
              oracleFee: totalFee.div(10).sub(1), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: parse6decimal('125'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .div(10),
              },
              longPreValue: { _value: 0 },
              shortPreValue: {
                _value: EXPECTED_PNL.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              price: oracleVersionHigherPrice.price,
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.margin = parse6decimal('0.31')
              await market.updateRiskParameter(riskParameter)

              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('390')).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  parse6decimal('390'),
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  COLLATERAL,
                  false,
                )
            })

            it('with socialization to zero', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice.timestamp)
                .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice2.timestamp)
                .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)).sub(
                  EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96),
                ),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('390')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(20), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
                EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
              )
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(3), // loss of precision
                oracleFee: totalFee.div(10).sub(2).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: parse6decimal('96'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionLowerPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionLowerPrice2.price,
              })
            })

            it('with partial socialization', async () => {
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  POSITION.div(4),
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const EXPECTED_PNL = parse6decimal('27').mul(5).div(2)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 = 5620
              const EXPECTED_INTEREST_1 = BigNumber.from(5620)
              const EXPECTED_INTEREST_FEE_1 = EXPECTED_INTEREST_1.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_1 = EXPECTED_INTEREST_1.sub(EXPECTED_INTEREST_FEE_1)

              // (0.08 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 96 = 4385
              const EXPECTED_INTEREST_2 = BigNumber.from(4385)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 5 * 123 * 0.5 = 35105
              const EXPECTED_INTEREST_3 = BigNumber.from(35105)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              const oracleVersionHigherPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userC)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([oracleVersionHigherPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_1)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96)
                  .sub(EXPECTED_INTEREST_2)
                  .sub(EXPECTED_FUNDING_WITH_FEE_3_25_123)
                  .sub(EXPECTED_INTEREST_3)
                  .add(EXPECTED_PNL),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('390')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).mul(4).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2).mul(4).div(5))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(17), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userC.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(
                  EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1).div(5),
                )
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2).div(5))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3))
                  .sub(EXPECTED_PNL)
                  .sub(12), // loss of precision
              })
              expectPositionEq(await market.positions(userC.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
              })
              expectOrderEq(await market.pendingOrders(userC.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION.div(4),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_2))
                .add(EXPECTED_FUNDING_FEE_3_25_123.add(EXPECTED_INTEREST_FEE_3))
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(3).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(3), // loss of precision
                latestPrice: parse6decimal('96'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(4),
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(2)
                    .div(25)
                    .sub(1),
                }, // loss of precision
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .sub(EXPECTED_PNL.mul(2))
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .sub(1), // loss of precision
                }, // loss of precision
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_2))
                    .div(5)
                    .mul(-1),
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_2))
                    .mul(2)
                    .div(25)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3_25_123.add(EXPECTED_INTEREST_WITHOUT_FEE_3).mul(2).div(5))
                    .sub(EXPECTED_PNL.mul(2).div(5))
                    .sub(4), // loss of precision
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_1)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_2))
                    .add(EXPECTED_FUNDING_WITH_FEE_3_25_123.add(EXPECTED_INTEREST_3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice2.price,
              })
            })

            it('with shortfall', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)).add(
                  EXPECTED_PNL,
                ),
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: parse6decimal('390')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                  .sub(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: parse6decimal('43'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(1),
                }, // loss of precision
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([
                  oracleVersionHigherPrice2,
                  { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
                ])
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('390')
                .sub(EXPECTED_SETTLEMENT_FEE)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_43.add(EXPECTED_INTEREST_WITHOUT_FEE_5_43))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(28) // loss of precision
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userB.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, collateral: shortfall.mul(-1) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: 0,
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })

          context('short', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  0,
                  POSITION.div(2),
                  parse6decimal('216'),
                  false,
                )
            })

            it('default', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice.timestamp)
                .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    shortNeg: POSITION.div(2),
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('150'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice2.timestamp)
                .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                  .sub(EXPECTED_INTEREST_5_150)
                  .sub(EXPECTED_LIQUIDATION_FEE),
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                  .sub(22), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
                .add(EXPECTED_FUNDING_FEE_2_5_150)
                .add(EXPECTED_INTEREST_FEE_5_150)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
                oracleFee: totalFee.div(10).add(EXPECTED_SETTLEMENT_FEE),
                riskFee: totalFee.div(10),
                latestPrice: parse6decimal('150'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionLowerPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1),
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                    .add(EXPECTED_INTEREST_5_150)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionLowerPrice2.price,
              })
            })

            it('with shortfall', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.minMaintenance = parse6decimal('50')
              await market.connect(owner).updateRiskParameter(riskParameter)

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    shortNeg: POSITION.div(2),
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                  .sub(EXPECTED_INTEREST_5_123)
                  .sub(EXPECTED_PNL),
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                  .add(EXPECTED_PNL)
                  .sub(8), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
                oracleFee: totalFee.div(10).sub(1), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: parse6decimal('203'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                short: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                    .add(EXPECTED_PNL)
                    .div(10),
                },
                longPreValue: { _value: 0 },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                    .add(EXPECTED_PNL)
                    .div(5)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('203'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([
                  oracleVersionHigherPrice2,
                  { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
                ])
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.whenCalledWith(user.address).returns()

              const shortfall = parse6decimal('216')
                .sub(EXPECTED_SETTLEMENT_FEE)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .sub(EXPECTED_INTEREST_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_2_5_203)
                .sub(EXPECTED_INTEREST_5_203)
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, collateral: shortfall.mul(-1) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: 0,
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and funding / interest fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(marketParameter)

            const oracleVersionHigherPrice_0 = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            const oracleVersionHigherPrice_1 = {
              price: parse6decimal('118'),
              timestamp: TIMESTAMP + 10800,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice_0.timestamp)
              .returns([oracleVersionHigherPrice_0, INITIALIZED_ORACLE_RECEIPT])

            oracle.at
              .whenCalledWith(oracleVersionHigherPrice_1.timestamp)
              .returns([oracleVersionHigherPrice_1, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice_1, ORACLE_VERSION_5.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: parse6decimal('118'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_VERSION,
              price: oracleVersionHigherPrice_1.price,
            })
          })

          it('does not zero position and settlement fee upon closing', async () => {
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.makerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const PRICE_IMPACT = parse6decimal('4.010310') // skew -1.0 -> -1.5, price 123, exposure -2.5
            const EXPECTED_MAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const EXPECTED_SETTLEMENT_FEE = parse6decimal('0.50')

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.div(2), 0, 0, 0, false),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION.div(2) },
                { ...DEFAULT_GUARANTEE },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            const marketParameter2 = { ...(await market.parameter()) }
            marketParameter2.closed = true
            await market.updateParameter(marketParameter2)

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_SETTLEMENT_FEE).sub(EXPECTED_MAKER_FEE).sub(3), // price impact is refunded back to existing maker minus rounding dust
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_MAKER_FEE
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).add(1), // loss of precision
              oracleFee: totalFee.div(10).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              makerNeg: POSITION.div(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerCloseValue: { _value: PRICE_IMPACT.div(5) },
              makerFee: { _value: -EXPECTED_MAKER_FEE.div(5) },
              settlementFee: { _value: -EXPECTED_SETTLEMENT_FEE },
              spreadNeg: { _value: -PRICE_IMPACT.mul(2).div(5).add(1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(EXPECTED_SETTLEMENT_FEE).div(1e6) },
            })
          })
        })
      })

      context('all positions', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterSynBook = { ...riskParameter.synBook }
          riskParameterSynBook.scale = POSITION
          riskParameter.synBook = riskParameterSynBook
          await market.updateRiskParameter(riskParameter)
        })

        context('position delta', async () => {
          context('open', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )
            })

            it('opens the position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION,
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                collateral: COLLATERAL.mul(3),
                makerPos: POSITION,
                longPos: POSITION,
                shortPos: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens the position and settles', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION,
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION,
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                longPos: POSITION,
                shortPos: POSITION,
                collateral: COLLATERAL.mul(3),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 0,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                collateral: COLLATERAL,
                longPos: POSITION,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_1.timestamp,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 4,
                collateral: COLLATERAL.mul(3),
                makerPos: POSITION,
                longPos: POSITION,
                shortPos: POSITION,
              })
            })

            it('opens a second position and settles (same version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_2.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 2,
                longPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 4,
                makerPos: POSITION,
                longPos: POSITION,
                shortPos: POSITION,
                collateral: COLLATERAL.mul(3),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL,
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_2.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                ...DEFAULT_VERSION,
                price: PRICE,
              })
            })

            it('opens a second position and settles (next version)', async () => {
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longPos: POSITION.div(2) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
              })
            })

            it('opens the position and settles later', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                longPos: POSITION.div(2),
                shortPos: POSITION,
                collateral: COLLATERAL.mul(3),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
              })
            })

            it('opens the position and settles later with fee', async () => {
              await updateSynBook(market, DEFAULT_SYN_BOOK)

              const marketParameter = { ...(await market.parameter()) }
              marketParameter.takerFee = parse6decimal('0.01')
              await market.updateParameter(marketParameter)

              const PRICE_IMPACT = parse6decimal('0.640625') // skew 0.0 -> 0.5, price 123, exposure 5
              const EXPECTED_TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
              const EXPECTED_TAKER_FEE_C = parse6decimal('12.30') // position * (0.01) * price
              const SETTLEMENT_FEE = parse6decimal('0.50')

              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userC)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(EXPECTED_TAKER_FEE)
                  .sub(SETTLEMENT_FEE.div(3).add(1))
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(SETTLEMENT_FEE.div(3).add(1))
                  .sub(PRICE_IMPACT) // maker pays due to ordering
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userC.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL)
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                  .sub(SETTLEMENT_FEE.div(3).add(1))
                  .sub(EXPECTED_TAKER_FEE_C)
                  .add(PRICE_IMPACT) // maker pays due to ordering
                  .sub(9), // loss of precision
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                .add(EXPECTED_TAKER_FEE)
                .add(EXPECTED_TAKER_FEE_C)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(2),
                oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                longPos: POSITION.div(2),
                shortPos: POSITION,
                collateral: COLLATERAL.mul(3),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                shortPostValue: { _value: PRICE_IMPACT.div(10) },
                price: PRICE,
                liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
              })
            })

            it('opens the position and settles later from different account', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user, userB)
              await settle(market, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                longPos: POSITION.div(2),
                shortPos: POSITION,
                collateral: COLLATERAL.mul(3),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
              })
            })

            it('opens the position and deposits later from different account', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await deposit(market, COLLATERAL, user, userB)
              await deposit(market, COLLATERAL, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
              })
            })

            it('opens the position and settles later from different account while stale', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_6.timestamp])
              oracle.request.returns()

              await settle(market, user, userB)
              await settle(market, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 1,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 3,
                makerPos: POSITION,
                longPos: POSITION.div(2),
                shortPos: POSITION,
                collateral: COLLATERAL.mul(3),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
              })
            })

            it('opens the position and deposits later from different account while stale', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    POSITION.div(2),
                    0,
                    COLLATERAL,
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_2.timestamp,
                    orders: 1,
                    longPos: POSITION.div(2),
                    collateral: COLLATERAL,
                  },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

              oracle.at
                .whenCalledWith(ORACLE_VERSION_3.timestamp)
                .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_6.timestamp])
              oracle.request.returns()

              await deposit(market, COLLATERAL, user, userB)
              await deposit(market, COLLATERAL, userB, user)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)) // 50% to long, 50% to maker
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3)) // 33% from long, 67% from short
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: COLLATERAL.add(COLLATERAL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: PRICE,
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_6.timestamp,
                collateral: COLLATERAL.mul(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .div(10)
                    .sub(1), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
              })
            })
          })

          context('close', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )

              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            context('settles first', async () => {
              beforeEach(async () => {
                oracle.at
                  .whenCalledWith(ORACLE_VERSION_2.timestamp)
                  .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
                oracle.request.returns()

                await settle(market, user)
              })

              it('closes the position', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 1,
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  price: PRICE,
                })
              })

              it('closes the position and settles', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                  oracleFee: totalFee.div(10),
                  riskFee: totalFee.div(10),
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  price: PRICE,
                })
              })

              it('closes a second position (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 1,
                  collateral: COLLATERAL,
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  long: POSITION.div(2),
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 1,
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  maker: POSITION,
                  long: POSITION.div(2),
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
                  ...DEFAULT_VERSION,
                  price: PRICE,
                })
              })

              it('closes a second position and settles (same version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 2,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                  oracleFee: totalFee.div(10),
                  riskFee: totalFee.div(10),
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 2,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  price: PRICE,
                })
              })

              it('closes a second position (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  long: POSITION.div(4),
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 3,
                  latestId: 2,
                  protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                  oracleFee: totalFee.div(10),
                  riskFee: totalFee.div(10),
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  maker: POSITION,
                  long: POSITION.div(4),
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  price: PRICE,
                })
              })

              it('closes a second position and settles (next version)', async () => {
                await market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(4), 0, 0, false)

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
                oracle.request.returns()

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longNeg: POSITION.div(4) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 3,
                  latestId: 3,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.div(4))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_INTEREST_10_80_123_ALL.div(5))
                    .sub(3), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectLocalEq(await market.locals(userB.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 1,
                  latestId: 1,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.mul(3).div(4))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_80_123_ALL)
                    .sub(38), // loss of precision
                })
                expectPositionEq(await market.positions(userB.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                })
                expectOrderEq(await market.pendingOrders(userB.address, 1), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  makerPos: POSITION,
                  collateral: COLLATERAL,
                })
                expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_FUNDING_FEE_2_10_123_ALL)
                  .add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                  .add(EXPECTED_INTEREST_FEE_10_80_123_ALL)
                expectGlobalEq(await market.global(), {
                  ...DEFAULT_GLOBAL,
                  currentId: 3,
                  latestId: 3,
                  protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
                  oracleFee: totalFee.div(10),
                  riskFee: totalFee.div(10),
                  latestPrice: PRICE,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(3), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(4),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  price: PRICE,
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.mul(3).div(4))
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_80_123_ALL)
                      .div(10)
                      .sub(3), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .add(
                        EXPECTED_FUNDING_WITHOUT_FEE_2_10_123_ALL.div(4)
                          .sub(EXPECTED_INTEREST_10_80_123_ALL.div(5))
                          .mul(2)
                          .div(5),
                      )
                      .sub(2), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .add(
                        EXPECTED_FUNDING_WITH_FEE_2_10_123_ALL.add(EXPECTED_INTEREST_10_80_123_ALL.mul(4).div(5)).div(
                          10,
                        ),
                      )
                      .mul(-1)
                      .sub(2), // loss of precision
                  },
                  price: PRICE,
                })
              })

              it('closes the position and settles later', async () => {
                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  price: PRICE,
                })
              })

              it('closes the position and settles later with fee', async () => {
                await updateSynBook(market, DEFAULT_SYN_BOOK)

                const marketParameter = { ...(await market.parameter()) }
                marketParameter.takerFee = parse6decimal('0.01')
                await market.updateParameter(marketParameter)

                const EXPECTED_TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
                const PRICE_IMPACT = parse6decimal('2.63937') // skew -0.5 -> -1.0, price 123, exposure -5
                const SETTLEMENT_FEE = parse6decimal('0.50')

                await expect(
                  market
                    .connect(user)
                    ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
                )
                  .to.emit(market, 'OrderCreated')
                  .withArgs(
                    user.address,
                    { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
                    { ...DEFAULT_GUARANTEE },
                    constants.AddressZero,
                    constants.AddressZero,
                    constants.AddressZero,
                  )

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_3.timestamp)
                  .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

                oracle.at
                  .whenCalledWith(ORACLE_VERSION_4.timestamp)
                  .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
                oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
                oracle.request.returns()

                await settle(market, user)
                await settle(market, userB)

                expectLocalEq(await market.locals(user.address), {
                  ...DEFAULT_LOCAL,
                  currentId: 2,
                  latestId: 2,
                  collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_TAKER_FEE)
                    .sub(PRICE_IMPACT)
                    .sub(SETTLEMENT_FEE)
                    .sub(7), // loss of precision
                })
                expectPositionEq(await market.positions(user.address), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                })
                expectOrderEq(await market.pendingOrders(user.address, 2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                  ...DEFAULT_CHECKPOINT,
                })
                expectPositionEq(await market.position(), {
                  ...DEFAULT_POSITION,
                  timestamp: ORACLE_VERSION_4.timestamp,
                  maker: POSITION,
                  short: POSITION,
                })
                expectOrderEq(await market.pendingOrder(2), {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                })
                expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                  ...DEFAULT_VERSION,
                  makerPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                      .div(10)
                      .sub(1), // loss of precision
                  },
                  longPreValue: {
                    _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                      .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                      .div(5)
                      .sub(1), // loss of precision
                  },
                  shortPreValue: {
                    _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                      .div(10)
                      .mul(-1)
                      .sub(1), // loss of precision
                  },
                  makerCloseValue: { _value: PRICE_IMPACT.div(10) },
                  spreadNeg: { _value: -PRICE_IMPACT.div(5).add(1) },
                  takerFee: { _value: -EXPECTED_TAKER_FEE.div(5) },
                  settlementFee: { _value: -SETTLEMENT_FEE },
                  price: PRICE,
                  liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
                })
              })
            })
          })
        })

        context('price delta', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('same price same timestamp settle', async () => {
            const oracleVersionSameTimestamp = {
              price: PRICE,
              timestamp: TIMESTAMP + 3600,
              valid: true,
            }

            oracle.at
              .whenCalledWith(oracleVersionSameTimestamp.timestamp)
              .returns([oracleVersionSameTimestamp, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionSameTimestamp, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_2.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION,
              collateral: COLLATERAL.mul(3),
            })
          })

          it('lower price same rate settle', async () => {
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12).mul(2))

            const EXPECTED_PNL = parse6decimal('2').mul(10) // maker pnl

            const oracleVersionLowerPrice = {
              price: parse6decimal('121'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionLowerPrice.timestamp)
              .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2),
                  fundingLong: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2).add(1), // loss of precision
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.mul(-1).add(4), // loss of precision
                  fundingFee: EXPECTED_FUNDING_FEE_1_10_123_ALL.sub(5), // loss of precision
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL.sub(5), // loss of precision
                  interestLong: EXPECTED_INTEREST_10_67_123_ALL.div(3).mul(-1).add(2), // loss of precision
                  interestShort: EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3).mul(-1).add(3),
                  interestFee: EXPECTED_INTEREST_FEE_10_67_123_ALL.sub(1), // loss of precision
                  pnlMaker: EXPECTED_PNL.div(2).mul(-1),
                  pnlLong: EXPECTED_PNL.div(2).mul(-1),
                  pnlShort: EXPECTED_PNL,
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionLowerPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                .sub(2), // loss of precision
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
              oracleFee: totalFee.div(10),
              riskFee: totalFee.div(10),
              latestPrice: parse6decimal('121'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION,
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .div(10)
                  .sub(2), // loss of precision
              },
              longPreValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .div(5)
                  .sub(1), // loss of precision
              },
              shortPreValue: {
                _value: EXPECTED_PNL.sub(EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL)
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                  .div(10),
              },
              price: oracleVersionLowerPrice.price,
            })
          })

          it('higher price same rate settle', async () => {
            const EXPECTED_PNL = parse6decimal('-2').mul(10)

            const oracleVersionHigherPrice = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice.timestamp)
              .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
            oracle.request.returns()

            await expect(settle(market, user))
              .to.emit(market, 'PositionProcessed')
              .withArgs(
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_VERSION_ACCUMULATION_RESULT,
                  fundingMaker: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2),
                  fundingLong: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2).add(1), // loss of precision
                  fundingShort: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.mul(-1).add(4), // loss of precision
                  fundingFee: EXPECTED_FUNDING_FEE_1_10_123_ALL.sub(5), // loss of precision
                  interestMaker: EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL.sub(5), // loss of precision
                  interestLong: EXPECTED_INTEREST_10_67_123_ALL.div(3).mul(-1).add(2), // loss of precision
                  interestShort: EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3).mul(-1).add(3),
                  interestFee: EXPECTED_INTEREST_FEE_10_67_123_ALL.sub(1), // loss of precision
                  pnlMaker: EXPECTED_PNL.div(2).mul(-1),
                  pnlLong: EXPECTED_PNL.div(2).mul(-1),
                  pnlShort: EXPECTED_PNL,
                },
              )
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                user.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(2), // loss of precision
                },
              )

            await expect(settle(market, userB))
              .to.emit(market, 'AccountPositionProcessed')
              .withArgs(
                userB.address,
                1,
                { ...DEFAULT_ORDER, timestamp: oracleVersionHigherPrice.timestamp },
                {
                  ...DEFAULT_LOCAL_ACCUMULATION_RESULT,
                  collateral: EXPECTED_PNL.div(2)
                    .mul(-1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(13), // loss of precision
                },
              )

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                .sub(2), // loss of precision
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_PNL.div(2))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
              oracleFee: totalFee.div(10),
              riskFee: totalFee.div(10),
              latestPrice: parse6decimal('125'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION,
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .div(10)
                  .sub(1), // loss of precision
              },
              longPreValue: {
                _value: EXPECTED_PNL.div(2)
                  .mul(-1)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .div(5),
              },
              shortPreValue: {
                _value: EXPECTED_PNL.sub(EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL)
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                  .div(10)
                  .sub(1), // loss of precision
              },
              price: oracleVersionHigherPrice.price,
            })
          })
        })

        context('liquidation', async () => {
          context('maker', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  parse6decimal('450'),
                  false,
                )
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )

              dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  COLLATERAL,
                  false,
                )
            })

            it('with socialization to zero', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('78').mul(5)
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')

              const oracleVersionHigherPrice = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)

              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: parse6decimal('1') }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([oracleVersionHigherPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.sub(EXPECTED_PNL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_45_ALL.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3_10_123_ALL)
                  .sub(9), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('450')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL)
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(25), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                .add(EXPECTED_FUNDING_FEE_2_10_45_ALL)
                .add(EXPECTED_INTEREST_FEE_10_67_45_ALL)
                .add(EXPECTED_FUNDING_FEE_3_10_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(6), // loss of precision
                oracleFee: totalFee.div(10).sub(2).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(3), // loss of precision
                latestPrice: parse6decimal('45'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_45_ALL.div(3))
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_10_67_45_ALL.mul(2).div(3))
                    .div(10)
                    .mul(-1),
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_45_ALL)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_45_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3_10_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_10_67_45_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_3_10_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice2.price,
              })
            })

            it('with partial socialization', async () => {
              // (0.258823 / 365 / 24 / 60 / 60 ) * 3600 * 12 * 123 = 43610
              const EXPECTED_INTEREST_1 = BigNumber.from(43610)
              const EXPECTED_INTEREST_FEE_1 = EXPECTED_INTEREST_1.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_1 = EXPECTED_INTEREST_1.sub(EXPECTED_INTEREST_FEE_1)

              // (0.258823 / 365 / 24 / 60 / 60 ) * 3600 * 12 * 45 = 15960
              const EXPECTED_INTEREST_2 = BigNumber.from(15960)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 2 * 123 = 28090
              const EXPECTED_INTEREST_3 = BigNumber.from(28090)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              // rate_0 = 0.09
              // rate_1 = rate_0 + (elapsed * skew / k)
              // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
              // (0.09 + (0.09 + 3600 * 0.50 / 40000)) / 2 * 3600 * 7 * 123 / (86400 * 365) = 11060
              const EXPECTED_FUNDING_3 = BigNumber.from(11060)
              const EXPECTED_FUNDING_FEE_3 = BigNumber.from(1110)
              const EXPECTED_FUNDING_WITH_FEE_3 = EXPECTED_FUNDING_3.add(EXPECTED_FUNDING_FEE_3.div(2))
              const EXPECTED_FUNDING_WITHOUT_FEE_3 = EXPECTED_FUNDING_3.sub(EXPECTED_FUNDING_FEE_3.div(2))

              dsu.transferFrom.whenCalledWith(userD.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userD)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userD.address,
                  POSITION.div(5),
                  0,
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userD)

              const EXPECTED_PNL = parse6decimal('78').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userD)

              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userD)

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('45'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([oracleVersionHigherPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice2, oracleVersionHigherPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)
              await settle(market, userD)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_1.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                  .sub(EXPECTED_INTEREST_2.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3.mul(5).div(7))
                  .sub(EXPECTED_INTEREST_3.div(3))
                  .sub(EXPECTED_PNL)
                  .sub(6), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('450')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.mul(5).div(12))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_1.mul(10).div(12))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.mul(5).div(12))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_2.mul(10).div(12))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(19), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_1)
                .add(EXPECTED_FUNDING_FEE_2_10_45_ALL)
                .add(EXPECTED_INTEREST_FEE_2)
                .add(EXPECTED_FUNDING_FEE_3)
                .add(EXPECTED_INTEREST_FEE_3)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(11), // loss of precision
                oracleFee: totalFee.div(10).sub(2).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(2), // loss of precision
                latestPrice: parse6decimal('45'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION.div(5),
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .sub(EXPECTED_PNL)
                    .div(12)
                    .sub(1),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_1.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_1.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_2)
                    .div(12)
                    .sub(2), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_1.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_2.div(3))
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_1.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_2.mul(2).div(3))
                    .div(10)
                    .mul(-1)
                    .sub(1), // loss of precision
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_1)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_2)
                    .div(12)
                    .add(
                      EXPECTED_FUNDING_WITHOUT_FEE_3.mul(2)
                        .div(7)
                        .add(EXPECTED_INTEREST_WITHOUT_FEE_3)
                        .sub(EXPECTED_PNL.mul(2).div(5))
                        .div(2),
                    )
                    .sub(6), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_1.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_45_ALL.div(2))
                    .sub(EXPECTED_INTEREST_2.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3.mul(5).div(7))
                    .sub(EXPECTED_INTEREST_3.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_1.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_45_ALL)
                    .add(EXPECTED_INTEREST_2.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_3)
                    .add(EXPECTED_INTEREST_3.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(7).div(5))
                    .div(10)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice2.price,
              })
            })

            it('with shortfall', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('90').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionHigherPrice = {
                price: parse6decimal('33'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice.timestamp)
                .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionHigherPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, user)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    makerNeg: POSITION,
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .sub(EXPECTED_PNL)
                  .sub(2), // loss of precision
              })
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: parse6decimal('450')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(EXPECTED_PNL)
                  .sub(13), // loss of precision
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: parse6decimal('33'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                makerNeg: POSITION,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                price: oracleVersionHigherPrice.price,
              })

              const oracleVersionHigherPrice2 = {
                price: parse6decimal('33'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionHigherPrice2.timestamp)
                .returns([
                  oracleVersionHigherPrice2,
                  { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
                ])
              oracle.status.returns([oracleVersionHigherPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              const shortfall = parse6decimal('450')
                .sub(EXPECTED_SETTLEMENT_FEE)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_33_ALL.div(2))
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_33_ALL)
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(27) // loss of precision

              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)
              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userB.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  userB.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, collateral: shortfall.mul(-1) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: 0,
              })
              expect(await market.liquidators(userB.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })

          context('long', async () => {
            beforeEach(async () => {
              dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION,
                  COLLATERAL,
                  false,
                )
              dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  POSITION.div(2),
                  0,
                  parse6decimal('216'),
                  false,
                )
            })

            it('default', async () => {
              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('27').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice.timestamp)
                .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    longNeg: POSITION.div(2),
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_4.timestamp)
                .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
              oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('96'),
                timestamp: TIMESTAMP + 14400,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice2.timestamp)
                .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              // rate_0 = 0.09
              // rate_1 = rate_0 + (elapsed * skew / k)
              // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
              // (0.09 + (0.09 + 3600 * 1.00 / 40000)) / 2 * 3600 * 10 * 123 / (86400 * 365) = 18960
              const EXPECTED_FUNDING_3 = BigNumber.from(18960)
              const EXPECTED_FUNDING_FEE_3 = BigNumber.from(1896)
              const EXPECTED_FUNDING_WITH_FEE_3 = EXPECTED_FUNDING_3.add(EXPECTED_FUNDING_FEE_3.div(2))
              const EXPECTED_FUNDING_WITHOUT_FEE_3 = EXPECTED_FUNDING_3.sub(EXPECTED_FUNDING_FEE_3.div(2))

              // rate * elapsed * utilization * min(maker, taker) * price
              // (1.00 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 123 = 140410
              const EXPECTED_INTEREST_3 = BigNumber.from(140410)
              const EXPECTED_INTEREST_FEE_3 = EXPECTED_INTEREST_3.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_3 = EXPECTED_INTEREST_3.sub(EXPECTED_INTEREST_FEE_3)

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 2,
                collateral: parse6decimal('216')
                  .sub(EXPECTED_SETTLEMENT_FEE)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_96_ALL.div(3))
                  .sub(EXPECTED_LIQUIDATION_FEE)
                  .sub(9), // loss of precision
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL)
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_3)
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_3)
                  .sub(EXPECTED_PNL.mul(2))
                  .sub(45), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
                .add(EXPECTED_FUNDING_FEE_2_10_96_ALL)
                .add(EXPECTED_INTEREST_FEE_10_67_96_ALL)
                .add(EXPECTED_FUNDING_FEE_3)
                .add(EXPECTED_INTEREST_FEE_3)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 2,
                protocolFee: totalFee.mul(8).div(10).sub(5), // loss of precision
                oracleFee: totalFee.div(10).sub(1).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
                riskFee: totalFee.div(10).sub(1), // loss of precision
                latestPrice: parse6decimal('96'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_5.timestamp,
                maker: POSITION,
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(-1)
                    .div(10),
                },
                price: oracleVersionLowerPrice.price,
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL)
                    .div(10)
                    .sub(2),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_96_ALL.div(3))
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_96_ALL)
                    .add(EXPECTED_INTEREST_10_67_96_ALL.mul(2).div(3))
                    .mul(-1)
                    .div(10)
                    .sub(1), // loss of precision
                },
                price: PRICE,
                settlementFee: { _value: parse6decimal('-1') },
                liquidationFee: { _value: parse6decimal('-10') },
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_96_ALL)
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_3)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_3)
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .sub(5),
                }, // loss of precision
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .add(EXPECTED_FUNDING_WITHOUT_FEE_2_10_96_ALL.div(2))
                    .sub(EXPECTED_INTEREST_10_67_96_ALL.div(3))
                    .div(5)
                    .sub(2), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_2_10_96_ALL)
                    .add(EXPECTED_INTEREST_10_67_96_ALL.mul(2).div(3))
                    .add(EXPECTED_FUNDING_WITH_FEE_3)
                    .add(EXPECTED_INTEREST_3)
                    .sub(EXPECTED_PNL.mul(2))
                    .mul(-1)
                    .div(10)
                    .sub(1), // loss of precision
                },
                price: oracleVersionLowerPrice2.price,
              })
            })

            it('with shortfall', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.minMaintenance = parse6decimal('50')
              await market.connect(owner).updateRiskParameter(riskParameter)

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.returns()

              await settle(market, user)
              await settle(market, userB)

              const EXPECTED_PNL = parse6decimal('80').mul(5)
              const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
              const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

              const oracleVersionLowerPrice = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 7200,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice.timestamp)
                .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
              oracle.request.returns()

              await settle(market, userB)
              dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
              dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  {
                    ...DEFAULT_ORDER,
                    timestamp: ORACLE_VERSION_4.timestamp,
                    orders: 1,
                    longNeg: POSITION.div(2),
                    protection: 1,
                  },
                  { ...DEFAULT_GUARANTEE },
                  liquidator.address,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              // rate_1 = rate_0 + (elapsed * skew / k)
              // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
              // (0.045 + (0.045 + 3600 * 0.5 / 40000)) / 2 * 3600 * 10 * 43 / (86400 * 365) = 3315
              const EXPECTED_FUNDING_2 = BigNumber.from(3315)
              const EXPECTED_FUNDING_FEE_2 = BigNumber.from(330)
              const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.add(EXPECTED_FUNDING_FEE_2.div(2))
              const EXPECTED_FUNDING_WITHOUT_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2.div(2))

              // rate * elapsed * utilization * min(maker, taker) * price
              // (0.40 / 365 / 24 / 60 / 60 ) * 3600 * 10 * 43 = 19640
              const EXPECTED_INTEREST_2 = BigNumber.from(19640)
              const EXPECTED_INTEREST_FEE_2 = EXPECTED_INTEREST_2.div(10)
              const EXPECTED_INTEREST_WITHOUT_FEE_2 = EXPECTED_INTEREST_2.sub(EXPECTED_INTEREST_FEE_2)

              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 2,
                latestId: 1,
                collateral: parse6decimal('216')
                  .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                  .sub(EXPECTED_PNL)
                  .sub(2), // loss of precision
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                long: POSITION.div(2),
              })
              expectOrderEq(await market.pendingOrders(user.address, 2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              expectLocalEq(await market.locals(userB.address), {
                ...DEFAULT_LOCAL,
                currentId: 1,
                latestId: 1,
                collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                  .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                  .sub(EXPECTED_PNL)
                  .sub(13), // loss of precision
              })
              expectPositionEq(await market.positions(userB.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
              })
              expectOrderEq(await market.pendingOrders(userB.address, 1), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              })
              expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
              const totalFee = EXPECTED_FUNDING_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_FEE_10_67_123_ALL)
              expectGlobalEq(await market.global(), {
                ...DEFAULT_GLOBAL,
                currentId: 2,
                latestId: 1,
                protocolFee: totalFee.mul(8).div(10).sub(4), // loss of precision
                oracleFee: totalFee.div(10),
                riskFee: totalFee.div(10),
                latestPrice: parse6decimal('43'),
              })
              expectPositionEq(await market.position(), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_3.timestamp,
                maker: POSITION,
                long: POSITION.div(2),
                short: POSITION,
              })
              expectOrderEq(await market.pendingOrder(2), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
              })
              expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
                ...DEFAULT_VERSION,
                makerPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .add(EXPECTED_INTEREST_WITHOUT_FEE_10_67_123_ALL)
                    .sub(EXPECTED_PNL)
                    .div(10)
                    .sub(2), // loss of precision
                },
                longPreValue: {
                  _value: EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2)
                    .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                    .sub(EXPECTED_PNL)
                    .div(5)
                    .sub(1), // loss of precision
                },
                shortPreValue: {
                  _value: EXPECTED_FUNDING_WITH_FEE_1_10_123_ALL.add(EXPECTED_INTEREST_10_67_123_ALL.mul(2).div(3))
                    .sub(EXPECTED_PNL.mul(2))
                    .div(10)
                    .mul(-1),
                },
                price: oracleVersionLowerPrice.price,
              })

              const oracleVersionLowerPrice2 = {
                price: parse6decimal('43'),
                timestamp: TIMESTAMP + 10800,
                valid: true,
              }
              oracle.at
                .whenCalledWith(oracleVersionLowerPrice2.timestamp)
                .returns([
                  oracleVersionLowerPrice2,
                  { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
                ])
              oracle.status.returns([oracleVersionLowerPrice2, ORACLE_VERSION_5.timestamp])
              oracle.request.returns()

              const shortfall = parse6decimal('216')
                .sub(EXPECTED_SETTLEMENT_FEE)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_10_123_ALL.div(2))
                .sub(EXPECTED_INTEREST_10_67_123_ALL.div(3))
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2.div(2))
                .sub(EXPECTED_INTEREST_2.div(3))
                .sub(EXPECTED_LIQUIDATION_FEE)
                .sub(EXPECTED_PNL)
                .sub(6) // loss of precision
              dsu.transferFrom
                .whenCalledWith(liquidator.address, market.address, shortfall.mul(-1).mul(1e12))
                .returns(true)

              await expect(
                market
                  .connect(liquidator)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    user.address,
                    0,
                    0,
                    0,
                    shortfall.mul(-1),
                    false,
                  ),
              )
                .to.emit(market, 'OrderCreated')
                .withArgs(
                  user.address,
                  { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, collateral: shortfall.mul(-1) },
                  { ...DEFAULT_GUARANTEE },
                  constants.AddressZero,
                  constants.AddressZero,
                  constants.AddressZero,
                )

              expectLocalEq(await market.locals(liquidator.address), {
                ...DEFAULT_LOCAL,
                currentId: 0,
                latestId: 0,
                claimable: EXPECTED_LIQUIDATION_FEE,
              })
              expectLocalEq(await market.locals(user.address), {
                ...DEFAULT_LOCAL,
                currentId: 3,
                latestId: 2,
                collateral: 0,
              })
              expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
              expectPositionEq(await market.positions(user.address), {
                ...DEFAULT_POSITION,
                timestamp: ORACLE_VERSION_4.timestamp,
              })
              expectOrderEq(await market.pendingOrders(user.address, 3), {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                collateral: shortfall.mul(-1),
              })
              expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
                ...DEFAULT_CHECKPOINT,
              })
            })
          })
        })

        context('closed', async () => {
          beforeEach(async () => {
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )
            dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, POSITION, COLLATERAL, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('zeroes PnL and fees (price change)', async () => {
            const marketParameter = { ...(await market.parameter()) }
            marketParameter.closed = true
            await market.updateParameter(marketParameter)

            const oracleVersionHigherPrice_0 = {
              price: parse6decimal('125'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            const oracleVersionHigherPrice_1 = {
              price: parse6decimal('128'),
              timestamp: TIMESTAMP + 10800,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice_0.timestamp)
              .returns([oracleVersionHigherPrice_0, INITIALIZED_ORACLE_RECEIPT])

            oracle.at
              .whenCalledWith(oracleVersionHigherPrice_1.timestamp)
              .returns([oracleVersionHigherPrice_1, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice_1, ORACLE_VERSION_5.timestamp])
            oracle.request.returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL,
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              latestPrice: parse6decimal('128'),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_4.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION,
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_VERSION,
              price: oracleVersionHigherPrice_1.price,
            })
          })
        })
      })

      context('invariant violations', async () => {
        it('reverts if under margin', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('500')).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                parse6decimal('1000'),
                0,
                0,
                parse6decimal('500'),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })

        it('reverts if under margin (intent maker)', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.maxPriceDeviation = parse6decimal('10.00')
          await market.updateParameter(marketParameter)

          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('1250'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          const LOWER_COLLATERAL = parse6decimal('500')

          dsu.transferFrom.whenCalledWith(user.address, market.address, LOWER_COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, LOWER_COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, LOWER_COLLATERAL.mul(1e12)).returns(true)

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              POSITION,
              0,
              0,
              LOWER_COLLATERAL,
              false,
            )

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, LOWER_COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, LOWER_COLLATERAL, false)

          verifier.verifyIntent.returns()

          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })

        it('reverts if under margin (intent taker)', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.maxPriceDeviation = parse6decimal('10.00')
          await market.updateParameter(marketParameter)

          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('25'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          const LOWER_COLLATERAL = parse6decimal('500')

          dsu.transferFrom.whenCalledWith(user.address, market.address, LOWER_COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, LOWER_COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, LOWER_COLLATERAL.mul(1e12)).returns(true)

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              POSITION,
              0,
              0,
              LOWER_COLLATERAL,
              false,
            )

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, LOWER_COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, LOWER_COLLATERAL, false)

          verifier.verifyIntent.returns()

          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })

        it('reverts if above price deviation (higher)', async () => {
          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('136'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketIntentPriceDeviationError')
        })

        it('reverts if above price deviation (lower)', async () => {
          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('110'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketIntentPriceDeviationError')
        })

        it('reverts if paused (market)', async () => {
          factory.paused.returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'InstancePausedError')
          factory.paused.returns(false)
        })

        it('reverts if paused (intent)', async () => {
          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('125'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          factory.paused.returns(true)
          await expect(
            market
              .connect(user)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](user.address, intent, '0x'),
          ).to.be.revertedWithCustomError(market, 'InstancePausedError')
          factory.paused.returns(false)
        })

        it('revert if paused settle', async () => {
          factory.paused.returns(true)
          await expect(market.connect(user).settle(user.address)).to.be.revertedWithCustomError(
            market,
            'InstancePausedError',
          )
          factory.paused.returns(false)
        })

        it('reverts if over maker limit', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.makerLimit = POSITION.div(2)
          await market.updateRiskParameter(riskParameter)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketMakerOverLimitError')
        })

        it('reverts if under efficiency limit', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.efficiencyLimit = parse6decimal('0.6')
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              POSITION.div(2),
              0,
              0,
              COLLATERAL,
              false,
            )
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, POSITION, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
        })

        it('reverts if too many pending orders (global)', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.maxPendingGlobal = BigNumber.from(3)
          await market.updateParameter(marketParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              POSITION.div(2),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 1])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              POSITION.add(1),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 2])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              POSITION.add(2),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 3])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(3), 0, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketExceedsPendingIdLimitError')
        })

        it('reverts if too many pending orders (local)', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.maxPendingLocal = BigNumber.from(3)
          await market.updateParameter(marketParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              POSITION.div(2),
              0,
              0,
              COLLATERAL,
              false,
            )

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 1])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, 0, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 2])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(2), 0, 0, 0, false)

          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp + 3])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(3), 0, 0, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketExceedsPendingIdLimitError')
        })

        it('reverts if not single sided', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                POSITION,
                POSITION,
                0,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                POSITION,
                0,
                POSITION,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION,
                POSITION,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')
        })

        it('reverts if insufficient collateral', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                0,
                COLLATERAL.add(1).mul(-1),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientCollateralError')
        })

        it('reverts if price is stale', async () => {
          const riskParameter = { ...(await market.riskParameter()), staleAfter: BigNumber.from(7200) }
          await market.connect(owner).updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp - 1])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // revert if withdrawing
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')

          // revert if changing position
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')
        })

        it('reverts if price is stale (invalid)', async () => {
          const riskParameter = { ...(await market.riskParameter()), staleAfter: BigNumber.from(10800) }
          await market.connect(owner).updateRiskParameter(riskParameter)

          oracle.at
            .whenCalledWith(ORACLE_VERSION_1.timestamp)
            .returns([{ ...ORACLE_VERSION_1, valid: false }, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([{ ...ORACLE_VERSION_1, valid: false }, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // revert if withdrawing
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')

          // revert if changing position
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketStalePriceError')
        })

        it('reverts if sender is not account', async () => {
          const riskParameter = { ...(await market.riskParameter()), staleAfter: BigNumber.from(7200) }
          await market.connect(owner).updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_3.timestamp - 1])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // revert if withdrawing
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')

          // revert if changing position
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION.add(1), 0, 0, -1, false),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')
        })

        it('reverts if under minimum margin', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('1')).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('99'),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })

        it('reverts if closed', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.closed = true
          await market.updateParameter(marketParameter)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketClosedError')
        })

        it('reverts if taker > maker', async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)

          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                0,
                POSITION.add(1),
                0,
                COLLATERAL,
                false,
              ),
          ).to.be.revertedWithCustomError(market, `MarketInsufficientLiquidityError`)
        })

        it('reverts when the position is over-closed', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = BigNumber.from(14400)
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          // open to POSITION (POSITION / 2 settled)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // can't close more than POSITION / 2
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2).sub(1),
                0,
                0,
                false,
              ),
          ).to.revertedWithCustomError(market, 'MarketOverCloseError')

          // close out as much as possible
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longNeg: POSITION.div(2) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // can't close any more
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2).sub(1),
                0,
                0,
                false,
              ),
          ).to.revertedWithCustomError(market, 'MarketOverCloseError')

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          // can now close out rest
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, orders: 1, longNeg: POSITION.div(2) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
          oracle.at.whenCalledWith(ORACLE_VERSION_5.timestamp).returns([ORACLE_VERSION_5, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_5, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
        })

        context('in liquidation', async () => {
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('225')

          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, utils.parseEther('450')).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                POSITION,
                0,
                0,
                parse6decimal('450'),
                false,
              )
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

            const oracleVersionHigherPrice = {
              price: parse6decimal('150'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at
              .whenCalledWith(oracleVersionHigherPrice.timestamp)
              .returns([oracleVersionHigherPrice, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersionHigherPrice, oracleVersionHigherPrice.timestamp + 3600])
            oracle.request.whenCalledWith(user.address).returns()

            dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
            dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
          })

          it('it reverts if not protected', async () => {
            await expect(
              market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
            ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
          })

          it('it reverts if already liquidated', async () => {
            await market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, true)

            await expect(
              market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                ),
            ).to.be.revertedWithCustomError(market, 'MarketProtectedError')
          })

          it('it reverts if withdrawing collateral', async () => {
            await expect(
              market
                .connect(liquidator)
                ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, -1, true),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })

          it('it reverts if position doesnt close', async () => {
            await expect(
              market
                .connect(liquidator)
                ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 1, 0, 0, 0, true),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })

          it('reverts if position increases in magnitude', async () => {
            const positionMaker = parse6decimal('20.000')
            const positionLong = parse6decimal('10.000')
            const collateral = parse6decimal('1000')
            const collateral2 = parse6decimal('350')
            const collateralWithdraw2 = parse6decimal('50')
            const collateralLiquidate = parse6decimal('4611686018427') // 2^62-1

            const oracleVersion = {
              price: parse6decimal('100'),
              timestamp: TIMESTAMP + 7200,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersion.timestamp).returns([oracleVersion, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersion, TIMESTAMP + 7300])
            oracle.request.returns()

            dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                positionMaker,
                0,
                0,
                collateral,
                false,
              )
            dsu.transferFrom.whenCalledWith(user.address, market.address, collateral2.mul(1e12)).returns(true)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                positionLong,
                0,
                collateral2,
                false,
              )

            const oracleVersion2 = {
              price: parse6decimal('100'),
              timestamp: TIMESTAMP + 7300,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersion2.timestamp).returns([oracleVersion2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersion2, TIMESTAMP + 7400])
            oracle.request.returns()

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

            oracle.status.returns([oracleVersion2, TIMESTAMP + 7500])
            oracle.request.returns()

            dsu.transfer.whenCalledWith(user.address, collateralWithdraw2.mul(1e12)).returns(true)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                0,
                -collateralWithdraw2,
                false,
              )

            const oracleVersion3 = {
              price: parse6decimal('99.9999'),
              timestamp: TIMESTAMP + 7380,
              valid: true,
            }
            oracle.at.whenCalledWith(oracleVersion3.timestamp).returns([oracleVersion3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([oracleVersion3, TIMESTAMP + 7500])
            oracle.request.returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  user.address,
                  0,
                  collateralLiquidate,
                  0,
                  0,
                  true,
                ),
            ).to.be.revertedWithCustomError(market, 'MarketInvalidProtectionError')
          })
        })

        context('always close mode', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          })

          context('closing long', async () => {
            beforeEach(async () => {
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  0,
                  POSITION.mul(2),
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()
              await settle(market, user)
            })

            it('allows closing long', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              ).to.not.be.reverted
            })

            it('disallows short increasing (efficiency)', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.5')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })

            it('disallows short increasing (liquidity)', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.3')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })
          })

          context('closing short', async () => {
            beforeEach(async () => {
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, COLLATERAL, false)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  POSITION.mul(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()
              await settle(market, user)
            })

            it('allows closing short position', async () => {
              await expect(
                market
                  .connect(user)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false),
              ).to.not.be.reverted
            })

            it('disallows long increasing (efficiency)', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.5')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })

            it('disallows long increasing (liquidity)', async () => {
              const riskParameter = { ...(await market.riskParameter()) }
              riskParameter.efficiencyLimit = parse6decimal('0.3')
              await market.updateRiskParameter(riskParameter)

              await expect(
                market
                  .connect(userC)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](
                    userC.address,
                    0,
                    POSITION.mul(2).add(1),
                    0,
                    0,
                    false,
                  ),
              ).to.revertedWithCustomError(market, 'MarketInsufficientLiquidityError')
            })
          })

          context('closing maker', async () => {
            beforeEach(async () => {
              await market
                .connect(userB)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userB.address,
                  POSITION,
                  0,
                  0,
                  COLLATERAL,
                  false,
                )
              await market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, COLLATERAL, false)
              await market
                .connect(userC)
                ['update(address,uint256,uint256,uint256,int256,bool)'](
                  userC.address,
                  0,
                  POSITION.mul(2),
                  0,
                  COLLATERAL,
                  false,
                )

              oracle.at
                .whenCalledWith(ORACLE_VERSION_2.timestamp)
                .returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
              oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
              oracle.request.whenCalledWith(user.address).returns()
              await settle(market, user)
            })

            it('disallows closing maker', async () => {
              await expect(
                market
                  .connect(userB)
                  ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, 0, 0, 0, 0, false),
              ).to.revertedWithCustomError(market, 'MarketEfficiencyUnderLimitError')
            })
          })
        })
      })

      context('settle only', async () => {
        it('reverts if update during settle-only', async () => {
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.settle = true
          await market.updateParameter(marketParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('500')).returns(true)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                parse6decimal('10'),
                0,
                0,
                parse6decimal('1000'),
                false,
              ),
          ).to.be.revertedWithCustomError(market, 'MarketSettleOnlyError')
        })
      })

      context('liquidation w/ under min collateral', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              parse6decimal('216'),
              false,
            )
        })

        it('properly charges liquidation fee', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('80').mul(5)
          const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('50')

          const oracleVersionLowerPrice = {
            price: parse6decimal('43'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice.timestamp)
            .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                longNeg: POSITION.div(2),
                protection: 1,
              },
              { ...DEFAULT_GUARANTEE },
              liquidator.address,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 1,
            collateral: parse6decimal('216')
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
              .sub(EXPECTED_PNL),
          })
          expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
            protection: 1,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
              .add(EXPECTED_PNL)
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
            oracleFee: totalFee.div(10).sub(1), // loss of precision
            riskFee: totalFee.div(10).sub(1), // loss of precision
            latestPrice: parse6decimal('43'),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            },
            longPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            shortPreValue: { _value: 0 },
            price: oracleVersionLowerPrice.price,
          })
        })
      })

      context('liquidation w/ partial closed', async () => {
        beforeEach(async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.staleAfter = BigNumber.from(14400)
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('324')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              POSITION.div(2),
              parse6decimal('324'),
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              POSITION.mul(3).div(4),
              0,
              false,
            )
          await settle(market, userB)
        })

        it('default', async () => {
          const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

          const oracleVersionLowerPrice = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice.timestamp)
            .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(4).sub(1),
                0,
                true,
              ),
          ).to.revertedWithCustomError(market, 'MarketOverCloseError')

          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.add(1).mul(1e12)).returns(true)
          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), -1, true),
          ).to.revertedWithCustomError(market, 'MarketInvalidProtectionError')

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION.div(4), 0, true),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
                protection: 1,
              },
              { ...DEFAULT_GUARANTEE },
              liquidator.address,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_5.timestamp)
            .returns([ORACLE_VERSION_5, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_5, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const oracleVersionLowerPrice2 = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 14400,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice2.timestamp)
            .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            currentId: 0,
            latestId: 0,
            claimable: EXPECTED_LIQUIDATION_FEE,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            short: POSITION.div(4),
          })

          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          await expect(market.connect(liquidator).claimFee(liquidator.address))
            .to.emit(market, 'FeeClaimed')
            .withArgs(liquidator.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)

          expectLocalEq(await market.locals(liquidator.address), DEFAULT_LOCAL)
        })
      })

      context('liquidation w/ invalidation', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              0,
              POSITION.div(2),
              parse6decimal('216'),
              false,
            )
        })

        it('default', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('27').mul(5)
          const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

          const oracleVersionLowerPrice = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice.timestamp)
            .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))
          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_4.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
                protection: 1,
              },
              { ...DEFAULT_GUARANTEE },
              liquidator.address,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([
            { ...ORACLE_VERSION_4, price: oracleVersionLowerPrice.price, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE },
          ])
          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp + 1).returns([
            {
              ...ORACLE_VERSION_4,
              timestamp: ORACLE_VERSION_4.timestamp + 1,
              price: oracleVersionLowerPrice.price,
            },
            INITIALIZED_ORACLE_RECEIPT,
          ])
          oracle.status.returns([
            { ...ORACLE_VERSION_4, timestamp: ORACLE_VERSION_4.timestamp + 1, price: oracleVersionLowerPrice.price },
            ORACLE_VERSION_5.timestamp,
          ])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(liquidator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_5.timestamp,
                orders: 1,
                shortNeg: POSITION.div(2),
                protection: 1,
              },
              { ...DEFAULT_GUARANTEE },
              liquidator.address,
              constants.AddressZero,
              constants.AddressZero,
            )
          await settle(market, userB)

          oracle.at
            .whenCalledWith(ORACLE_VERSION_5.timestamp)
            .returns([ORACLE_VERSION_5, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_5, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const oracleVersionLowerPrice2 = {
            price: parse6decimal('150'),
            timestamp: TIMESTAMP + 18000,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice2.timestamp)
            .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_ROUND_3_ACC = BigNumber.from(28795) // position open one extra version due to invalid first liquidation
          const EXPECTED_ROUND_3_ACC_WITHOUT_FEE = BigNumber.from(26010)
          const EXPECTED_ROUND_3_ACC_FEE = EXPECTED_ROUND_3_ACC.sub(EXPECTED_ROUND_3_ACC_WITHOUT_FEE)

          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            currentId: 0,
            latestId: 0,
            claimable: EXPECTED_LIQUIDATION_FEE, // does not double charge
          })
          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 3,
            collateral: parse6decimal('216')
              .sub(EXPECTED_SETTLEMENT_FEE.mul(2)) // including invalidation
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_2_5_150)
              .sub(EXPECTED_INTEREST_5_150)
              .sub(EXPECTED_ROUND_3_ACC)
              .sub(EXPECTED_LIQUIDATION_FEE), // does not double charge
          })
          expect(await market.liquidators(user.address, 3)).to.equal(liquidator.address)
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_6.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            shortNeg: POSITION.div(2),
            protection: 1,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp + 3600), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
              .add(EXPECTED_ROUND_3_ACC_WITHOUT_FEE)
              .sub(32)
              .sub(10), // loss of precision / 1-sec invalid delay
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_6.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp + 3600), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_2_5_150)
            .add(EXPECTED_INTEREST_FEE_5_150)
            .add(EXPECTED_ROUND_3_ACC_FEE)
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 3,
            latestId: 3,
            protocolFee: totalFee.mul(8).div(10).sub(1), // 1-sec invalid delay
            oracleFee: totalFee.div(10).sub(1).add(EXPECTED_SETTLEMENT_FEE.mul(2)), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision  / 1-sec invalid delay
            latestPrice: parse6decimal('150'),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_6.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            shortNeg: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            },
            longPreValue: { _value: 0 },
            shortPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            price: oracleVersionLowerPrice.price,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                .add(EXPECTED_PNL)
                .div(10)
                .sub(2), // loss of precision
            },
            longPreValue: { _value: 0 },
            shortPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                .add(EXPECTED_INTEREST_5_150)
                .add(EXPECTED_PNL)
                .div(5)
                .mul(-1),
            },
            price: oracleVersionLowerPrice.price,
            settlementFee: { _value: parse6decimal('-1') },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_150)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_150)
                .add(EXPECTED_ROUND_3_ACC_WITHOUT_FEE)
                .div(10)
                .sub(3)
                .sub(1), // loss of precision / 1-sec invalid delay
            },
            longPreValue: { _value: 0 },
            shortPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                .add(EXPECTED_FUNDING_WITH_FEE_2_5_150)
                .add(EXPECTED_INTEREST_5_150)
                .add(EXPECTED_ROUND_3_ACC)
                .div(5)
                .mul(-1),
            },
            price: PRICE,
            settlementFee: { _value: parse6decimal('-1') },
            liquidationFee: { _value: parse6decimal('-10') },
          })

          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          await expect(market.connect(liquidator).claimFee(liquidator.address))
            .to.emit(market, 'FeeClaimed')
            .withArgs(liquidator.address, liquidator.address, EXPECTED_LIQUIDATION_FEE)

          expectLocalEq(await market.locals(liquidator.address), DEFAULT_LOCAL)
        })
      })

      context('liquidation w/ self liquidator', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              parse6decimal('216'),
              false,
            )
        })

        it('still credits the liquidation fee to claimable', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('27').mul(5)
          const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('10')

          const oracleVersionLowerPrice = {
            price: parse6decimal('96'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice.timestamp)
            .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, true)

          oracle.at
            .whenCalledWith(ORACLE_VERSION_4.timestamp)
            .returns([ORACLE_VERSION_4, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: EXPECTED_SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const oracleVersionLowerPrice2 = {
            price: parse6decimal('96'),
            timestamp: TIMESTAMP + 14400,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice2.timestamp)
            .returns([oracleVersionLowerPrice2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice2, oracleVersionLowerPrice2.timestamp + 3600])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 2,
            collateral: parse6decimal('216')
              .sub(EXPECTED_SETTLEMENT_FEE)
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
              .sub(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
              .sub(EXPECTED_LIQUIDATION_FEE),
            claimable: EXPECTED_LIQUIDATION_FEE,
          })
          expect(await market.liquidators(user.address, 2)).to.equal(user.address)
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
            protection: 1,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_6.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
              .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
              .sub(20), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
            EXPECTED_FUNDING_FEE_2_5_96.add(EXPECTED_INTEREST_FEE_5_96),
          )
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 2,
            protocolFee: totalFee.mul(8).div(10).sub(3), // loss of precision
            oracleFee: totalFee.div(10).sub(2).add(EXPECTED_SETTLEMENT_FEE), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision
            latestPrice: parse6decimal('96'),
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_PNL)
                .div(10),
            }, // loss of precision
            longPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
            },
            shortPreValue: { _value: 0 },
            price: oracleVersionLowerPrice.price,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                .div(10)
                .sub(2),
            }, // loss of precision
            longPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                .div(5)
                .mul(-1),
            },
            shortPreValue: { _value: 0 },
            price: PRICE,
            settlementFee: { _value: parse6decimal('-1') },
            liquidationFee: { _value: parse6decimal('-10') },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_2_5_96.add(EXPECTED_INTEREST_WITHOUT_FEE_5_96))
                .div(10)
                .sub(2),
            }, // loss of precision
            longPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123)
                .add(EXPECTED_FUNDING_WITH_FEE_2_5_96.add(EXPECTED_INTEREST_5_96))
                .div(5)
                .mul(-1),
            },
            shortPreValue: { _value: 0 },
            price: oracleVersionLowerPrice2.price,
          })
        })
      })

      context('liquidation w/ referrer', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              parse6decimal('216'),
              false,
            )
        })

        it('sets related accounts', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_PNL = parse6decimal('80').mul(5)
          const EXPECTED_SETTLEMENT_FEE = parse6decimal('1')
          const EXPECTED_LIQUIDATION_FEE = parse6decimal('50')

          const oracleVersionLowerPrice = {
            price: parse6decimal('43'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice.timestamp)
            .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          factory.authorization
            .whenCalledWith(user.address, liquidator.address, constants.AddressZero, userB.address)
            .returns([true, false, parse6decimal('0.20')])

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await market
            .connect(liquidator)
            ['update(address,uint256,uint256,uint256,int256,bool,address)'](
              user.address,
              0,
              0,
              0,
              0,
              true,
              userB.address,
            )

          expect((await market.locals(user.address)).currentId).to.equal(2)
          expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
          expect(await market.orderReferrers(user.address, 2)).to.equal(userB.address)
        })

        it('resets related accounts on update', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          const EXPECTED_LIQUIDATION_FEE = parse6decimal('50') // 6.45 -> under minimum

          const oracleVersionLowerPrice = {
            price: parse6decimal('43'),
            timestamp: TIMESTAMP + 7200,
            valid: true,
          }
          oracle.at
            .whenCalledWith(oracleVersionLowerPrice.timestamp)
            .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          factory.authorization
            .whenCalledWith(user.address, liquidator.address, constants.AddressZero, userB.address)
            .returns([true, false, parse6decimal('0.20')])

          await settle(market, userB)
          dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
          dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

          await market
            .connect(liquidator)
            ['update(address,uint256,uint256,uint256,int256,bool,address)'](
              user.address,
              0,
              0,
              0,
              0,
              true,
              userB.address,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
          expect(await market.orderReferrers(user.address, 2)).to.equal(userB.address)

          dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('1000')).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(5),
              0,
              parse6decimal('1000'),
              false,
            )
          await settle(market, user)

          expect((await market.locals(user.address)).currentId).to.equal(3)
          expect(await market.liquidators(user.address, 3)).to.equal(constants.AddressZero)
          expect(await market.orderReferrers(user.address, 3)).to.equal(constants.AddressZero)
        })

        it('reverts when paused', async () => {
          factory.paused.returns(true)

          await expect(
            market.connect(user)['update(address,int256,int256,address)'](user.address, 0, COLLATERAL, userB.address),
          ).to.revertedWithCustomError(market, 'InstancePausedError')

          factory.paused.reset()
        })
      })

      context('invalid oracle version', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        })

        it('settles the position w/o change', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          await updateSynBook(market, DEFAULT_SYN_BOOK)

          const TAKER_FEE = parse6decimal('9.84') // position * (0.01 + 0.002 + 0.004) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([
            { ...ORACLE_VERSION_3, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE },
          ])
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 2,
            oracleFee: SETTLEMENT_FEE,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
        })

        it('settles valid version after', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          await updateSynBook(market, DEFAULT_SYN_BOOK)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const PRICE_IMPACT = parse6decimal('3.28') // skew 0 -> 0.5, price 123, position 5
          const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([
            { ...ORACLE_VERSION_3, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE },
          ])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp + 1)
            .returns([{ ...ORACLE_VERSION_3, timestamp: ORACLE_VERSION_3.timestamp + 1 }, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([
            { ...ORACLE_VERSION_3, timestamp: ORACLE_VERSION_3.timestamp + 1 },
            ORACLE_VERSION_4.timestamp,
          ])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longPos: POSITION.div(2) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at
            .whenCalledWith(ORACLE_VERSION_4.timestamp)
            .returns([{ ...ORACLE_VERSION_4 }, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 2,
            collateral: COLLATERAL.sub(PRICE_IMPACT).sub(TAKER_FEE).sub(SETTLEMENT_FEE.mul(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            tradeFee: PRICE_IMPACT.add(TAKER_FEE),
            settlementFee: SETTLEMENT_FEE,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(PRICE_IMPACT),
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          const totalFee = TAKER_FEE
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 3,
            latestId: 3,
            protocolFee: totalFee.mul(8).div(10).add(1), // loss of precision
            oracleFee: totalFee.div(10).add(SETTLEMENT_FEE.mul(2)), // loss of precision
            riskFee: totalFee.div(10).sub(1), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerCloseValue: { _value: PRICE_IMPACT.div(10) },
            spreadPos: { _value: -PRICE_IMPACT.div(5) },
            takerFee: { _value: -TAKER_FEE.div(5) },
            settlementFee: { _value: -SETTLEMENT_FEE },
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })

        it('settles invalid version after', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          await updateSynBook(market, DEFAULT_SYN_BOOK)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([
            { ...ORACLE_VERSION_3, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE },
          ])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp + 1)
            .returns([{ ...ORACLE_VERSION_3, timestamp: ORACLE_VERSION_3.timestamp + 1 }, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([
            { ...ORACLE_VERSION_3, timestamp: ORACLE_VERSION_3.timestamp + 1 },
            ORACLE_VERSION_4.timestamp,
          ])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp, orders: 1, longPos: POSITION.div(2) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([
            { ...ORACLE_VERSION_4, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE },
          ])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_4.timestamp + 1)
            .returns([{ ...ORACLE_VERSION_4, timestamp: ORACLE_VERSION_4.timestamp + 1 }, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([
            { ...ORACLE_VERSION_4, timestamp: ORACLE_VERSION_4.timestamp + 1 },
            ORACLE_VERSION_5.timestamp,
          ])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 2,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE.mul(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp + 1,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
            settlementFee: SETTLEMENT_FEE,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp + 1,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 3,
            latestId: 3,
            oracleFee: SETTLEMENT_FEE.mul(2),
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp + 1,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
        })

        it('settles invalid then valid version at once', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          await updateSynBook(market, DEFAULT_SYN_BOOK)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.status.returns([{ ...ORACLE_VERSION_2 }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([
            { ...ORACLE_VERSION_3, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE },
          ])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_4.timestamp)
            .returns([{ ...ORACLE_VERSION_4 }, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 2,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE), // does not charge fee if both were pending at once
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 3,
            latestId: 3,
            oracleFee: SETTLEMENT_FEE,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })

        it('settles invalid then valid version at once then valid', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          await updateSynBook(market, DEFAULT_SYN_BOOK)

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const PRICE_IMPACT = parse6decimal('3.28') // skew 0 -> 0.5, price 123, position 5
          const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_3.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.status.returns([{ ...ORACLE_VERSION_2 }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_4.timestamp },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([
            { ...ORACLE_VERSION_3, valid: false },
            { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE },
          ])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_4.timestamp)
            .returns([{ ...ORACLE_VERSION_4 }, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([{ ...ORACLE_VERSION_4 }, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION.div(2), 0, 0, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_5.timestamp, orders: 1, longPos: POSITION.div(2) },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at
            .whenCalledWith(ORACLE_VERSION_5.timestamp)
            .returns([{ ...ORACLE_VERSION_5 }, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([{ ...ORACLE_VERSION_5 }, ORACLE_VERSION_6.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 3,
            latestId: 3,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE.mul(2)).sub(PRICE_IMPACT).sub(TAKER_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_CHECKPOINT,
            settlementFee: SETTLEMENT_FEE,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectOrderEq(await market.pendingOrders(user.address, 3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
            tradeFee: PRICE_IMPACT.add(TAKER_FEE),
            settlementFee: SETTLEMENT_FEE,
            collateral: COLLATERAL.sub(SETTLEMENT_FEE),
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(PRICE_IMPACT),
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
            transfer: COLLATERAL,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_6.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = TAKER_FEE
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 4,
            latestId: 4,
            protocolFee: totalFee.mul(8).div(10).add(1), // loss of precision
            oracleFee: totalFee.div(10).add(SETTLEMENT_FEE.mul(2)),
            riskFee: totalFee.div(10).sub(1), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_5.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            longPos: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(3), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrder(4), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_5.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            settlementFee: { _value: -SETTLEMENT_FEE },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_VERSION,
            makerCloseValue: { _value: PRICE_IMPACT.div(10) },
            spreadPos: { _value: -PRICE_IMPACT.div(5) },
            takerFee: { _value: -TAKER_FEE.div(5) },
            settlementFee: { _value: -SETTLEMENT_FEE },
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            price: PRICE,
          })
        })

        it('settles invalid w/ exposure', async () => {
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp)
            .returns([{ ...ORACLE_VERSION_3, valid: false }, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([{ ...ORACLE_VERSION_3, valid: false }, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
            oracleFee: totalFee.div(10).sub(1), // loss of precision
            riskFee: totalFee.div(10).sub(1), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 2,
            makerPos: POSITION,
            longPos: POSITION.div(2),
            collateral: COLLATERAL.mul(2),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            valid: false,
            price: PRICE,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
            },
            longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
            shortPreValue: { _value: 0 },
          })
        })
      })

      context('skew flip', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              user.address,
              0,
              POSITION.div(2),
              0,
              COLLATERAL,
              false,
            )
        })

        it('doesnt flip funding default', async () => {
          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)
          await settle(market, userC)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 2,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(16), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userC.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(userC.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            shortPos: POSITION.div(2),
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_1_5_123)
            .add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 2,
            protocolFee: totalFee.mul(8).div(10).sub(5), // loss of precision
            oracleFee: totalFee.div(10).sub(2), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 2,
            longNeg: POSITION.div(2),
            shortPos: POSITION.div(2),
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .div(10)
                .sub(1), // loss of precision
            },
            longPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
            },
            shortPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.sub(EXPECTED_INTEREST_5_123).div(5),
            },
            price: PRICE,
          })
        })

        it('flips funding when makerReceiveOnly', async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          riskParameter.makerReceiveOnly = true
          await market.updateRiskParameter(riskParameter)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userC.address,
              0,
              0,
              POSITION.div(2),
              COLLATERAL,
              false,
            )

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])

          oracle.at.whenCalledWith(ORACLE_VERSION_4.timestamp).returns([ORACLE_VERSION_4, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_4, ORACLE_VERSION_5.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)
          await settle(market, userC)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 2,
            latestId: 2,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            longNeg: POSITION.div(2),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(16), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userC.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123).sub(EXPECTED_INTEREST_5_123),
          })
          expectPositionEq(await market.positions(userC.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 1,
            shortPos: POSITION.div(2),
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_5.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
            .add(EXPECTED_FUNDING_FEE_1_5_123)
            .add(EXPECTED_INTEREST_FEE_5_123)
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 2,
            latestId: 2,
            protocolFee: totalFee.mul(8).div(10).sub(5), // loss of precision
            oracleFee: totalFee.div(10).sub(2), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_4.timestamp,
            maker: POSITION,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(2), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_3.timestamp,
            orders: 2,
            longNeg: POSITION.div(2),
            shortPos: POSITION.div(2),
            collateral: COLLATERAL,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .div(10)
                .sub(1), // loss of precision
            },
            longPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
            },
            shortPreValue: {
              _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
            },
            price: PRICE,
          })
        })
      })

      context('operator', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(operator.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('opens the position when operator', async () => {
          factory.authorization
            .whenCalledWith(user.address, operator.address, constants.AddressZero, constants.AddressZero)
            .returns([true, false, BigNumber.from(0)])

          await expect(
            market
              .connect(operator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 0,
            collateral: COLLATERAL,
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_2.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_1.timestamp,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            collateral: COLLATERAL,
            makerPos: POSITION,
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_1.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
          })
        })

        it('reverts when not operator', async () => {
          factory.authorization
            .whenCalledWith(user.address, operator.address, constants.AddressZero, constants.AddressZero)
            .returns([false, false, BigNumber.from(0)])

          await expect(
            market
              .connect(operator)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')
        })
      })

      context('signer', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('opens the position when signer', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          await updateSynBook(market, DEFAULT_SYN_BOOK)

          const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
          const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          const intent: IntentStruct = {
            amount: POSITION.div(2),
            price: parse6decimal('125'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: liquidator.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          // maker
          factory.authorization
            .whenCalledWith(userC.address, userC.address, constants.AddressZero, liquidator.address)
            .returns([true, false, parse6decimal('0.20')])
          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, liquidator.address, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                takerReferral: POSITION.div(2).mul(2).div(10),
              },
              {
                ...DEFAULT_GUARANTEE,
                orders: 1,
                longPos: POSITION.div(2),
                notional: POSITION.div(2).mul(125),
                takerFee: 0,
                referral: POSITION.div(2).div(10),
              },
              constants.AddressZero,
              liquidator.address, // originator
              owner.address, // solver
            )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              userC.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                shortPos: POSITION.div(2),
              },
              {
                ...DEFAULT_GUARANTEE,
                orders: 0,
                shortPos: POSITION.div(2),
                notional: -POSITION.div(2).mul(125),
                takerFee: POSITION.div(2),
                referral: 0,
              },
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
            )

          // update position with incorrect guarantee referrer
          intent.solver = liquidator.address

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.revertedWithCustomError(market, 'MarketInvalidReferrerError')

          oracle.at
            .whenCalledWith(ORACLE_VERSION_2.timestamp)
            .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp)
            .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)
          await settle(market, userC)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2)).sub(EXPECTED_PNL).sub(TAKER_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
            collateral: COLLATERAL,
            takerReferral: POSITION.div(2).mul(2).div(10),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF).sub(SETTLEMENT_FEE.div(2)).sub(4), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userC.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2))
              .add(EXPECTED_PNL)
              .sub(SETTLEMENT_FEE.div(2)),
          })
          expectPositionEq(await market.positions(userC.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(userC.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            shortPos: POSITION.div(2),
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            claimable: TAKER_FEE.mul(2).div(10).div(2),
          })
          expectLocalEq(await market.locals(owner.address), {
            ...DEFAULT_LOCAL,
            claimable: TAKER_FEE.mul(2).div(10).div(2),
          })
          const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)))
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
            oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
            riskFee: totalFee.div(10).sub(1), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
            short: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 3,
            makerPos: POSITION,
            shortPos: POSITION.div(2),
            longPos: POSITION.div(2),
            takerReferral: POSITION.div(2).mul(2).div(10),
            collateral: COLLATERAL.mul(3),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
            },
            longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
            shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })

        it('reverts when not operator', async () => {
          const intent: IntentStruct = {
            amount: POSITION.div(2),
            price: parse6decimal('125'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: owner.address,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: liquidator.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          // maker
          factory.authorization
            .whenCalledWith(userC.address, userC.address, constants.AddressZero, liquidator.address)
            .returns([true, false, parse6decimal('0.20')])
          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, liquidator.address, liquidator.address)
            .returns([false, false, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')
        })
      })

      context('funding skew', async () => {
        // rate_0 = 0
        // rate_1 = rate_0 + (elapsed * skew / k)
        // funding = (rate_0 + rate_1) / 2 * elapsed * taker * price / time_in_years
        // (0 + (0 + 3600 * 0.333333 / 40000)) / 2 * 3600 * 5 * 123 / (86400 * 365) = 1053
        const EXPECTED_FUNDING_1_5_123_V = BigNumber.from(1055)
        const EXPECTED_FUNDING_FEE_1_5_123_V = BigNumber.from(105)
        const EXPECTED_FUNDING_WITH_FEE_1_5_123_V = EXPECTED_FUNDING_1_5_123_V.add(55)
        const EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V = EXPECTED_FUNDING_1_5_123_V.sub(50)

        beforeEach(async () => {
          const riskParameter = { ...(await market.riskParameter()) }
          const riskParameterSynBook = { ...riskParameter.synBook }
          riskParameterSynBook.scale = parse6decimal('15')
          riskParameter.synBook = riskParameterSynBook
          await market.updateRiskParameter(riskParameter)

          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('long', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('correctly dampens the funding rate increase', async () => {
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123_V).sub(EXPECTED_INTEREST_5_123),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123_V.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
              oracleFee: totalFee.div(10),
              riskFee: totalFee.div(10),
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10).sub(1), // loss of precision
              },
              longPreValue: {
                _value: EXPECTED_FUNDING_WITH_FEE_1_5_123_V.add(EXPECTED_INTEREST_5_123).div(5).mul(-1),
              },
              shortPreValue: { _value: 0 },
              price: PRICE,
            })
          })

          it('correctly stores large skew', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            riskParameter.makerLimit = parse6decimal('10')
            const riskParameterSynBook = { ...riskParameter.synBook }
            riskParameterSynBook.scale = parse6decimal('1')
            riskParameter.synBook = riskParameterSynBook
            await market.updateRiskParameter(riskParameter)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, 0, false),
            ).to.not.reverted
          })
        })

        context('short', async () => {
          beforeEach(async () => {
            dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
          })

          it('correctly dampens the funding rate decrease', async () => {
            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123_V).sub(EXPECTED_INTEREST_5_123).add(5), // excess fundingFee taken from long
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V)
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const totalFee = EXPECTED_FUNDING_FEE_1_5_123_V.add(EXPECTED_INTEREST_FEE_5_123)
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
              oracleFee: totalFee.div(10),
              riskFee: totalFee.div(10),
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL.mul(2),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123_V.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10).sub(1), // loss of precision
              },
              longPreValue: { _value: 0 },
              shortPreValue: {
                _value: EXPECTED_FUNDING_WITH_FEE_1_5_123_V.add(EXPECTED_INTEREST_5_123).div(5).mul(-1).add(1), // loss of precision (fundingFee)
              },
              price: PRICE,
            })
          })

          it('correctly stores large skew', async () => {
            const riskParameter = { ...(await market.riskParameter()) }
            riskParameter.makerLimit = parse6decimal('10')
            const riskParameterSynBook = { ...riskParameter.synBook }
            riskParameterSynBook.scale = parse6decimal('1')
            riskParameter.synBook = riskParameterSynBook
            await market.updateRiskParameter(riskParameter)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false)

            oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await expect(
              market
                .connect(user)
                ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
            ).to.not.reverted
          })
        })
      })

      context('invalidation', async () => {
        it('multiple invalidations in a row without settlement', async () => {
          const positionMaker = parse6decimal('2.000')
          const collateral = parse6decimal('1000')

          const oracleVersion = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion.timestamp).returns([oracleVersion, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersion, oracleVersion.timestamp + 100])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              positionMaker,
              0,
              0,
              collateral,
              false,
            )

          // Increase current version so multiple pending positions are unsettled
          oracle.status.returns([oracleVersion, oracleVersion.timestamp + 200])
          dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              positionMaker,
              0,
              0,
              collateral,
              false,
            )

          // Fulfill oracle version 2 (invalid)
          const oracleVersion2 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 100,
            valid: false,
          }
          oracle.at.whenCalledWith(oracleVersion2.timestamp).returns([oracleVersion2, INITIALIZED_ORACLE_RECEIPT])

          // Fulfill oracle version 3 (invalid)
          const oracleVersion3 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 200,
            valid: false,
          }
          oracle.at.whenCalledWith(oracleVersion3.timestamp).returns([oracleVersion3, INITIALIZED_ORACLE_RECEIPT])

          // next oracle version is valid
          const oracleVersion4 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 300,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion4.timestamp).returns([oracleVersion4, INITIALIZED_ORACLE_RECEIPT])

          // oracleVersion4 commited
          oracle.status.returns([oracleVersion4, oracleVersion4.timestamp + 100])
          oracle.request.returns()

          // settle
          await expect(
            market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, positionMaker, 0, 0, 0, false),
          ).to.not.be.reverted
        })

        it('global-local desync', async () => {
          const positionMaker = parse6decimal('2.000')
          const positionLong = parse6decimal('1.000')
          const collateral = parse6decimal('1000')

          const oracleVersion = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion.timestamp).returns([oracleVersion, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersion, oracleVersion.timestamp + 100])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(userB.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](
              userB.address,
              positionMaker,
              0,
              0,
              collateral,
              false,
            )

          const oracleVersion2 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 100,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion2.timestamp).returns([oracleVersion2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersion2, oracleVersion2.timestamp + 100])
          oracle.request.returns()

          dsu.transferFrom.whenCalledWith(user.address, market.address, collateral.mul(1e12)).returns(true)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, positionLong, 0, collateral, false)

          const collateralBefore = (await market.locals(user.address)).collateral
          const collateralBeforeB = (await market.locals(userB.address)).collateral

          // invalid oracle version
          const oracleVersion3 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 200,
            valid: false,
          }
          oracle.at.whenCalledWith(oracleVersion3.timestamp).returns([oracleVersion3, INITIALIZED_ORACLE_RECEIPT])

          // next oracle version is valid
          const oracleVersion4 = {
            price: parse6decimal('100'),
            timestamp: TIMESTAMP + 300,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion4.timestamp).returns([oracleVersion4, INITIALIZED_ORACLE_RECEIPT])

          // still returns oracleVersion2, because nothing commited for version 3, and version 4 time has passed but not yet commited
          oracle.status.returns([oracleVersion2, oracleVersion4.timestamp + 100])
          oracle.request.returns()

          // reset to 0
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, positionLong, 0, 0, false)

          // oracleVersion4 commited
          oracle.status.returns([oracleVersion4, oracleVersion4.timestamp + 100])
          oracle.request.returns()

          // settle
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, positionMaker, 0, 0, 0, false)

          const oracleVersion5 = {
            price: parse6decimal('90'),
            timestamp: TIMESTAMP + 400,
            valid: true,
          }
          oracle.at.whenCalledWith(oracleVersion5.timestamp).returns([oracleVersion5, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([oracleVersion5, oracleVersion5.timestamp + 100])
          oracle.request.returns()

          // settle
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, positionMaker, 0, 0, 0, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)

          expect((await market.locals(user.address)).collateral).to.equal(collateralBefore)
          expect((await market.locals(userB.address)).collateral).to.equal(collateralBeforeB)
        })
      })

      context('single sided', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('cant switch current before settlement', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketOverCloseError')
        })

        it('cant switch current after latest settles', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')
        })

        it('can switch current after reset settles', async () => {
          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, POSITION, 0, COLLATERAL, false)

          oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, 0, false)
          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.be.revertedWithCustomError(market, 'MarketNotSingleSidedError')

          oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, POSITION, 0, false),
          ).to.not.be.reverted
        })
      })

      context('subtractive fee', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('opens the position and settles later with fee (maker)', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const riskParameter = { ...(await market.riskParameter()) }
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.fundingFee = BigNumber.from(0)
          marketParameter.makerFee = parse6decimal('0.005')
          await market.updateParameter(marketParameter)

          const MAKER_FEE = parse6decimal('6.15') // position * (0.005) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          factory.authorization
            .whenCalledWith(user.address, user.address, constants.AddressZero, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool,address)'](
                user.address,
                POSITION,
                0,
                0,
                COLLATERAL,
                false,
                liquidator.address,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                makerPos: POSITION,
                collateral: COLLATERAL,
                makerReferral: POSITION.div(5),
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              liquidator.address,
              constants.AddressZero,
            )

          oracle.at
            .whenCalledWith(ORACLE_VERSION_2.timestamp)
            .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp)
            .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(MAKER_FEE).sub(SETTLEMENT_FEE),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
            makerReferral: POSITION.div(5),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            claimable: MAKER_FEE.mul(2).div(10),
          })
          const totalFee = MAKER_FEE.sub(MAKER_FEE.mul(2).div(10))
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).add(1), // loss of precision
            oracleFee: totalFee.div(10).add(SETTLEMENT_FEE),
            riskFee: totalFee.div(10).sub(1), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
            makerReferral: POSITION.div(5),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })

        it('opens the position and settles later with fee (taker)', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const riskParameter = { ...(await market.riskParameter()) }
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          factory.authorization
            .whenCalledWith(user.address, user.address, constants.AddressZero, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool,address)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
                liquidator.address,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
                takerReferral: POSITION.div(10),
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              liquidator.address,
              constants.AddressZero,
            )

          oracle.at
            .whenCalledWith(ORACLE_VERSION_2.timestamp)
            .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp)
            .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(TAKER_FEE)
              .sub(SETTLEMENT_FEE.div(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
            collateral: COLLATERAL,
            takerReferral: POSITION.div(10),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(SETTLEMENT_FEE.div(2))
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            claimable: TAKER_FEE.mul(2).div(10),
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
            TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)),
          )
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
            oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 2,
            makerPos: POSITION,
            longPos: POSITION.div(2),
            collateral: COLLATERAL.mul(2),
            takerReferral: POSITION.div(10),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
            },
            longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })

        it('opens the position and settles later with fee (self)', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const riskParameter = { ...(await market.riskParameter()) }
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          factory.authorization
            .whenCalledWith(user.address, user.address, constants.AddressZero, user.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool,address)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
                user.address,
              ),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
                takerReferral: POSITION.div(10),
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              user.address,
              constants.AddressZero,
            )

          oracle.at
            .whenCalledWith(ORACLE_VERSION_2.timestamp)
            .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp)
            .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(TAKER_FEE)
              .sub(SETTLEMENT_FEE.div(2)),
            claimable: TAKER_FEE.mul(2).div(10),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
            collateral: COLLATERAL,
            takerReferral: POSITION.div(10),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(SETTLEMENT_FEE.div(2))
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
            TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)),
          )
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
            oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 2,
            makerPos: POSITION,
            longPos: POSITION.div(2),
            collateral: COLLATERAL.mul(2),
            takerReferral: POSITION.div(10),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
            },
            longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })
      })

      context('intent orders', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userD.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        context('opens position', async () => {
          it('fills the positions and settles later with fee (above / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )
            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2)).sub(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF).sub(SETTLEMENT_FEE.div(2)).sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2))
                .add(EXPECTED_PNL)
                .sub(SETTLEMENT_FEE.div(2)),
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)))
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (above / short)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: -POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2)).add(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF).sub(SETTLEMENT_FEE.div(2)).sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2))
                .sub(EXPECTED_PNL)
                .sub(SETTLEMENT_FEE.div(2)),
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)))
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (below / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('121'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(121),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(121),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2)).add(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF).sub(SETTLEMENT_FEE.div(2)).sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2))
                .sub(EXPECTED_PNL)
                .sub(SETTLEMENT_FEE.div(2)),
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)))
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (below / short)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: -POSITION.div(2),
              price: parse6decimal('121'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(121),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(121),
                  takerFee: POSITION.div(2),
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2)).sub(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF).sub(SETTLEMENT_FEE.div(2)).sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2))
                .add(EXPECTED_PNL)
                .sub(SETTLEMENT_FEE.div(2)),
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)))
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              longPos: POSITION.div(2),
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills multiple positions and settles later with fee', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent1 = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            const intent2 = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: owner.address,
              solver: liquidator.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: userD.address,
                signer: userD.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userD)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userD.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // taker 1
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])
            // taker 2
            factory.authorization
              .whenCalledWith(userD.address, userC.address, userD.address, owner.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent1, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent2, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userD.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                owner.address, // originator
                liquidator.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)
            await settle(market, userD)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF_2.div(4)).sub(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userD.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF_2.div(4)).sub(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(userD.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userD.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userD.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF_2).sub(SETTLEMENT_FEE.div(3)).sub(7), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF_2.div(2))
                .add(EXPECTED_PNL.mul(2))
                .sub(SETTLEMENT_FEE.mul(2).div(3))
                .sub(11), // loss of precision
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 2,
              shortPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10), // solver + originator
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10), // solver + originator
            })
            const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF_2.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)).mul(2))
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(2), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION,
              short: POSITION,
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 5,
              makerPos: POSITION,
              shortPos: POSITION,
              longPos: POSITION,
              takerReferral: POSITION.div(2).mul(2).div(10).mul(2),
              collateral: COLLATERAL.mul(4),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF_2.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF_2.div(2).div(10).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF_2.div(2).div(10).mul(-1).sub(1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later (operator)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // maker
            factory.authorization
              .whenCalledWith(userC.address, userD.address, constants.AddressZero, constants.AddressZero) // userD is operator of userC
              .returns([true, false, BigNumber.from(0)])
            // taker
            factory.authorization
              .whenCalledWith(user.address, userD.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userD)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )
            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2)).sub(EXPECTED_PNL).sub(TAKER_FEE),
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF).sub(SETTLEMENT_FEE.div(2)).sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(EXPECTED_INTEREST_10_123_EFF.div(2))
                .add(EXPECTED_PNL)
                .sub(SETTLEMENT_FEE.div(2)),
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_10_123_EFF.add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)))
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 1,
              latestId: 1,
              protocolFee: totalFee.mul(8).div(10).add(3), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE), // loss of precision
              riskFee: totalFee.div(10).sub(1), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 3,
              makerPos: POSITION,
              shortPos: POSITION.div(2),
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL.mul(3),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills two positions and settles later with fee (above / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('1000'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )
            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)
          })

          it('opens long position and fills another long position and settles later with fee (above / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('1000'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            // since long + maker are settled in the same version, skew starts at 0 and long is fully socialized at open
            const PRICE_IMPACT = parse6decimal('59.86') // skew 0.0->2.0, price 123, position 10

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userB.address,
                POSITION.mul(2),
                0,
                0,
                COLLATERAL,
                false,
              )

            await market
              .connect(userD)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userD.address, 0, POSITION, 0, COLLATERAL, false)

            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            verifier.verifyIntent.returns()

            await updateSynBook(market, DEFAULT_SYN_BOOK)

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_2.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )
            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)
            await settle(market, userD)

            // rate * elapsed * utilization * min(maker, taker) * price
            // (0.28 / 365 / 24 / 60 / 60 ) * 3600 * 30 * 123 = 78630
            const expectedInterest = BigNumber.from(78630)
            const expectedLongInterest = expectedInterest.mul(3).div(4)
            const expectedFundingFee = BigNumber.from(3320)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(expectedLongInterest.div(3))
                .sub(expectedFundingFee)
                .sub(EXPECTED_PNL)
                .sub(TAKER_FEE)
                .add(PRICE_IMPACT.div(3))
                .sub(6), // loss of precision
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })

            const expectedInterestWithoutFee = expectedInterest.mul(9).div(10)
            const expectedMakerFundingFee = BigNumber.from(6002)
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.add(expectedInterestWithoutFee)
                .add(expectedMakerFundingFee)
                .sub(SETTLEMENT_FEE.div(3))
                .sub(PRICE_IMPACT)
                .sub(10), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION.mul(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            const expectedShortFundingFee = BigNumber.from(3002)
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(expectedInterest.div(4))
                .add(expectedShortFundingFee)
                .add(EXPECTED_PNL)
                .sub(SETTLEMENT_FEE.div(3))
                .sub(6),
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userD.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(expectedLongInterest.mul(2).div(3))
                .sub(expectedFundingFee.mul(2))
                .sub(TAKER_FEE.mul(2))
                .sub(SETTLEMENT_FEE.div(3))
                .add(PRICE_IMPACT.mul(2).div(3))
                .sub(13), // loss of precision
            })
            expectPositionEq(await market.positions(userD.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userD.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              longPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userD.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })

            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION.mul(2),
              long: POSITION.mul(3).div(2),
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 4,
              makerPos: POSITION.mul(2),
              shortPos: POSITION.div(2),
              longPos: POSITION.mul(3).div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
              collateral: COLLATERAL.mul(4),
            })
          })
        })

        context('closes position', async () => {
          it('fills the positions and settles later with fee (taker / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: -POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longNeg: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(TAKER_FEE)
                .sub(SETTLEMENT_FEE.div(2)) // open
                .sub(EXPECTED_INTEREST_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123) // while open
                .add(EXPECTED_PNL)
                .sub(TAKER_FEE), // close
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              longNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(2)) // open
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123) // while open
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE).sub(EXPECTED_PNL), // open
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_5_123.add(EXPECTED_FUNDING_FEE_1_5_123)
              .add(TAKER_FEE) // setup
              .add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10))) // fill
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
              oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE.mul(2)), // loss of precision
              riskFee: totalFee.div(10).sub(2), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 2,
              longNeg: POSITION.div(2),
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_5_123.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).div(5).mul(-1) },
              takerFee: { _value: -TAKER_FEE.div(5) },
              settlementFee: { _value: -SETTLEMENT_FEE },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (taker / short)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(TAKER_FEE)
                .sub(SETTLEMENT_FEE.div(2)) // open
                .sub(EXPECTED_INTEREST_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123) // while open
                .sub(EXPECTED_PNL)
                .sub(TAKER_FEE), // close
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              shortNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(2)) // open
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123) // while open
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE).add(EXPECTED_PNL), // open
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(userC.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_5_123.add(EXPECTED_FUNDING_FEE_1_5_123)
              .add(TAKER_FEE) // setup
              .add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10))) // fill
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
              oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE.mul(2)), // loss of precision
              riskFee: totalFee.div(10).sub(2), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 2,
              shortNeg: POSITION.div(2),
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).div(10),
              },
              shortPreValue: { _value: EXPECTED_INTEREST_5_123.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).div(5).mul(-1) },
              takerFee: { _value: -TAKER_FEE.div(5) },
              settlementFee: { _value: -SETTLEMENT_FEE },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (maker / short)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: -POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userC.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortPos: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortNeg: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.add(EXPECTED_PNL) // open
                .sub(TAKER_FEE), // close
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              shortPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(2)) // open
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123) // while open
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(TAKER_FEE)
                .sub(SETTLEMENT_FEE.div(2)) // open
                .sub(EXPECTED_INTEREST_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123) // while open
                .sub(SETTLEMENT_FEE)
                .sub(EXPECTED_PNL), // close
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(userC.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              shortNeg: POSITION.div(2),
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_5_123.add(EXPECTED_FUNDING_FEE_1_5_123)
              .add(TAKER_FEE) // setup
              .add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10))) // fill
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
              oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE.mul(2)), // loss of precision
              riskFee: totalFee.div(10).sub(2), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              short: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 2,
              shortPos: POSITION.div(2),
              shortNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).div(10),
              },
              shortPreValue: { _value: EXPECTED_INTEREST_5_123.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).div(5).mul(-1) },
              takerFee: { _value: -TAKER_FEE.div(5) },
              settlementFee: { _value: -SETTLEMENT_FEE },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (maker / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userC.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longPos: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longPos: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  longNeg: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(EXPECTED_PNL) // open
                .sub(TAKER_FEE), // close
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              longPos: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(2)) // open
                .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
                .add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123) // while open
                .sub(8), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(TAKER_FEE)
                .sub(SETTLEMENT_FEE.div(2)) // open
                .sub(EXPECTED_INTEREST_5_123)
                .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123) // while open
                .sub(SETTLEMENT_FEE)
                .add(EXPECTED_PNL), // close
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(userC.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              longNeg: POSITION.div(2),
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = EXPECTED_INTEREST_FEE_5_123.add(EXPECTED_FUNDING_FEE_1_5_123)
              .add(TAKER_FEE) // setup
              .add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10))) // fill
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
              oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE.mul(2)), // loss of precision
              riskFee: totalFee.div(10).sub(2), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
              long: POSITION.div(2),
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 2,
              longPos: POSITION.div(2),
              longNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_5_123.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123).div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_5_123.add(EXPECTED_FUNDING_WITH_FEE_1_5_123).div(5).mul(-1) },
              takerFee: { _value: -TAKER_FEE.div(5) },
              settlementFee: { _value: -SETTLEMENT_FEE },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (both / long)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: -POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userC.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  longNeg: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortNeg: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(TAKER_FEE)
                .sub(SETTLEMENT_FEE.div(3).add(1)) // open
                .sub(EXPECTED_INTEREST_10_123_EFF.div(2)) // while open
                .add(EXPECTED_PNL)
                .sub(TAKER_FEE), // close
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              longNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(3).add(1)) // open
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF) // while open
                .sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(3).add(1))
                .sub(TAKER_FEE) // open
                .sub(EXPECTED_INTEREST_10_123_EFF.div(2)) // while open
                .sub(SETTLEMENT_FEE)
                .sub(EXPECTED_PNL), // close
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(userC.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              shortNeg: POSITION.div(2),
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = TAKER_FEE.mul(2) // setup
              .add(EXPECTED_INTEREST_FEE_10_123_EFF) // while open
              .add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10))) // fill
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).add(4), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE.mul(2)), // loss of precision
              riskFee: totalFee.div(10).sub(2), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 2,
              longNeg: POSITION.div(2),
              shortNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              takerFee: { _value: -TAKER_FEE.div(5) },
              settlementFee: { _value: -SETTLEMENT_FEE },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills the positions and settles later with fee (both / short)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('20'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(2),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                userC.address,
                0,
                POSITION.div(2),
                0,
                COLLATERAL,
                false,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            const riskParameter = { ...(await market.riskParameter()) }
            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                  takerReferral: POSITION.div(2).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortNeg: POSITION.div(2),
                  notional: POSITION.div(2).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(2).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  longNeg: POSITION.div(2),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  longNeg: POSITION.div(2),
                  notional: -POSITION.div(2).mul(125),
                  takerFee: POSITION.div(2),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)

            expectLocalEq(await market.locals(user.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(TAKER_FEE)
                .sub(SETTLEMENT_FEE.div(3).add(1)) // open
                .sub(EXPECTED_INTEREST_10_123_EFF.div(2)) // while open
                .sub(EXPECTED_PNL)
                .sub(TAKER_FEE), // close
            })
            expectPositionEq(await market.positions(user.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(user.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              shortNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userB.address), {
              ...DEFAULT_LOCAL,
              currentId: 1,
              latestId: 1,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(3).add(1)) // open
                .add(EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF) // while open
                .sub(4), // loss of precision
            })
            expectPositionEq(await market.positions(userB.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrders(userB.address, 1), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_2.timestamp,
              orders: 1,
              makerPos: POSITION,
              collateral: COLLATERAL,
            })
            expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(userC.address), {
              ...DEFAULT_LOCAL,
              currentId: 2,
              latestId: 2,
              collateral: COLLATERAL.sub(SETTLEMENT_FEE.div(3).add(1))
                .sub(TAKER_FEE) // open
                .sub(EXPECTED_INTEREST_10_123_EFF.div(2)) // while open
                .sub(SETTLEMENT_FEE)
                .add(EXPECTED_PNL), // close
            })
            expectPositionEq(await market.positions(userC.address), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
            })
            expectOrderEq(await market.pendingOrders(userC.address, 2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 1,
              longNeg: POSITION.div(2),
            })
            expectCheckpointEq(await market.checkpoints(userC.address, ORACLE_VERSION_4.timestamp), {
              ...DEFAULT_CHECKPOINT,
            })
            expectLocalEq(await market.locals(liquidator.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            expectLocalEq(await market.locals(owner.address), {
              ...DEFAULT_LOCAL,
              claimable: TAKER_FEE.mul(2).div(10).div(2),
            })
            const totalFee = TAKER_FEE.mul(2) // setup
              .add(EXPECTED_INTEREST_FEE_10_123_EFF) // while open
              .add(TAKER_FEE.sub(TAKER_FEE.mul(2).div(10))) // fill
            expectGlobalEq(await market.global(), {
              ...DEFAULT_GLOBAL,
              currentId: 2,
              latestId: 2,
              protocolFee: totalFee.mul(8).div(10).add(4), // loss of precision
              oracleFee: totalFee.div(10).add(SETTLEMENT_FEE.mul(2)), // loss of precision
              riskFee: totalFee.div(10).sub(2), // loss of precision
              latestPrice: PRICE,
            })
            expectPositionEq(await market.position(), {
              ...DEFAULT_POSITION,
              timestamp: ORACLE_VERSION_3.timestamp,
              maker: POSITION,
            })
            expectOrderEq(await market.pendingOrder(2), {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_3.timestamp,
              orders: 2,
              longNeg: POSITION.div(2),
              shortNeg: POSITION.div(2),
              takerReferral: POSITION.div(2).mul(2).div(10),
            })
            expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
              ...DEFAULT_VERSION,
              makerPreValue: {
                _value: EXPECTED_INTEREST_WITHOUT_FEE_10_123_EFF.div(10),
              },
              longPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              shortPreValue: { _value: EXPECTED_INTEREST_10_123_EFF.div(2).div(5).mul(-1) },
              takerFee: { _value: -TAKER_FEE.div(5) },
              settlementFee: { _value: -SETTLEMENT_FEE },
              price: PRICE,
              liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
            })
          })

          it('fills two positions and settles later with fee (taker / short)', async () => {
            factory.parameter.returns({
              maxPendingIds: 5,
              protocolFee: parse6decimal('0.50'),
              maxFee: parse6decimal('0.01'),
              maxLiquidationFee: parse6decimal('1000'),
              maxCut: parse6decimal('0.50'),
              maxRate: parse6decimal('10.00'),
              minMaintenance: parse6decimal('0.01'),
              minEfficiency: parse6decimal('0.1'),
              referralFee: parse6decimal('0.20'),
              minScale: parse6decimal('0.001'),
              maxStaleAfter: 14400,
              minMinMaintenance: 0,
            })

            const marketParameter = { ...(await market.parameter()) }
            marketParameter.takerFee = parse6decimal('0.01')
            await market.updateParameter(marketParameter)

            const EXPECTED_PNL = parse6decimal('10') // position * (125-123)
            const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
            const SETTLEMENT_FEE = parse6decimal('0.50')

            const intent = {
              amount: POSITION.div(4),
              price: parse6decimal('125'),
              fee: parse6decimal('0.5'),
              originator: liquidator.address,
              solver: owner.address,
              collateralization: parse6decimal('0.01'),
              common: {
                account: user.address,
                signer: user.address,
                domain: market.address,
                nonce: 0,
                group: 0,
                expiry: 0,
              },
            }

            await market
              .connect(userB)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                0,
                0,
                POSITION.div(2),
                COLLATERAL,
                false,
              )
            await market
              .connect(userC)
              ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

            oracle.at
              .whenCalledWith(ORACLE_VERSION_2.timestamp)
              .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)

            await updateSynBook(market, DEFAULT_SYN_BOOK)

            verifier.verifyIntent.returns()

            // taker
            factory.authorization
              .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
              .returns([false, true, parse6decimal('0.20')])

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                  takerReferral: POSITION.div(4).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                  notional: POSITION.div(4).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(4).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(4),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(4),
                  notional: -POSITION.div(4).mul(125),
                  takerFee: POSITION.div(4),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )

            await expect(
              market
                .connect(userC)
                [
                  'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
                ](userC.address, intent, DEFAULT_SIGNATURE),
            )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                user.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                  takerReferral: POSITION.div(4).mul(2).div(10),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 1,
                  shortNeg: POSITION.div(4),
                  notional: POSITION.div(4).mul(125),
                  takerFee: 0,
                  referral: POSITION.div(4).div(10),
                },
                constants.AddressZero,
                liquidator.address, // originator
                owner.address, // solver
              )
              .to.emit(market, 'OrderCreated')
              .withArgs(
                userC.address,
                {
                  ...DEFAULT_ORDER,
                  timestamp: ORACLE_VERSION_3.timestamp,
                  orders: 1,
                  shortPos: POSITION.div(4),
                },
                {
                  ...DEFAULT_GUARANTEE,
                  orders: 0,
                  shortPos: POSITION.div(4),
                  notional: -POSITION.div(4).mul(125),
                  takerFee: POSITION.div(4),
                  referral: 0,
                },
                constants.AddressZero,
                constants.AddressZero,
                constants.AddressZero,
              )
            oracle.at
              .whenCalledWith(ORACLE_VERSION_3.timestamp)
              .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
            oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
            oracle.request.whenCalledWith(user.address).returns()

            await settle(market, user)
            await settle(market, userB)
            await settle(market, userC)
          })
        })

        it('reverts when signature doesnt match account', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('125'),
            fee: 0,
            originator: liquidator.address,
            solver: constants.AddressZero,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: userB.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketOperatorNotAllowedError')
        })

        it('reverts if fee is too high', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('125'),
            fee: parse6decimal('1.5'),
            originator: liquidator.address,
            solver: constants.AddressZero,
            collateralization: parse6decimal('0.01'),
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketInvalidIntentFeeError')
        })

        it('reverts if collateralization is too low', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const intent = {
            amount: POSITION.div(2),
            price: parse6decimal('125'),
            fee: parse6decimal('0.5'),
            originator: liquidator.address,
            solver: constants.AddressZero,
            collateralization: parse6decimal('20.0'), // 10_000 / 20 = 500 < 125 * 5
            common: {
              account: user.address,
              signer: user.address,
              domain: market.address,
              nonce: 0,
              group: 0,
              expiry: 0,
            },
          }

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          await market
            .connect(user)
            ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, 0, 0, 0, COLLATERAL, false)
          await market
            .connect(userC)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userC.address, 0, 0, 0, COLLATERAL, false)

          verifier.verifyIntent.returns()

          // maker
          factory.authorization
            .whenCalledWith(userC.address, userC.address, constants.AddressZero, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])
          // taker
          factory.authorization
            .whenCalledWith(user.address, userC.address, user.address, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(userC)
              [
                'update(address,(int256,int256,uint256,address,address,uint256,(address,address,address,uint256,uint256,uint256)),bytes)'
              ](userC.address, intent, DEFAULT_SIGNATURE),
          ).to.be.revertedWithCustomError(market, 'MarketInsufficientMarginError')
        })
      })

      context('delta orders', async () => {
        beforeEach(async () => {
          dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
          dsu.transferFrom.whenCalledWith(userC.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        })

        it('applies the order w/ referrer', async () => {
          factory.parameter.returns({
            maxPendingIds: 5,
            protocolFee: parse6decimal('0.50'),
            maxFee: parse6decimal('0.01'),
            maxLiquidationFee: parse6decimal('20'),
            maxCut: parse6decimal('0.50'),
            maxRate: parse6decimal('10.00'),
            minMaintenance: parse6decimal('0.01'),
            minEfficiency: parse6decimal('0.1'),
            referralFee: parse6decimal('0.20'),
            minScale: parse6decimal('0.001'),
            maxStaleAfter: 14400,
            minMinMaintenance: 0,
          })

          const riskParameter = { ...(await market.riskParameter()) }
          const marketParameter = { ...(await market.parameter()) }
          marketParameter.takerFee = parse6decimal('0.01')
          await market.updateParameter(marketParameter)

          const TAKER_FEE = parse6decimal('6.15') // position * (0.01) * price
          const SETTLEMENT_FEE = parse6decimal('0.50')

          await market
            .connect(userB)
            ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)

          factory.authorization
            .whenCalledWith(user.address, user.address, constants.AddressZero, liquidator.address)
            .returns([false, true, parse6decimal('0.20')])

          await expect(
            market
              .connect(user)
              ['update(address,int256,int256,address)'](user.address, POSITION.div(2), COLLATERAL, liquidator.address),
          )
            .to.emit(market, 'OrderCreated')
            .withArgs(
              user.address,
              {
                ...DEFAULT_ORDER,
                timestamp: ORACLE_VERSION_2.timestamp,
                orders: 1,
                longPos: POSITION.div(2),
                collateral: COLLATERAL,
                takerReferral: POSITION.div(10),
              },
              { ...DEFAULT_GUARANTEE },
              constants.AddressZero,
              liquidator.address,
              constants.AddressZero,
            )

          factory.authorization
            .whenCalledWith(user.address, user.address, constants.AddressZero, userB.address)
            .returns([false, true, parse6decimal('0.20')])

          // revert with incorrect referrer
          await expect(
            market
              .connect(user)
              ['update(address,int256,int256,address)'](user.address, POSITION.div(2), COLLATERAL, userB.address),
          ).to.revertedWithCustomError(market, 'MarketInvalidReferrerError')

          oracle.at
            .whenCalledWith(ORACLE_VERSION_2.timestamp)
            .returns([ORACLE_VERSION_2, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])

          oracle.at
            .whenCalledWith(ORACLE_VERSION_3.timestamp)
            .returns([ORACLE_VERSION_3, { ...INITIALIZED_ORACLE_RECEIPT, settlementFee: SETTLEMENT_FEE }])
          oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
          oracle.request.whenCalledWith(user.address).returns()

          await settle(market, user)
          await settle(market, userB)

          expectLocalEq(await market.locals(user.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.sub(EXPECTED_FUNDING_WITH_FEE_1_5_123)
              .sub(EXPECTED_INTEREST_5_123)
              .sub(TAKER_FEE)
              .sub(SETTLEMENT_FEE.div(2)),
          })
          expectPositionEq(await market.positions(user.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrders(user.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            longPos: POSITION.div(2),
            collateral: COLLATERAL,
            takerReferral: POSITION.div(10),
          })
          expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(userB.address), {
            ...DEFAULT_LOCAL,
            currentId: 1,
            latestId: 1,
            collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123)
              .add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .sub(SETTLEMENT_FEE.div(2))
              .sub(8), // loss of precision
          })
          expectPositionEq(await market.positions(userB.address), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
          })
          expectOrderEq(await market.pendingOrders(userB.address, 1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 1,
            makerPos: POSITION,
            collateral: COLLATERAL,
          })
          expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
            ...DEFAULT_CHECKPOINT,
          })
          expectLocalEq(await market.locals(liquidator.address), {
            ...DEFAULT_LOCAL,
            claimable: TAKER_FEE.mul(2).div(10),
          })
          const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).add(
            TAKER_FEE.sub(TAKER_FEE.mul(2).div(10)),
          )
          expectGlobalEq(await market.global(), {
            ...DEFAULT_GLOBAL,
            currentId: 1,
            latestId: 1,
            protocolFee: totalFee.mul(8).div(10).sub(1), // loss of precision
            oracleFee: totalFee.div(10).sub(1).add(SETTLEMENT_FEE), // loss of precision
            riskFee: totalFee.div(10).sub(2), // loss of precision
            latestPrice: PRICE,
          })
          expectPositionEq(await market.position(), {
            ...DEFAULT_POSITION,
            timestamp: ORACLE_VERSION_3.timestamp,
            maker: POSITION,
            long: POSITION.div(2),
          })
          expectOrderEq(await market.pendingOrder(1), {
            ...DEFAULT_ORDER,
            timestamp: ORACLE_VERSION_2.timestamp,
            orders: 2,
            makerPos: POSITION,
            longPos: POSITION.div(2),
            collateral: COLLATERAL.mul(2),
            takerReferral: POSITION.div(10),
          })
          expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
            ...DEFAULT_VERSION,
            makerPreValue: {
              _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123).div(10),
            },
            longPreValue: { _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).div(5).mul(-1) },
            price: PRICE,
            liquidationFee: { _value: -riskParameter.liquidationFee.mul(SETTLEMENT_FEE).div(1e6) },
          })
        })
      })
    })

    describe('#close', async () => {
      beforeEach(async () => {
        await market.connect(owner).updateCoordinator(coordinator.address)
        await market.connect(owner).updateBeneficiary(beneficiary.address)
        await market.connect(owner).updateParameter(marketParameter)

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns([ORACLE_VERSION_0, INITIALIZED_ORACLE_RECEIPT])
        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])

        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()
      })

      it('closes a maker position', async () => {
        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false)
        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)
        await expect(market.connect(user).close(user.address, false, constants.AddressZero))
          .to.emit(market, 'OrderCreated')
          .withArgs(
            user.address,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, makerNeg: POSITION },
            { ...DEFAULT_GUARANTEE },
            constants.AddressZero,
            constants.AddressZero,
            constants.AddressZero,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 2,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_3.timestamp,
          orders: 1,
          makerNeg: POSITION,
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          ...DEFAULT_GLOBAL,
          ...DEFAULT_GLOBAL,
          currentId: 2,
          latestId: 1,
          latestPrice: PRICE,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_3.timestamp,
          orders: 1,
          makerNeg: POSITION,
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          price: PRICE,
        })
      })

      it('closes a long position', async () => {
        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            user.address,
            0,
            POSITION.div(2),
            0,
            COLLATERAL,
            false,
          )
        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)

        await expect(market.connect(user).close(user.address, false, constants.AddressZero))
          .to.emit(market, 'OrderCreated')
          .withArgs(
            user.address,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, longNeg: POSITION.div(2) },
            { ...DEFAULT_GUARANTEE },
            constants.AddressZero,
            constants.AddressZero,
            constants.AddressZero,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 2,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          long: POSITION.div(2),
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_3.timestamp,
          orders: 1,
          longNeg: POSITION.div(2),
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          ...DEFAULT_GLOBAL,
          currentId: 2,
          latestId: 1,
          latestPrice: PRICE,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
          long: POSITION.div(2),
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_3.timestamp,
          orders: 1,
          longNeg: POSITION.div(2),
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          price: PRICE,
        })
      })

      it('closes a short position', async () => {
        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            user.address,
            0,
            0,
            POSITION.div(2),
            COLLATERAL,
            false,
          )
        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)

        await expect(market.connect(user).close(user.address, false, constants.AddressZero))
          .to.emit(market, 'OrderCreated')
          .withArgs(
            user.address,
            { ...DEFAULT_ORDER, timestamp: ORACLE_VERSION_3.timestamp, orders: 1, shortNeg: POSITION.div(2) },
            { ...DEFAULT_GUARANTEE },
            constants.AddressZero,
            constants.AddressZero,
            constants.AddressZero,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 2,
          latestId: 1,
          collateral: COLLATERAL,
        })
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          short: POSITION.div(2),
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_3.timestamp,
          orders: 1,
          shortNeg: POSITION.div(2),
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectGlobalEq(await market.global(), {
          ...DEFAULT_GLOBAL,
          ...DEFAULT_GLOBAL,
          currentId: 2,
          latestId: 1,
          latestPrice: PRICE,
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_2.timestamp,
          maker: POSITION,
          short: POSITION.div(2),
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_3.timestamp,
          orders: 1,
          shortNeg: POSITION.div(2),
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_2.timestamp), {
          ...DEFAULT_VERSION,
          price: PRICE,
        })
      })

      it('liquidates a user', async () => {
        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        dsu.transferFrom.whenCalledWith(user.address, market.address, utils.parseEther('216')).returns(true)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            user.address,
            0,
            POSITION.div(2),
            0,
            parse6decimal('216'),
            false,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_2, ORACLE_VERSION_3.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)
        await settle(market, userB)

        const EXPECTED_PNL = parse6decimal('80').mul(5)
        const EXPECTED_LIQUIDATION_FEE = parse6decimal('50')

        const oracleVersionLowerPrice = {
          price: parse6decimal('43'),
          timestamp: TIMESTAMP + 7200,
          valid: true,
        }
        oracle.at
          .whenCalledWith(oracleVersionLowerPrice.timestamp)
          .returns([oracleVersionLowerPrice, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([oracleVersionLowerPrice, ORACLE_VERSION_4.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, userB)
        dsu.transfer.whenCalledWith(liquidator.address, EXPECTED_LIQUIDATION_FEE.mul(1e12)).returns(true)
        dsu.balanceOf.whenCalledWith(market.address).returns(COLLATERAL.mul(1e12))

        await expect(market.connect(liquidator).close(user.address, true, constants.AddressZero))
          .to.emit(market, 'OrderCreated')
          .withArgs(
            user.address,
            {
              ...DEFAULT_ORDER,
              timestamp: ORACLE_VERSION_4.timestamp,
              orders: 1,
              longNeg: POSITION.div(2),
              protection: 1,
            },
            { ...DEFAULT_GUARANTEE },
            liquidator.address,
            constants.AddressZero,
            constants.AddressZero,
          )

        expectLocalEq(await market.locals(user.address), {
          ...DEFAULT_LOCAL,
          currentId: 2,
          latestId: 1,
          collateral: parse6decimal('216')
            .sub(EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123))
            .sub(EXPECTED_PNL),
        })
        expect(await market.liquidators(user.address, 2)).to.equal(liquidator.address)
        expectPositionEq(await market.positions(user.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_3.timestamp,
          long: POSITION.div(2),
        })
        expectOrderEq(await market.pendingOrders(user.address, 2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_4.timestamp,
          orders: 1,
          longNeg: POSITION.div(2),
          protection: 1,
        })
        expectCheckpointEq(await market.checkpoints(user.address, ORACLE_VERSION_4.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        expectLocalEq(await market.locals(userB.address), {
          ...DEFAULT_LOCAL,
          currentId: 1,
          latestId: 1,
          collateral: COLLATERAL.add(EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123))
            .add(EXPECTED_PNL)
            .sub(8), // loss of precision
        })
        expectPositionEq(await market.positions(userB.address), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_3.timestamp,
          maker: POSITION,
        })
        expectOrderEq(await market.pendingOrders(userB.address, 1), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_2.timestamp,
          orders: 1,
          makerPos: POSITION,
          collateral: COLLATERAL,
        })
        expectCheckpointEq(await market.checkpoints(userB.address, ORACLE_VERSION_4.timestamp), {
          ...DEFAULT_CHECKPOINT,
        })
        const totalFee = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123)
        expectGlobalEq(await market.global(), {
          ...DEFAULT_GLOBAL,
          currentId: 2,
          latestId: 1,
          protocolFee: totalFee.mul(8).div(10).sub(2), // loss of precision
          oracleFee: totalFee.div(10).sub(1), // loss of precision
          riskFee: totalFee.div(10).sub(1), // loss of precision
          latestPrice: parse6decimal('43'),
        })
        expectPositionEq(await market.position(), {
          ...DEFAULT_POSITION,
          timestamp: ORACLE_VERSION_3.timestamp,
          maker: POSITION,
          long: POSITION.div(2),
        })
        expectOrderEq(await market.pendingOrder(2), {
          ...DEFAULT_ORDER,
          timestamp: ORACLE_VERSION_4.timestamp,
          orders: 1,
          longNeg: POSITION.div(2),
        })
        expectVersionEq(await market.versions(ORACLE_VERSION_3.timestamp), {
          ...DEFAULT_VERSION,
          makerValue: {
            _value: EXPECTED_FUNDING_WITHOUT_FEE_1_5_123.add(EXPECTED_INTEREST_WITHOUT_FEE_5_123)
              .add(EXPECTED_PNL)
              .div(10),
          },
          longValue: {
            _value: EXPECTED_FUNDING_WITH_FEE_1_5_123.add(EXPECTED_INTEREST_5_123).add(EXPECTED_PNL).div(5).mul(-1),
          },
          shortValue: { _value: 0 },
          price: oracleVersionLowerPrice.price,
        })
      })
    })

    describe('#claimFee', async () => {
      const MARKET_FEE = EXPECTED_FUNDING_FEE_1_5_123.add(EXPECTED_INTEREST_FEE_5_123).sub(5) // loss of precision
      const ORACLE_FEE = MARKET_FEE.div(10)
      const RISK_FEE = MARKET_FEE.sub(ORACLE_FEE).div(5)
      const PROTOCOL_FEE = MARKET_FEE.sub(ORACLE_FEE).sub(RISK_FEE)

      beforeEach(async () => {
        await market.updateParameter({
          ...marketParameter,
          riskFee: parse6decimal('0.2'),
        })

        oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns([ORACLE_VERSION_0, INITIALIZED_ORACLE_RECEIPT])

        oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        dsu.transferFrom.whenCalledWith(userB.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(userB)
          ['update(address,uint256,uint256,uint256,int256,bool)'](userB.address, POSITION, 0, 0, COLLATERAL, false)
        dsu.transferFrom.whenCalledWith(user.address, market.address, COLLATERAL.mul(1e12)).returns(true)
        await market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](
            user.address,
            0,
            POSITION.div(2),
            0,
            COLLATERAL,
            false,
          )

        oracle.at.whenCalledWith(ORACLE_VERSION_2.timestamp).returns([ORACLE_VERSION_2, INITIALIZED_ORACLE_RECEIPT])

        oracle.at.whenCalledWith(ORACLE_VERSION_3.timestamp).returns([ORACLE_VERSION_3, INITIALIZED_ORACLE_RECEIPT])
        oracle.status.returns([ORACLE_VERSION_3, ORACLE_VERSION_4.timestamp])
        oracle.request.whenCalledWith(user.address).returns()

        await settle(market, user)
        await settle(market, userB)
      })

      it('claims fee (protocol)', async () => {
        dsu.transfer.whenCalledWith(owner.address, PROTOCOL_FEE.mul(1e12)).returns(true)

        await expect(market.connect(owner).claimFee(owner.address))
          .to.emit(market, 'FeeClaimed')
          .withArgs(owner.address, owner.address, PROTOCOL_FEE)

        expect((await market.global()).protocolFee).to.equal(0)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
      })

      it('claims fee (oracle)', async () => {
        dsu.transfer.whenCalledWith(oracleSigner.address, ORACLE_FEE.mul(1e12)).returns(true)

        await expect(market.connect(oracleSigner).claimFee(oracleSigner.address))
          .to.emit(market, 'FeeClaimed')
          .withArgs(oracleSigner.address, oracleSigner.address, ORACLE_FEE)

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(0)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
      })

      it('claims fee (risk)', async () => {
        dsu.transfer.whenCalledWith(coordinator.address, RISK_FEE.mul(1e12)).returns(true)

        await expect(market.connect(coordinator).claimFee(coordinator.address))
          .to.emit(market, 'FeeClaimed')
          .withArgs(coordinator.address, coordinator.address, RISK_FEE)

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(0)
      })

      it('claims fee (none)', async () => {
        await market.connect(user).claimFee(user.address)

        expect((await market.global()).protocolFee).to.equal(PROTOCOL_FEE)
        expect((await market.global()).oracleFee).to.equal(ORACLE_FEE)
        expect((await market.global()).riskFee).to.equal(RISK_FEE)
      })

      it('claims fee as operator', async () => {
        dsu.transfer.whenCalledWith(userB.address, PROTOCOL_FEE.mul(1e12)).returns(true)
        factory.operators.whenCalledWith(owner.address, userB.address).returns(true)
        expect(await dsu.balanceOf(userB.address)).to.equal(0)

        await expect(market.connect(userB).claimFee(owner.address))
          .to.emit(market, 'FeeClaimed')
          .withArgs(owner.address, userB.address, PROTOCOL_FEE)

        expect((await market.global()).protocolFee).to.equal(0)
      })

      it('reverts when non-operator attempts to claim fee', async () => {
        factory.operators.whenCalledWith(owner.address, userB.address).returns(false)

        await expect(market.connect(userB).claimFee(oracleSigner.address)).to.be.revertedWithCustomError(
          market,
          'MarketNotOperatorError',
        )
      })
    })
  })

  describe('reentrancy', async () => {
    it('reverts if re-enter', async () => {
      const mockToken: MockToken = await new MockToken__factory(owner).deploy()
      marketDefinition = {
        token: mockToken.address,
        oracle: oracle.address,
      }
      await market.connect(factorySigner).initialize(marketDefinition)

      await market.connect(owner).updateBeneficiary(beneficiary.address)
      await market.connect(owner).updateCoordinator(coordinator.address)
      await market.connect(owner).updateRiskParameter(riskParameter)
      await market.connect(owner).updateParameter(marketParameter)

      oracle.at.whenCalledWith(ORACLE_VERSION_0.timestamp).returns([ORACLE_VERSION_0, INITIALIZED_ORACLE_RECEIPT])
      oracle.at.whenCalledWith(ORACLE_VERSION_1.timestamp).returns([ORACLE_VERSION_1, INITIALIZED_ORACLE_RECEIPT])

      oracle.status.returns([ORACLE_VERSION_1, ORACLE_VERSION_2.timestamp])
      oracle.request.whenCalledWith(user.address).returns()

      // try to re-enter into update method with maker position
      await mockToken.setFunctionToCall(0)
      await expect(
        market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
      ).to.revertedWithCustomError(market, 'ReentrancyGuardReentrantCallError')

      // try to re-enter into update method
      await mockToken.setFunctionToCall(1)
      await expect(
        market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
      ).to.revertedWithCustomError(market, 'ReentrancyGuardReentrantCallError')

      // try to re-enter into update intent method
      await mockToken.setFunctionToCall(2)
      await expect(
        market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
      ).to.revertedWithCustomError(market, 'ReentrancyGuardReentrantCallError')

      // try to re-enter into settle method
      mockToken.setFunctionToCall(3)
      await expect(
        market
          .connect(user)
          ['update(address,uint256,uint256,uint256,int256,bool)'](user.address, POSITION, 0, 0, COLLATERAL, false),
      ).to.revertedWithCustomError(market, 'ReentrancyGuardReentrantCallError')
    })
  })
})
