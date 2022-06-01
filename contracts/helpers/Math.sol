//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

contract Math{
    uint256 public constant BONE              = 10**18;
    uint256 public constant MIN_WEIGHT        = BONE;
    uint256 public constant MAX_WEIGHT        = BONE * 50;
    uint256 public constant MAX_TOTAL_WEIGHT  = BONE * 50;
    uint256 public constant MIN_BALANCE       = BONE / 10**12;
    uint256 public constant INIT_POOL_SUPPLY  = BONE * 100;
    uint256 public constant MIN_BPOW_BASE     = 1 wei;
    uint256 public constant MAX_BPOW_BASE     = (2 * BONE) - 1 wei;
    uint256 public constant BPOW_PRECISION    = BONE / 10**10;
    uint256 public constant MAX_IN_RATIO      = BONE / 2;
    uint256 public constant MAX_OUT_RATIO     = (BONE / 3) + 1 wei;

    /**********************************************************************************************
    // calcSpotPrice                                                                             //
    // sP = spotPrice                                                                            //
    // bI = tokenBalanceIn                ( bI / wI )         1                                  //
    // bO = tokenBalanceOut         sP =  -----------  *  ----------                             //
    // wI = tokenWeightIn                 ( bO / wO )     ( 1 - sF )                             //
    // wO = tokenWeightOut                                                                       //
    // sF = swapFee                                                                              //
    **********************************************************************************************/
    function calcSpotPrice(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 swapFee
    )
        public pure
        returns (uint256 spotPrice)
    {
        uint256 numer = bdiv(tokenBalanceIn,tokenWeightIn);
        uint256 denom = bdiv(tokenBalanceOut,tokenWeightOut);
        uint256 ratio =  bdiv(numer , denom);
        uint256 scale = bdiv(BONE , (BONE - swapFee));//10e18/(10e18-fee)
        return (spotPrice = bmul(ratio ,scale));
    }

    /**********************************************************************************************
    // calcOutGivenIn                                                                            //
    // aO = tokenAmountOut                                                                       //
    // bO = tokenBalanceOut                                                                      //
    // bI = tokenBalanceIn              /      /            bI             \    (wI / wO) \      //
    // aI = tokenAmountIn    aO = bO * |  1 - | --------------------------  | ^            |     //
    // wI = tokenWeightIn               \      \ ( bI + ( aI * ( 1 - sF )) /              /      //
    // wO = tokenWeightOut                                                                       //
    // sF = swapFee                                                                              //
    **********************************************************************************************/
    function calcOutGivenIn(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountIn,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountOut)
    {
        uint256 weightRatio = bdiv(tokenWeightIn, tokenWeightOut);
        uint256 adjustedIn = BONE - swapFee;
        adjustedIn = bmul(tokenAmountIn, adjustedIn);
        uint256 y = bdiv(tokenBalanceIn, (tokenBalanceIn + adjustedIn));
        uint256 foo = bpow(y, weightRatio);
        uint256 bar = BONE - foo;
        tokenAmountOut = bmul(tokenBalanceOut, bar);
        return tokenAmountOut;
    }

    /**********************************************************************************************
    // calcInGivenOut                                                                            //
    // aI = tokenAmountIn                                                                        //
    // bO = tokenBalanceOut               /  /     bO      \    (wO / wI)      \                 //
    // bI = tokenBalanceIn          bI * |  | ------------  | ^            - 1  |                //
    // aO = tokenAmountOut    aI =        \  \ ( bO - aO ) /                   /                 //
    // wI = tokenWeightIn           --------------------------------------------                 //
    // wO = tokenWeightOut                          ( 1 - sF )                                   //
    // sF = swapFee                                                                              //
    **********************************************************************************************/
    function calcInGivenOut(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountOut,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountIn)
    {
        uint256 weightRatio = bdiv(tokenWeightOut, tokenWeightIn);
        uint256 diff = tokenBalanceOut - tokenAmountOut;
        uint256 y = bdiv(tokenBalanceOut, diff);
        uint256 foo = bpow(y, weightRatio);
        foo = foo - BONE;
        tokenAmountIn =BONE -swapFee;
        tokenAmountIn = bdiv(bmul(tokenBalanceIn, foo), tokenAmountIn);
        return tokenAmountIn;
    }

    /**********************************************************************************************
    // calcPoolOutGivenSingleIn                                                                  //
    // pAo = poolAmountOut         /                                              \              //
    // tAi = tokenAmountIn        ///      /     //    wI \      \\       \     wI \             //
    // wI = tokenWeightIn        //| tAi *| 1 - || 1 - --  | * sF || + tBi \    --  \            //
    // tW = totalWeight     pAo=||  \      \     \\    tW /      //         | ^ tW   | * pS - pS //
    // tBi = tokenBalanceIn      \\  ------------------------------------- /        /            //
    // pS = poolSupply            \\                    tBi               /        /             //            \                                              /              //
    **********************************************************************************************/
    function calcPoolOutGivenSingleIn(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 poolSupply,
        uint256 totalWeight,
        uint256 tokenAmountIn
    )
        public pure
        returns (uint256 poolAmountOut)
    {
        uint256 normalizedWeight = bdiv(tokenWeightIn, totalWeight);
        uint256 tokenAmountInAfterFee = bmul(tokenAmountIn,BONE);
        uint256 newTokenBalanceIn = badd(tokenBalanceIn, tokenAmountInAfterFee);
        uint256 tokenInRatio = bdiv(newTokenBalanceIn, tokenBalanceIn);
        uint256 poolRatio = bpow(tokenInRatio, normalizedWeight);
        uint256 newPoolSupply = bmul(poolRatio, poolSupply);
        poolAmountOut = bsub(newPoolSupply, poolSupply);
        return poolAmountOut;
    }

    /**********************************************************************************************
    // calcSingleInGivenPoolOut                                                                  //
    // tAi = tokenAmountIn              //(pS + pAo)\     /    1    \\                           //
    // pS = poolSupply                 || ---------  | ^ | --------- || * bI - bI                //
    // pAo = poolAmountOut              \\    pS    /     \(wI / tW)//                           //
    // bI = balanceIn          tAi =  --------------------------------------------               //
    // wI = weightIn                              /      wI  \                                   //
    // tW = totalWeight                          |  1 - ----  |  * sF                            //
    // sF = swapFee                               \      tW  /                                   //
    **********************************************************************************************/
    function calcSingleInGivenPoolOut(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 poolSupply,
        uint256 totalWeight,
        uint256 poolAmountOut,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountIn)
    {
        uint256 normalizedWeight = bdiv(tokenWeightIn, totalWeight);
        uint256 newPoolSupply = poolSupply + poolAmountOut;
        uint256 poolRatio = bdiv(newPoolSupply, poolSupply);
        //uint256 newBalTi = poolRatio^(1/weightTi) * balTi;
        uint256 boo = bdiv(BONE, normalizedWeight); 
        uint256 tokenInRatio = bpow(poolRatio, boo);
        uint256 newTokenBalanceIn = bmul(tokenInRatio, tokenBalanceIn);
        uint256 tokenAmountInAfterFee = newTokenBalanceIn - tokenBalanceIn;
        uint256 zar = bmul((BONE - normalizedWeight), swapFee);
        tokenAmountIn = bdiv(tokenAmountInAfterFee,BONE - zar);
        return tokenAmountIn;
    }

    /**********************************************************************************************
    // calcSingleOutGivenPoolIn                                                                  //
    // tAo = tokenAmountOut            /      /                                             \\   //
    // bO = tokenBalanceOut           /      // pS - (pAi * (1 - eF)) \     /    1    \      \\  //
    // pAi = poolAmountIn            | bO - || ----------------------- | ^ | --------- | * b0 || //
    // ps = poolSupply                \      \\          pS           /     \(wO / tW)/      //  //
    // wI = tokenWeightIn      tAo =   \      \                                             //   //
    // tW = totalWeight                    /     /      wO \       \                             //
    // sF = swapFee                    *  | 1 - |  1 - ---- | * sF  |                            //
    // eF = exitFee                        \     \      tW /       /                             //
    **********************************************************************************************/
    function calcSingleOutGivenPoolIn(
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 poolSupply,
        uint256 totalWeight,
        uint256 poolAmountIn,
        uint256 swapFee
    )
        public pure
        returns (uint256 tokenAmountOut)
    {
        uint256 normalizedWeight = bdiv(tokenWeightOut, totalWeight);
        uint256 poolAmountInAfterExitFee = bmul(poolAmountIn, (BONE));
        uint256 newPoolSupply = poolSupply - poolAmountInAfterExitFee;
        uint256 poolRatio = bdiv(newPoolSupply, poolSupply);
        uint256 tokenOutRatio = bpow(poolRatio, bdiv(BONE, normalizedWeight));
        uint256 newTokenBalanceOut = bmul(tokenOutRatio, tokenBalanceOut);
        uint256 tokenAmountOutBeforeSwapFee = tokenBalanceOut - newTokenBalanceOut;
        uint256 zaz = bmul((BONE - normalizedWeight), swapFee); 
        tokenAmountOut = bmul(tokenAmountOutBeforeSwapFee,(BONE - zaz));
        return tokenAmountOut;
    }

    /**********************************************************************************************
    // calcPoolInGivenSingleOut                                                                  //
    // pAi = poolAmountIn               // /               tAo             \\     / wO \     \   //
    // bO = tokenBalanceOut            // | bO - -------------------------- |\   | ---- |     \  //
    // tAo = tokenAmountOut      pS - ||   \     1 - ((1 - (tO / tW)) * sF)/  | ^ \ tW /  * pS | //
    // ps = poolSupply                 \\ -----------------------------------/                /  //
    // wO = tokenWeightOut  pAi =       \\               bO                 /                /   //
    // tW = totalWeight           -------------------------------------------------------------  //
    // sF = swapFee                                        ( 1 - eF )                            //
    // eF = exitFee                                                                              //
    **********************************************************************************************/
    function calcPoolInGivenSingleOut(
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 poolSupply,
        uint256 totalWeight,
        uint256 tokenAmountOut,
        uint256 swapFee
    )
        public pure
        returns (uint256 poolAmountIn)
    {
        uint256 normalizedWeight = bdiv(tokenWeightOut, totalWeight);
        uint256 zoo = BONE - normalizedWeight;
        uint256 zar = bmul(zoo, swapFee); 
        uint256 tokenAmountOutBeforeSwapFee = bdiv(tokenAmountOut, BONE - zar);
        uint256 newTokenBalanceOut = tokenBalanceOut - tokenAmountOutBeforeSwapFee;
        uint256 tokenOutRatio = bdiv(newTokenBalanceOut, tokenBalanceOut);
        uint256 poolRatio = bpow(tokenOutRatio, normalizedWeight);
        uint256 newPoolSupply = bmul(poolRatio, poolSupply);
        uint256 poolAmountInAfterExitFee = poolSupply - newPoolSupply;
        poolAmountIn = bdiv(poolAmountInAfterExitFee,BONE);
        return poolAmountIn;
    }

    function btoi(uint256 a) internal pure returns (uint256){
        return a / BONE;
    }

    function bfloor(uint256 a) internal pure returns (uint256){
        return btoi(a) * BONE;
    }

    // DSMath.wpow
    function bpowi(uint256 a, uint256 n) internal pure returns (uint256){
        uint256 z = n % 2 != 0 ? a : BONE;
        for (n /= 2; n != 0; n /= 2) {
            a = bmul(a, a);
            if (n % 2 != 0) {
                z = bmul(z, a);
            }
        }
        return z;
    }
    // Compute b^(e.w) by splitting it into (b^e)*(b^0.w).
    // Use `bpowi` for `b^e` and `bpowK` for k iterations
    // of approximation of b^0.w
    function bpow(uint256 base, uint256 exp) internal pure returns (uint256){
        require(base >= MIN_BPOW_BASE, "ERR_BPOW_BASE_TOO_LOW");
        require(base <= MAX_BPOW_BASE, "ERR_BPOW_BASE_TOO_HIGH");
        uint256 whole  = bfloor(exp);   
        uint256 remain = bsub(exp, whole);
        uint256 wholePow = bpowi(base, btoi(whole));
        if (remain == 0) {
            return wholePow;
        }
        uint256 partialResult = bpowApprox(base, remain, BPOW_PRECISION);
        return bmul(wholePow, partialResult);
    }

    function bpowApprox(uint256 base, uint256 exp, uint256 precision) 
            internal 
            pure 
            returns (uint256)
        {
        uint256 a     = exp;
        (uint256 x, bool xneg)  = bsubSign(base, BONE);
        uint256 term = BONE;
        uint256 sum   = term;
        bool negative = false;
        // term(k) = numer / denom 
        //         = (product(a - i - 1, i=1-->k) * x^k) / (k!)
        // each iteration, multiply previous term by (a-(k-1)) * x / k
        // continue until term is less than precision
        for (uint256 i = 1; term >= precision; i++) {
            uint256 bigK = i * BONE;
            (uint256 c, bool cneg) = bsubSign(a, bsub(bigK, BONE));
            term = bmul(term, bmul(c, x));
            term = bdiv(term, bigK);
            if (term == 0) break;
            if (xneg) negative = !negative;
            if (cneg) negative = !negative;
            if (negative) {
                sum = bsub(sum, term);
            } else {
                sum = badd(sum, term);
            }
        }
        return sum;
    }

    function bsubSign(uint256 a, uint256 b) internal pure returns (uint256, bool){
        if (a >= b) {
            return (a - b, false);
        } else {
            return (b - a, true);
        }
    }

    function bmul(uint256 a, uint256 b) internal pure returns (uint256){
        uint256 c0 = a * b;
        require(a == 0 || c0 / a == b, "ERR_MUL_OVERFLOW");
        uint256 c1 = c0 + (BONE / 2);
        require(c1 >= c0, "ERR_MUL_OVERFLOW");
        uint256 c2 = c1 / BONE;
        return c2;
    }

    function bdiv(uint256 a, uint256 b) internal pure returns (uint256){
        require(b != 0, "ERR_DIV_ZERO");
        uint256 c0 = a * BONE;
        require(a == 0 || c0 / a == BONE, "ERR_DIV_INTERNAL"); // bmul overflow
        uint256 c1 = c0 + (b / 2);
        require(c1 >= c0, "ERR_DIV_INTERNAL"); //  badd require
        uint256 c2 = c1 / b;
        return c2;
    }

    function bsub(uint256 a, uint256 b) internal pure returns (uint256){
        (uint256 c, bool flag) = bsubSign(a, b);
        require(!flag, "ERR_SUB_UNDERFLOW");
        return c;
    }

    function badd(uint256 a, uint256 b) internal pure returns (uint256){
        uint256 c = a + b;
        require(c >= a, "ERR_ADD_OVERFLOW");
        return c;
    }
}
