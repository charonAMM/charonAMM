pragma solidity 0.8.4;

contract CharonMaster is Token{

    uint256 totalFees;

    address[] public sortedCharons; //sorted by tips paid in

    constructor(address _baseImplementation){

    }
    //how do we determine which clones get token issuance?   
    //i guess based on fees...percent of tokens paid to token holders is percent of tokens paid back out
    //how do you handle paying on other chains?  //how do you handle deploying on other chains? 
    //have a factory on each chain...link them in the finalize? 
    //only fee on mainnet...should be fine bc governance token is only on mainnet
    //fees on other chains distributed via tellor passing over balance
    //so LP incentives only on mainnet, but governance token holders get half of reward on each network (maybe have deterministic address)
    //do you make them send to the same address and have tellor pass it over? 

    function mintToContract(address _contract){
        //pays out parties  in Charon contract -- mints governance token to LP's I guess for ease
        //so then when LP's claim CHUSD fee, they also get governance tokens
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