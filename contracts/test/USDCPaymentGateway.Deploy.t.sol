// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {USDCPaymentGatewayTestBase} from "./USDCPaymentGateway.Base.t.sol";
import {USDCPaymentGateway} from "../USDCPaymentGateway.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Tests covering deployment, initialization, and constructor validation.
contract USDCPaymentGatewayDeployTest is USDCPaymentGatewayTestBase {

    // ── Happy-path initialization ──────────────────────────────────────────

    function test_Deploy_SetsOwner() public view {
        assertEq(gateway.owner(), deployer);
    }

    function test_Deploy_SetsUsdcToken() public view {
        assertEq(gateway.USDC_TOKEN(), USDC_ADDR);
    }

    function test_Deploy_SetsTreasury() public view {
        assertEq(gateway.TREASURY(), treasury);
    }

    function test_Deploy_SetsOperatorSigner() public view {
        assertEq(gateway.operatorSigner(), operatorSigner);
    }

    function test_Deploy_SetsChainId() public view {
        assertEq(gateway.CHAIN_ID(), block.chainid);
    }

    function test_Deploy_DomainSeparatorMatchesExpected() public view {
        assertEq(gateway.domainSeparator(), _domainSeparator());
    }

    function test_Deploy_InitialNoncesUnused() public view {
        assertFalse(gateway.usedNonces(keccak256("any-nonce")));
    }

    function test_Deploy_InitialInvoicesUnpaid() public view {
        assertFalse(gateway.paidInvoices(keccak256("any-invoice")));
    }

    // ── Constructor ZeroAddress reverts ────────────────────────────────────

    function test_Constructor_RevertsOnZeroUsdcToken() public {
        vm.expectRevert(USDCPaymentGateway.ZeroAddress.selector);
        new USDCPaymentGateway(address(0), treasury, operatorSigner);
    }

    function test_Constructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(USDCPaymentGateway.ZeroAddress.selector);
        new USDCPaymentGateway(USDC_ADDR, address(0), operatorSigner);
    }

    function test_Constructor_RevertsOnZeroOperatorSigner() public {
        vm.expectRevert(USDCPaymentGateway.ZeroAddress.selector);
        new USDCPaymentGateway(USDC_ADDR, treasury, address(0));
    }

    function test_Constructor_RevertsOnTokenWithNoCode() public {
        // Use an address that has no code deployed (but is non-zero).
        address noCode = makeAddr("no-code-token");
        vm.expectRevert(USDCPaymentGateway.InvalidToken.selector);
        new USDCPaymentGateway(noCode, treasury, operatorSigner);
    }
}
