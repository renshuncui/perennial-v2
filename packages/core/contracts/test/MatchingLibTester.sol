// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { SynBook6 } from "@equilibria/root/synbook/types/SynBook6.sol";
import {
    MatchingPosition,
    MatchingOrder,
    MatchingResult,
    MatchingOrderbook,
    MatchingFillResult,
    MatchingExposure,
    MatchingLib
} from "../libs/MatchingLib.sol";

contract MatchingLibTester {
    function execute(
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) internal pure returns (MatchingResult memory result) {
        return MatchingLib.execute(position, order, synBook, price);
    }

    function _executeClose(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal pure returns (MatchingOrderbook memory, MatchingPosition memory, MatchingResult memory) {
        MatchingLib._executeClose(orderbook, position, order, synBook, price, result);
        return (orderbook, position, result);
    }

    function _executeTaker(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal pure returns (MatchingOrderbook memory, MatchingPosition memory, MatchingResult memory) {
        MatchingLib._executeTaker(orderbook, position, order, synBook, price, result);
        return (orderbook, position, result);
    }

    function _executeOpen(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price,
        MatchingResult memory result
    ) internal pure returns (MatchingOrderbook memory, MatchingPosition memory, MatchingResult memory) {
        MatchingLib._executeOpen(orderbook, position, order, synBook, price, result);
        return (orderbook, position, result);
    }

    function _fill(
        MatchingOrderbook memory orderbook,
        MatchingPosition memory position,
        MatchingOrder memory order,
        SynBook6 memory synBook,
        Fixed6 price
    ) internal pure returns (MatchingFillResult memory fillResult, MatchingOrderbook memory newOrderbook, MatchingPosition memory newPosition) {
        fillResult = MatchingLib._fill(orderbook, position, order, synBook, price);
        newOrderbook = orderbook;
        newPosition = position;
    }

    function _skew(MatchingPosition memory position) private pure returns (Fixed6) {
        return MatchingLib._skew(position);
    }

    function _skew(MatchingExposure memory exposure) private pure returns (Fixed6) {
        return MatchingLib._skew(exposure);
    }

    function _position(MatchingPosition memory position) internal pure returns (MatchingPosition memory) {
        return MatchingLib._position(position);
    }

    function _orderbook(MatchingOrderbook memory orderbook) internal pure returns (MatchingOrderbook memory) {
        return MatchingLib._orderbook(orderbook);
    }
    function _orderbook(MatchingPosition memory position) internal pure returns (MatchingOrderbook memory) {
        return MatchingLib._orderbook(position);
    }

    function _apply(MatchingOrderbook memory orderbook, MatchingExposure memory exposure) internal pure returns (MatchingOrderbook memory newOrderbook) {
         MatchingLib._apply(orderbook, exposure);
         newOrderbook = orderbook;
    }

    function _apply(MatchingOrderbook memory orderbook, Fixed6 side) internal pure returns (MatchingOrderbook memory newOrderbook) {
        MatchingLib._apply(orderbook, side);
        newOrderbook = orderbook;
    }

    function _flip(MatchingExposure memory exposure) internal pure returns (MatchingExposure memory) {
        return MatchingLib._flip(exposure);
    }

    function _extractMakerClose(MatchingOrder memory order) internal pure returns (MatchingOrder memory) {
        return MatchingLib._extractMakerClose(order);
    }

    function _extractTakerPos(MatchingOrder memory order) internal pure returns (MatchingOrder memory) {
        return MatchingLib._extractTakerPos(order);
    }

    function _extractTakerNeg(MatchingOrder memory order) internal pure returns (MatchingOrder memory) {
        return MatchingLib._extractTakerNeg(order);
    }

    function _extractMakerOpen(MatchingOrder memory order) internal pure returns (MatchingOrder memory) {
        return MatchingLib._extractMakerOpen(order);
    }

    function _apply(MatchingPosition memory position, MatchingOrder memory order) internal pure returns (MatchingPosition memory newPosition) {
        MatchingLib._apply(position, order);
        newPosition = position;
    }

    function _exposure(MatchingPosition memory position) internal pure returns (MatchingExposure memory) {
        return MatchingLib._exposure(position);
    }

    function _change(MatchingExposure memory exposureFrom,MatchingExposure memory exposureTo) internal pure returns (MatchingExposure memory) {
        return MatchingLib._change(exposureFrom, exposureTo);
    }
}
