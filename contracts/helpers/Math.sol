//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

/**
 @title math
 @dev the math contract contains amm math functions for the charon system
**/
contract Math{
    /*Storage*/
    uint256 public constant BONE              = 10**18;
    uint256 public constant MAX_IN_RATIO      = BONE / 2;
    uint256 public constant MAX_OUT_RATIO     = (BONE / 3) + 1 wei;

    /*Functions*/
    /**
     * @dev calculates an in amount of a token given how much is expected out of the other token
     * @param _tokenBalanceIn uint256 amount of tokenBalance of the in token's pool
     * @param _tokenBalanceOut uint256 amount of token balance in the out token's pool
     * @param _tokenAmountOut uint256 amount of token you expect out
     * @param _swapFee uint256 fee on top of swap
     * @return _tokenAmountIn is the uint256 amount of token in
     */
    function calcInGivenOut(
        uint256 _tokenBalanceIn,
        uint256 _tokenBalanceOut,
        uint256 _tokenAmountOut,
        uint256 _swapFee
    )
        public pure
        returns (uint256 _tokenAmountIn)
    {
        uint256 _diff = _tokenBalanceOut - _tokenAmountOut;
        uint256 _y = _bdiv(_tokenBalanceOut, _diff);
        uint256 _foo = _y - BONE;
        _tokenAmountIn = BONE - _swapFee;
        _tokenAmountIn = _bdiv(_bmul(_tokenBalanceIn, _foo), _tokenAmountIn);
    }

    /**
     * @dev calculates an out amount for a given token's amount in
     * @param _tokenBalanceIn uint256 amount of tokenBalance of the in token's pool
     * @param _tokenBalanceOut uint256 amount of token balance in the out token's pool
     * @param _tokenAmountIn uint256 amount of token you expect out
     * @param _swapFee uint256 fee on top of swap
     * @return _tokenAmountOut is the uint256 amount of token out
     */
    function calcOutGivenIn(
        uint256 _tokenBalanceIn,
        uint256 _tokenBalanceOut,
        uint256 _tokenAmountIn,
        uint256 _swapFee
    )
        public pure
        returns (uint256 _tokenAmountOut)
    {
        uint256 _adjustedIn = BONE - _swapFee;
        _adjustedIn = _bmul(_tokenAmountIn, _adjustedIn);
        uint256 _y = _bdiv(_tokenBalanceIn, (_tokenBalanceIn + _adjustedIn));
        uint256 _bar = BONE - _y;
        _tokenAmountOut = _bmul(_tokenBalanceOut, _bar);
    }

    /**
     * @dev calculates a amount of pool tokens out when given a single token's in amount
     * @param _tokenBalanceIn uint256 amount of tokenBalance of the in token's pool
     * @param _poolSupply uint256 amount of pool tokens in supply
     * @param _tokenAmountIn amount of tokens you are sending in
     * @return _poolAmountOut is the uint256 amount of pool token out
     */
    function calcPoolOutGivenSingleIn(
        uint256 _tokenBalanceIn,
        uint256 _poolSupply,
        uint256 _tokenAmountIn
    )
        public pure
        returns (uint256 _poolAmountOut)
    {
        uint256 _tokenAmountInAfterFee = _bmul(_tokenAmountIn,BONE);
        uint256 _newTokenBalanceIn = _tokenBalanceIn + _tokenAmountInAfterFee;
        uint256 _tokenInRatio = _bdiv(_newTokenBalanceIn, _tokenBalanceIn);
        uint256 _poolRatio = _bpow(_tokenInRatio, _bdiv(1 ether, 2 ether));
        uint256 _newPoolSupply = _bmul(_poolRatio, _poolSupply);
        _poolAmountOut = _newPoolSupply - _poolSupply;
    }

    /**
     * @dev calculates an in amount of a token you get out when sending in a given amount of tokens
     * @param _tokenBalanceOut uint256 amount of token balance in the out token's pool
     * @param _inSupply uint256 total supply of in tokens
     * @param _amountIn amount of in tokens your sending in
     * @param _swapFee uint256 fee on top of swap
     * @return _tokenAmountOut is the uint256 amount of token out
     */
    function calcSingleOutGivenIn(
        uint256 _tokenBalanceOut,
        uint256 _inSupply,
        uint256 _amountIn,
        uint256 _swapFee,
        bool _isPool
    )
        public pure
        returns (uint256 _tokenAmountOut)
    {
        uint256 _normalizedWeight;
        if(_isPool){
            _normalizedWeight = _bdiv(1 ether,2 ether);
            uint256 _amountInAfterExitFee = _bmul(_amountIn, (BONE));
            uint256 _newSupply = _inSupply - _amountInAfterExitFee;
            uint256 _ratio = _bdiv(_newSupply, _inSupply);
            uint256 _tokenOutRatio = _bpow(_ratio, _bdiv(BONE, _normalizedWeight));
            uint256 _newTokenBalanceOut = _bmul(_tokenOutRatio, _tokenBalanceOut);
            uint256 _tokenAmountOutBeforeSwapFee = _tokenBalanceOut - _newTokenBalanceOut;
            uint256 _zaz = _bmul((BONE - _normalizedWeight), _swapFee); 
            _tokenAmountOut = _bmul(_tokenAmountOutBeforeSwapFee,(BONE - _zaz));
        }
        else{
            uint256 _adjustedIn = BONE - _swapFee;
            _adjustedIn = _bmul(_amountIn, _adjustedIn);
            uint256 _y = _bdiv(BONE, (_inSupply));
            uint256 _bar = _bpow((BONE - _y),_amountIn);
            _tokenAmountOut = _tokenBalanceOut - _bmul(_tokenBalanceOut, _bar);
        }

    }

    /**
     * @dev calculates the spot price given a supply of two tokens
     * @param _tokenBalanceIn uint256 amount of tokenBalance of the in token's pool
     * @param _tokenBalanceOut uint256 amount of token balance in the out token's pool
     * @param _swapFee uint256 fee on top of swap
     * @return uint256 spot price
     */
    function calcSpotPrice(
        uint256 _tokenBalanceIn,
        uint256 _tokenBalanceOut,
        uint256 _swapFee
    )
        public pure
        returns (uint256)
    {
        uint256 _ratio =  _bdiv(_tokenBalanceIn ,_tokenBalanceOut);
        uint256 _scale = _bdiv(BONE , (BONE - _swapFee));//10e18/(10e18-fee)
        return _bmul(_ratio ,_scale);
    }

    //internal functions
    /**
     * @dev division of two numbers but adjusts as if decimals
     * @param _a numerator
     * @param _b denominator
     * @return _c2 uint256 result of division
     */
    function _bdiv(uint256 _a, uint256 _b) internal pure returns (uint256 _c2){
        require(_b != 0, "ERR_DIV_ZERO");
        uint256 _c0 = _a * BONE;
        require(_a == 0 || _c0 / _a == BONE, "ERR_DIV_INTERNAL"); // bmul overflow
        uint256 _c1 = _c0 + (_b / 2);
        require(_c1 >= _c0, "ERR_DIV_INTERNAL"); //  badd require
        _c2 = _c1 / _b;
    }
    
    /**
     * @dev rounds a number down
     * @param _a number
     * @return uint256 result of rounding down
     */
    function _bfloor(uint256 _a) internal pure returns (uint256){
        return _btoi(_a) * BONE;
    }
    
    /**
     * @dev multiplication of two numbers but adjusts as if decimals
     * @param _a first number
     * @param _b second number
     * @return _c2 uint256 result of multiplication
     */
    function _bmul(uint256 _a, uint256 _b) internal pure returns (uint256 _c2){
        uint256 _c0 = _a * _b;
        require(_a == 0 || _c0 / _a == _b, "ERR_MUL_OVERFLOW");
        uint256 _c1 = _c0 + (BONE / 2);
        _c2 = _c1 / BONE;
    }

    /**
     * @dev limited power function
     * @param _base base to raise
     * @param _exp or power to raise to
     * @return uint256 result of pow
     */
    function _bpow(uint256 _base, uint256 _exp) internal pure returns (uint256){
        require(_base >= 1 wei, "ERR_POW_BASE_TOO_LOW");
        require(_base <= ((2 * BONE) - 1 wei), "ERR_POW_BASE_TOO_HIGH");
        uint256 _whole  = _bfloor(_exp);   
        uint256 _remain = _exp - _whole;
        uint256 _wholePow = _bpowi(_base, _btoi(_whole));
        if (_remain == 0) {
            return _wholePow;
        }
        uint256 _partialResult = _bpowApprox(_base, _remain, BONE / 10**10);
        return _bmul(_wholePow, _partialResult);
    }

    /**
     * @dev approximate (rounds) power of two numbers
     * @param _base of exponent
     * @param _exp exponent to raise to
     * @param _precision precision with which to round to
     * @return _sum is the uint256 result of the pow
     */
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
            (uint256 _c, bool _cneg) = _bsubSign(_a, _bigK - BONE);
            _term = _bmul(_term, _bmul(_c, _x));
            _term = _bdiv(_term, _bigK);
            if (_term == 0) break;
            if (_xneg) _negative = !_negative;
            if (_cneg) _negative = !_negative;
            if (_negative) {
                _sum = _sum - _term;
            } else {
                _sum = _sum + _term;
            }
        }
    }

    /**
     * @dev raises one number to the other and adjusts as if decimals
     * @param _a base
     * @param _n exponent
     * @return _z uint256 result of pow
     */
    function _bpowi(uint256 _a, uint256 _n) internal pure returns (uint256 _z){
        _z = _n % 2 != 0 ? _a : BONE;
        for (_n /= 2; _n != 0; _n /= 2) {
            _a = _bmul(_a, _a);
            if (_n % 2 != 0) {
                _z = _bmul(_z, _a);
            }
        }
    }

    /**
     * @dev subtraction of a number from one, but turns into abs function if neg result
     * @param _a base
     * @param _b number to subtract
     * @return uint256 result and boolean if negative
     */
    function _bsubSign(uint256 _a, uint256 _b) internal pure returns (uint256, bool){
        if (_a >= _b) {
            return (_a - _b, false);
        } else {
            return (_b - _a, true);
        }
    }

    /**
     * @dev divides a number by BONE (1e18)
     * @param _a numerator
     * @return uint256 result
     */
    function _btoi(uint256 _a) internal pure returns (uint256){
        return _a / BONE;
    }
}
