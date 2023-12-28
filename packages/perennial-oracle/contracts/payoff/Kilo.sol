// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.19;

import "../interfaces/IPayoffProvider.sol";

contract Kilo is IPayoffProvider {
    Fixed18 private constant MULTIPLICAND = Fixed18.wrap(1e21);

    function payoff(Fixed18 price) external pure override returns (Fixed18) {
        return price.mul(MULTIPLICAND);
    }
}
