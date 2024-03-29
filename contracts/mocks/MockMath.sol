//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import "../helpers/Math.sol";

/**
 @title MockMath
 @dev testing contract for the math contract contains amm math functions for the charon system
**/
contract MockMath is Math{
    function abs(int _a) external pure returns (uint256){
        return _abs(_a);
    }
    function bdiv(uint256 _a, uint256 _b) external pure returns (uint256){
        return _bdiv(_a,_b);
    }
    function bfloor(uint256 _a) external pure returns (uint256){
        return _bfloor(_a);
    }
    function bmul(uint256 _a, uint256 _b) external pure returns (uint256){
        return _bmul(_a,_b);
    }
    function bpow(uint256 _b, uint256 _e) external pure returns (uint256){
        return _bpow(_b,_e);
    }
    function bpowApprox(uint256 _b, uint256 _e, uint256 _p) external pure returns (uint256){
        return _bpowApprox(_b,_e,_p);
    }
    function bpowi(uint256 _a, uint256 _n) external pure returns (uint256 _z){
        return _bpowi(_a,_n);
    }
    function bsubSign(uint256 _a, uint256 _b) external pure returns (uint256, bool){
        return _bsubSign(_a,_b);
    }
    function btoi(uint256 _a) external pure returns (uint256){
        return _btoi(_a);
    }
}
