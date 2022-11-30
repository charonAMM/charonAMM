//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

/**
 @title math
 @dev the math contract contains amm math functions for the charon system
**/
contract Math{
    uint256 public constant BONE              = 10**18;
    uint256 public constant MAX_IN_RATIO      = BONE / 2;
    uint256 public constant MAX_OUT_RATIO     = (BONE / 3) + 1 wei;

    function calcInGivenOut(
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountOut,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountIn)
    {
        uint256 _diff = _bsub(tokenBalanceOut, tokenAmountOut);
        uint256 _y = _bdiv(tokenBalanceOut, _diff);
        uint256 _foo = _bsub(_y, BONE);
        tokenAmountIn = _bsub(BONE, swapFee);
        tokenAmountIn = _bdiv(_bmul(tokenBalanceIn, _foo), tokenAmountIn);
    }

    function calcOutGivenIn(
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountOut)
    {
        uint256 _adjustedIn = BONE - swapFee;
        _adjustedIn = _bmul(tokenAmountIn, _adjustedIn);
        uint256 _y = _bdiv(tokenBalanceIn, (tokenBalanceIn + _adjustedIn));
        uint256 _bar = BONE - _y;
        tokenAmountOut = _bmul(tokenBalanceOut, _bar);
    }

    function calcPoolOutGivenSingleIn(
        uint256 tokenBalanceIn,
        uint256 poolSupply,
        uint256 tokenAmountIn
    )
        public pure
        returns (uint256 poolAmountOut)
    {
        uint256 tokenAmountInAfterFee = _bmul(tokenAmountIn,BONE);
        uint256 newTokenBalanceIn = tokenBalanceIn + tokenAmountInAfterFee;
        uint256 tokenInRatio = _bdiv(newTokenBalanceIn, tokenBalanceIn);
        uint256 poolRatio = _bpow(tokenInRatio, _bdiv(1 ether, 2 ether));
        uint256 newPoolSupply = _bmul(poolRatio, poolSupply);
        poolAmountOut = _bsub(newPoolSupply, poolSupply);
    }

    function calcSingleOutGivenPoolIn(
        uint256 tokenBalanceOut,
        uint256 poolSupply,
        uint256 poolAmountIn,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountOut)
    {
        uint256 normalizedWeight = _bdiv(1 ether,2 ether);
        uint256 poolAmountInAfterExitFee = _bmul(poolAmountIn, (BONE));
        uint256 newPoolSupply = poolSupply - poolAmountInAfterExitFee;
        uint256 poolRatio = _bdiv(newPoolSupply, poolSupply);
        uint256 tokenOutRatio = _bpow(poolRatio, _bdiv(BONE, normalizedWeight));
        uint256 newTokenBalanceOut = _bmul(tokenOutRatio, tokenBalanceOut);
        uint256 tokenAmountOutBeforeSwapFee = tokenBalanceOut - newTokenBalanceOut;
        uint256 zaz = _bmul((BONE - normalizedWeight), swapFee); 
        tokenAmountOut = _bmul(tokenAmountOutBeforeSwapFee,(BONE - zaz));
    }

    function calcSpotPrice(
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 swapFee
    )
        public pure
        returns (uint256)
    {
        uint256 ratio =  _bdiv(tokenBalanceIn ,tokenBalanceOut);
        uint256 scale = _bdiv(BONE , (BONE - swapFee));//10e18/(10e18-fee)
        return _bmul(ratio ,scale);
    }

    //internal functions
    
    function _bdiv(uint256 _a, uint256 _b) internal pure returns (uint256 _c2){
        require(_b != 0, "ERR_DIV_ZERO");
        uint256 _c0 = _a * BONE;
        require(_a == 0 || _c0 / _a == BONE, "ERR_DIV_INTERNAL"); // bmul overflow
        uint256 _c1 = _c0 + (_b / 2);
        require(_c1 >= _c0, "ERR_DIV_INTERNAL"); //  badd require
        _c2 = _c1 / _b;
    }
    
    function _bfloor(uint256 _a) internal pure returns (uint256){
        return _btoi(_a) * BONE;
    }
    
    function _bmul(uint256 _a, uint256 _b) internal pure returns (uint256 _c2){
        uint256 _c0 = _a * _b;
        require(_a == 0 || _c0 / _a == _b, "ERR_MUL_OVERFLOW");
        uint256 _c1 = _c0 + (BONE / 2);
        require(_c1 >= _c0, "ERR_MUL_OVERFLOW");
        _c2 = _c1 / BONE;
    }

    function _bpow(uint256 _base, uint256 _exp) internal pure returns (uint256){
        require(_base >= 1 wei, "ERR_POW_BASE_TOO_LOW");
        require(_base <= ((2 * BONE) - 1 wei), "ERR_POW_BASE_TOO_HIGH");
        uint256 _whole  = _bfloor(_exp);   
        uint256 _remain = _bsub(_exp, _whole);
        uint256 _wholePow = _bpowi(_base, _btoi(_whole));
        if (_remain == 0) {
            return _wholePow;
        }
        uint256 _partialResult = _bpowApprox(_base, _remain, BONE / 10**10);
        return _bmul(_wholePow, _partialResult);
    }

    function _bpowApprox(uint256 _base, uint256 _exp, uint256 _precision) 
            internal 
            pure 
            returns (uint256 _sum)
        {
        uint256 _a = _exp;
        (uint256 _x, bool _xneg)  = _bsubSign(_base, BONE);
        uint256 _term = BONE;
        _sum = _term;
        bool _negative = false;
        for (uint256 _i = 1; _term >= _precision; _i++) {
            uint256 _bigK = _i * BONE;
            (uint256 _c, bool _cneg) = _bsubSign(_a, _bsub(_bigK, BONE));
            _term = _bmul(_term, _bmul(_c, _x));
            _term = _bdiv(_term, _bigK);
            if (_term == 0) break;
            if (_xneg) _negative = !_negative;
            if (_cneg) _negative = !_negative;
            if (_negative) {
                _sum = _bsub(_sum, _term);
            } else {
                _sum = _sum + _term;
            }
        }
    }
        // DSMath.wpow
    function _bpowi(uint256 _a, uint256 _n) internal pure returns (uint256 _z){
        _z = _n % 2 != 0 ? _a : BONE;
        for (_n /= 2; _n != 0; _n /= 2) {
            _a = _bmul(_a, _a);
            if (_n % 2 != 0) {
                _z = _bmul(_z, _a);
            }
        }
    }

    function _bsub(uint256 _a, uint256 _b) internal pure returns (uint256){
        (uint256 _c,bool _flag) = _bsubSign(_a, _b);
        require(!_flag, "ERR_SUB_UNDERFLOW");
        return _c;
    }

    function _bsubSign(uint256 _a, uint256 _b) internal pure returns (uint256, bool){
        if (_a >= _b) {
            return (_a - _b, false);
        } else {
            return (_b - _a, true);
        }
    }

    function _btoi(uint256 _a) internal pure returns (uint256){
        return _a / BONE;
    }
}
