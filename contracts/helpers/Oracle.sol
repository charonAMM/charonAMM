//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;


import "usingTellor/contracts/UsingTellor.sol";
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/libraries/TickMath.sol';

contract Oracle is UsingTellor, IOracle{

    IUniswapV3Pool uniPool;
    uint256 public liquidityThreshold;

    constructor(address _tellor, address _uniPool, uint256 _liquidityThreshold) UsingTellor(_tellor){
        uniPool = IUniswapV3Pool(_uniPool);
    }

    function getPriceData(bytes32 _id) external view returns(uint256){
        bytes memory _value;
        uint256 _timestamp;
        (,_value,_timestamp) = getDataBefore(_id,now - 30 minutes);
        require(block.timestamp - _timestamp <= 1 days, "must be within 1 day old");
        require(_timestamp > 0, "value must exist for timestamp");
        uint256 _tellorPrice = abi.decode(_value,(uint256));
        (uint256 _uniswapPrice, uint256 uniswapTimestamp) = grabUniswapData();
        if(uniswapPool.liquidity() < liquidityThreshold){
            return _tellorPrice
        }
        uint256 _valueDifference = unsignedDifference(_uniswapPrice, _tellorPrice);
        if _valueDifference.mul(100) < (2).mul(_uniswapPrice){ //2% difference or less use uniswap pool
            return _tellorPrice;
        }
        uint256 _timeChange = unsignedDifference(_uniswapTimestamp, _tellorTime);
        if (_timeChange > 24 hours)
            return _tellorPrice;
        } 
        return _uniswapPrice;
    }


    function getCommitment(uint256 _chain, uint256 _id) external view returns(bytes32 _commitment){
        bytes memory _value;
        bool _didGet;
        bytes32 _queryId = keccak256(abi.encode("Charon",abi.encode(_chain,_depositId)));
        (_didGet,_value,) =  getDataBefore(_queryId,block.timestamp - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
        _commitment = abi.decode(_value,(bytes32));
    }

    /**
     * @dev Grabs current Uniswap value and timestamp by determining pool state (offset of 10)
     * @param _pool Uniswap pool object where data is pulled from
     * @return uint256 value of price
     * @return uint256 timestamp of value
     */
    function grabUniswapData() internal view returns (uint256, uint256) {
      (uint160 sqrtPriceX96,, uint16 observationIndex,,,,) = uniPool.slot0();
      uint256 uniswapPrice = uint(sqrtPriceX96).mul(uint(sqrtPriceX96)).mul(1e10) >> (96 * 2);
      (uint32 blockTimestamp,,, bool initialized) = uniPool.observations(observationIndex);
      if (!initialized) return (0, 0);
      return (uniswapPrice, uint256(blockTimestamp));
    }
    /**
     * @dev Calculates a different using unsigned integers, to prevent overflow
     * @param _valueOne first value to subtract
     * @param _valueTwo second value to subtract
     * @return uint256 absolute value difference
     */
    function unsignedDifference(uint256 _valueOne, uint256 _valueTwo) internal pure returns (uint256) {
      if (_valueOne > _valueTwo) {
        return _valueOne.sub(_valueTwo);
      }
      return _valueTwo.sub(_valueOne);
    }
    

}