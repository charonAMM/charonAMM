//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

contract Math{
    uint public constant BONE              = 10**18;
    uint public constant EXIT_FEE          = 0;
    uint public constant MIN_WEIGHT        = BONE;
    uint public constant MAX_WEIGHT        = BONE * 50;
    uint public constant MAX_TOTAL_WEIGHT  = BONE * 50;
    uint public constant MIN_BALANCE       = BONE / 10**12;
    uint public constant INIT_POOL_SUPPLY  = BONE * 100;
    uint public constant MIN_BPOW_BASE     = 1 wei;
    uint public constant MAX_BPOW_BASE     = (2 * BONE) - 1 wei;
    uint public constant BPOW_PRECISION    = BONE / 10**10;
    uint public constant MAX_IN_RATIO      = BONE / 2;
    uint public constant MAX_OUT_RATIO     = (BONE / 3) + 1 wei;

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
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint swapFee
    )
        public pure
        returns (uint spotPrice)
    {
        uint numer = tokenBalanceIn - tokenWeightIn;
        uint denom = tokenBalanceOut - tokenWeightOut;
        uint ratio =  numer / denom;
        uint scale = BONE / (BONE - swapFee);//10e18/(10e18-fee)
        return (spotPrice = ratio * scale);
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
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint tokenAmountIn,
        uint swapFee
    )
        public pure
        returns (uint tokenAmountOut)
    {
        uint weightRatio = tokenWeightIn / tokenWeightOut;
        uint adjustedIn = BONE - swapFee;
        adjustedIn = tokenAmountIn * adjustedIn;
        uint y = tokenBalanceIn / (tokenBalanceIn + adjustedIn);
        uint foo = bpow(y, weightRatio);
        uint bar = BONE - foo;
        tokenAmountOut = tokenBalanceOut * bar;
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
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint tokenAmountOut,
        uint swapFee
    )
        public pure
        returns (uint tokenAmountIn)
    {
        uint weightRatio = tokenWeightOut / tokenWeightIn;
        uint diff = tokenBalanceOut - tokenAmountOut;
        uint y = tokenBalanceOut / diff;
        uint foo = bpow(y, weightRatio);
        foo = foo - BONE;
        tokenAmountIn = BONE - swapFee;
        tokenAmountIn = (tokenBalanceIn * foo) / tokenAmountIn;
        return tokenAmountIn;
    }

    /**********************************************************************************************
    // calcPoolOutGivenSingleIn                                                                  //
    // pAo = poolAmountOut         /                                              \              //
    // tAi = tokenAmountIn        ///      /     //    wI \      \\       \     wI \             //
    // wI = tokenWeightIn        //| tAi *| 1 - || 1 - --  | * sF || + tBi \    --  \            //
    // tW = totalWeight     pAo=||  \      \     \\    tW /      //         | ^ tW   | * pS - pS //
    // tBi = tokenBalanceIn      \\  ------------------------------------- /        /            //
    // pS = poolSupply            \\                    tBi               /        /             //
    // sF = swapFee                \                                              /              //
    **********************************************************************************************/
    function calcPoolOutGivenSingleIn(
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint poolSupply,
        uint totalWeight,
        uint tokenAmountIn,
        uint swapFee
    )
        public pure
        returns (uint poolAmountOut)
    {
        // Charge the trading fee for the proportion of tokenAi
        ///  which is implicitly traded to the other pool tokens.
        // That proportion is (1- weightTokenIn)
        // tokenAiAfterFee = tAi * (1 - (1-weightTi) * poolFee);
        uint normalizedWeight = tokenWeightIn/totalWeight;
        uint zaz = BONE - normalizedWeight * swapFee ; 
        uint tokenAmountInAfterFee = tokenAmountIn * (BONE - zaz);
        uint newTokenBalanceIn = tokenBalanceIn + tokenAmountInAfterFee;
        uint tokenInRatio = newTokenBalanceIn / tokenBalanceIn;
        uint poolRatio = bpow(tokenInRatio, normalizedWeight);
        uint newPoolSupply =  poolRatio * poolSupply;
        poolAmountOut = newPoolSupply - poolSupply;
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
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint poolSupply,
        uint totalWeight,
        uint poolAmountOut,
        uint swapFee
    )
        public pure
        returns (uint tokenAmountIn)
    {
        uint normalizedWeight = tokenWeightIn / totalWeight;
        uint newPoolSupply = poolSupply + poolAmountOut;
        uint poolRatio = newPoolSupply / poolSupply;
        //uint newBalTi = poolRatio^(1/weightTi) * balTi;
        uint boo = BONE / normalizedWeight; 
        uint tokenInRatio = bpow(poolRatio, boo);
        uint newTokenBalanceIn = tokenInRatio * tokenBalanceIn;
        uint tokenAmountInAfterFee = newTokenBalanceIn - tokenBalanceIn;
        // Do reverse order of fees charged in joinswap_ExternAmountIn, this way 
        //     ``` pAo == joinswap_ExternAmountIn(Ti, joinswap_PoolAmountOut(pAo, Ti)) ```
        //uint tAi = tAiAfterFee / (1 - (1-weightTi) * swapFee) ;
        uint zar = (BONE-normalizedWeight) * swapFee;
        tokenAmountIn = tokenAmountInAfterFee / (BONE - zar);
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
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint poolSupply,
        uint totalWeight,
        uint poolAmountIn,
        uint swapFee
    )
        public pure
        returns (uint tokenAmountOut)
    {
        uint normalizedWeight = tokenWeightOut / totalWeight;
        // charge exit fee on the pool token side
        uint poolAmountInAfterExitFee = poolAmountIn * (BONE - EXIT_FEE);
        uint newPoolSupply = poolSupply - poolAmountInAfterExitFee;
        uint poolRatio = newPoolSupply / poolSupply;
        uint tokenOutRatio = bpow(poolRatio, BONE/normalizedWeight);
        uint newTokenBalanceOut = tokenOutRatio * tokenBalanceOut;
        uint tokenAmountOutBeforeSwapFee = tokenBalanceOut - newTokenBalanceOut;
        // charge swap fee on the output token side 
        uint zaz = (BONE - normalizedWeight) * swapFee; 
        tokenAmountOut = tokenAmountOutBeforeSwapFee * (BONE - zaz);
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
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint poolSupply,
        uint totalWeight,
        uint tokenAmountOut,
        uint swapFee
    )
        public pure
        returns (uint poolAmountIn)
    {

        // charge swap fee on the output token side 
        uint normalizedWeight = tokenWeightOut / totalWeight;
        //uint tAoBeforeSwapFee = tAo / (1 - (1-weightTo) * swapFee) ;
        uint zoo = BONE - normalizedWeight;
        uint zar = zoo * swapFee; 
        uint tokenAmountOutBeforeSwapFee = tokenAmountOut / (BONE - zar);
        uint newTokenBalanceOut = tokenBalanceOut - tokenAmountOutBeforeSwapFee;
        uint tokenOutRatio = newTokenBalanceOut / tokenBalanceOut;
        uint poolRatio = bpow(tokenOutRatio, normalizedWeight);
        uint newPoolSupply = poolRatio * poolSupply;
        uint poolAmountInAfterExitFee = poolSupply - newPoolSupply;
        // charge exit fee on the pool token side
        poolAmountIn = poolAmountInAfterExitFee / (BONE - EXIT_FEE);
        return poolAmountIn;
    }

    function btoi(uint a) internal pure returns (uint){
        return a / BONE;
    }

    function bfloor(uint a) internal pure returns (uint){
        return btoi(a) * BONE;
    }

    // DSMath.wpow
    function bpowi(uint a, uint n)
        internal pure
        returns (uint z)
    {
        z = n % 2 != 0 ? a : BONE;
        for (n /= 2; n != 0; n /= 2) {
            a = a * a;
            if (n % 2 != 0) {
                z = z * a;
            }
        }
    }

    // Compute b^(e.w) by splitting it into (b^e)*(b^0.w).
    // Use `bpowi` for `b^e` and `bpowK` for k iterations
    // of approximation of b^0.w
    function bpow(uint base, uint exp)
        internal pure
        returns (uint)
    {
        require(base >= MIN_BPOW_BASE, "ERR_BPOW_BASE_TOO_LOW");
        require(base <= MAX_BPOW_BASE, "ERR_BPOW_BASE_TOO_HIGH");
        uint whole  = bfloor(exp);   
        uint remain = exp - whole;
        uint wholePow = bpowi(base, btoi(whole));
        if (remain == 0) {
            return wholePow;
        }
        uint partialResult = bpowApprox(base, remain, BPOW_PRECISION);
        return (wholePow * partialResult);
    }

    function bpowApprox(uint base, uint exp, uint precision)
        internal pure
        returns (uint)
    {
        // term 0:
        uint a     = exp;
        (uint x, bool xneg)  = bsubSign(base, BONE);
        uint term = BONE;
        uint sum   = term;
        bool negative = false;
        // term(k) = numer / denom 
        //         = (product(a - i - 1, i=1-->k) * x^k) / (k!)
        // each iteration, multiply previous term by (a-(k-1)) * x / k
        // continue until term is less than precision
        for (uint i = 1; term >= precision; i++) {
            uint bigK = i * BONE;
            (uint c, bool cneg) = bsubSign(a, bigK - BONE);
            term = term * c * x;
            term = term / bigK;
            if (term == 0) break;
            if (xneg) negative = !negative;
            if (cneg) negative = !negative;
            if (negative) {
                sum -= term;
            } else {
                sum += term;
            }
        }
        return sum;
    }

    function bsubSign(uint a, uint b)
        internal pure
        returns (uint, bool)
    {
        if (a >= b) {
            return (a - b, false);
        } else {
            return (b - a, true);
        }
    }

}
