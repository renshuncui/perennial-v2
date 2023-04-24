// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "@equilibria/root-v2/contracts/UFixed6.sol";
import "./MarketParameter.sol";

/// @dev Position type
struct Position {
    uint256 latestVersion;
    /// @dev Quantity of the maker position
    UFixed6 maker;
    /// @dev Quantity of the long position
    UFixed6 long;
    /// @dev Quantity of the short position
    UFixed6 short;

    uint256 versionNext;
    /// @dev Quantity of the next maker position
    UFixed6 makerNext;
    /// @dev Quantity of the next long position
    UFixed6 longNext;
    /// @dev Quantity of the next short position
    UFixed6 shortNext;
}
using PositionLib for Position global;
struct StoredPosition {
    uint40 _latestVersion; //TODO: name version
    uint72 _maker;
    uint72 _long;
    uint72 _short;
    uint40 _versionNext;   //TODO: flip next order?
    uint72 _makerNext;
    uint72 _longNext;
    uint72 _shortNext;
}
struct PositionStorage { StoredPosition value; }
using PositionStorageLib for PositionStorage global;

/**
 * @title PositionLib
 * @notice Library that surfaces math and settlement computations for the Position type.
 * @dev Positions track the current quantity of the account's maker and taker positions respectively
 *      denominated as a unit of the product's payoff function.
 */
library PositionLib {
    function update(
        Position memory self,
        Fixed6 makerAmount,
        Fixed6 longAmount,
        Fixed6 shortAmount,
        OracleVersion memory currentOracleVersion
    ) internal pure {
        self.versionNext = currentOracleVersion.version + 1;
        self.makerNext = UFixed6Lib.from(Fixed6Lib.from(self.makerNext).add(makerAmount));
        self.longNext = UFixed6Lib.from(Fixed6Lib.from(self.longNext).add(longAmount));
        self.shortNext = UFixed6Lib.from(Fixed6Lib.from(self.shortNext).add(shortAmount));
    }

    function settle(Position memory self) internal pure {
        self.latestVersion = self.versionNext;
        self.maker = self.makerNext;
        self.long = self.longNext;
        self.short = self.shortNext;
    }

    /**
     * @notice Returns the utilization ratio for the current position
     * @param self The Position to operate on
     * @return utilization ratio
     */
    function utilization(Position memory self) internal pure returns (UFixed6) {
        UFixed6 _magnitude = magnitude(self);
        UFixed6 _net = net(self);
        UFixed6 buffer = self.maker.gt(_net) ? self.maker.sub(_net) : UFixed6Lib.ZERO;

        return _magnitude.unsafeDiv(_magnitude.add(buffer));
    }

    function magnitude(Position memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short);
    }

    function net(Position memory self) internal pure returns (UFixed6) {
        return Fixed6Lib.from(self.long).sub(Fixed6Lib.from(self.short)).abs();
    }

    function spread(Position memory self) internal pure returns (UFixed6) {
        return net(self).div(magnitude(self));
    }

    function longSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.short).min(self.long);
    }

    function shortSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.long).min(self.short);
    }

    function takerSocialized(Position memory self) internal pure returns (UFixed6) {
        return magnitude(self).min(self.long.min(self.short).add(self.maker));
    }

    function socializedNext(Position memory self) internal pure returns (bool) {
        return self.makerNext.add(self.shortNext).lt(self.longNext) || self.makerNext.add(self.longNext).lt(self.shortNext);
    }
}

library PositionStorageLib {
    error PositionStorageInvalidError();

    function read(PositionStorage storage self) internal view returns (Position memory) {
        StoredPosition memory storedValue =  self.value;
        return Position(
            uint256(storedValue._latestVersion),
            UFixed6.wrap(uint256(storedValue._maker)),
            UFixed6.wrap(uint256(storedValue._long)),
            UFixed6.wrap(uint256(storedValue._short)),
            uint256(storedValue._versionNext),
            UFixed6.wrap(uint256(storedValue._makerNext)),
            UFixed6.wrap(uint256(storedValue._longNext)),
            UFixed6.wrap(uint256(storedValue._shortNext))
        );
    }

    function store(PositionStorage storage self, Position memory newValue) internal {
        if (newValue.latestVersion > type(uint40).max) revert PositionStorageInvalidError();
        if (newValue.maker.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.long.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.short.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.versionNext > type(uint40).max) revert PositionStorageInvalidError();
        if (newValue.makerNext.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.longNext.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.shortNext.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();

        self.value = StoredPosition(
            uint40(newValue.latestVersion),
            uint72(UFixed6.unwrap(newValue.maker)),
            uint72(UFixed6.unwrap(newValue.long)),
            uint72(UFixed6.unwrap(newValue.short)),
            uint40(newValue.versionNext),
            uint72(UFixed6.unwrap(newValue.makerNext)),
            uint72(UFixed6.unwrap(newValue.longNext)),
            uint72(UFixed6.unwrap(newValue.shortNext))
        );
    }
}
