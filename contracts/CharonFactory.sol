pragma solidity 0.8.4;

//same as main master, but no token, and doesn't mint tokens (obviously)
contract CharonFactory{

    uint256 totalFees;

    address[] public sortedCharons; //sorted by tips paid in

    constructor(address _baseImplementation){

    }

    function recieveFee(uint256 _amount){
        require(isCharonContract);//so people can't pay in more

        //then take in the fee and update the list
    }

    function payGovernanceTokenHolder(address _holder) external{
        //pays out the token holders of the governance token
    }
    

    function clone(address implementation) internal returns (address instance) {
        //add fee....

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, implementation))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "ERC1167: create failed");
        Charon(instance).init();
    }

}