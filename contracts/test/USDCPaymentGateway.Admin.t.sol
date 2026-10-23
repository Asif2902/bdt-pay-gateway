// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {USDCPaymentGatewayTestBase} from "./USDCPaymentGateway.Base.t.sol";
import {USDCPaymentGateway} from "../USDCPaymentGateway.sol";

/// @dev Tests covering admin functions: setOperatorSigner, setTreasury,
///      transferOwnership — happy paths, access control, and zero-address guards.
contract USDCPaymentGatewayAdminTest is USDCPaymentGatewayTestBase {

    address internal newSigner   = makeAddr("newSigner");
    address internal newTreasury = makeAddr("newTreasury");
    address internal newOwner    = makeAddr("newOwner");

    // ── setOperatorSigner ──────────────────────────────────────────────────

    function test_SetOperatorSigner_OwnerCanUpdate() public {
        vm.prank(deployer);
        gateway.setOperatorSigner(newSigner);
        assertEq(gateway.operatorSigner(), newSigner);
    }

    function test_SetOperatorSigner_EmitsEvent() public {
        vm.prank(deployer);
        vm.expectEmit(true, true, false, false, address(gateway));
        emit USDCPaymentGateway.OperatorSignerUpdated(operatorSigner, newSigner);
        gateway.setOperatorSigner(newSigner);
    }

    function test_SetOperatorSigner_NonOwnerReverts() public {
        vm.prank(attacker);
        vm.expectRevert(USDCPaymentGateway.Unauthorized.selector);
        gateway.setOperatorSigner(newSigner);
    }

    function test_SetOperatorSigner_RevertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(USDCPaymentGateway.ZeroAddress.selector);
        gateway.setOperatorSigner(address(0));
    }

    function test_SetOperatorSigner_NewSignerCanAuthorize() public {
        // Transfer signer role to newSigner (with a new private key).
        uint256 newSignerPk = 0xABCD1234;
        address newSignerAddr = vm.addr(newSignerPk);

        vm.prank(deployer);
        gateway.setOperatorSigner(newSignerAddr);

        // Payment signed by newSigner should succeed.
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(newSignerPk, auth);

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertTrue(gateway.paidInvoices(auth.invoiceId));
    }

    function test_SetOperatorSigner_OldSignerCanNoLongerAuthorize() public {
        uint256 newSignerPk = 0xABCD1234;
        address newSignerAddr = vm.addr(newSignerPk);

        vm.prank(deployer);
        gateway.setOperatorSigner(newSignerAddr);

        // Signature from old operator key should now fail.
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth); // old key

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvalidSignature.selector);
        gateway.payInvoice(auth, sig);
    }

    // ── setTreasury ────────────────────────────────────────────────────────

    function test_SetTreasury_OwnerCanUpdate() public {
        vm.prank(deployer);
        gateway.setTreasury(newTreasury);
        assertEq(gateway.TREASURY(), newTreasury);
    }

    function test_SetTreasury_EmitsEvent() public {
        vm.prank(deployer);
        vm.expectEmit(true, true, false, false, address(gateway));
        emit USDCPaymentGateway.TreasuryUpdated(treasury, newTreasury);
        gateway.setTreasury(newTreasury);
    }

    function test_SetTreasury_NonOwnerReverts() public {
        vm.prank(attacker);
        vm.expectRevert(USDCPaymentGateway.Unauthorized.selector);
        gateway.setTreasury(newTreasury);
    }

    function test_SetTreasury_RevertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(USDCPaymentGateway.ZeroAddress.selector);
        gateway.setTreasury(address(0));
    }

    function test_SetTreasury_PaymentGoesToNewTreasury() public {
        // Update treasury, then verify payment flows to the new one.
        vm.prank(deployer);
        gateway.setTreasury(newTreasury);

        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertEq(usdc.balanceOf(newTreasury), PAYMENT_AMOUNT, "payment to new treasury");
        assertEq(usdc.balanceOf(treasury),    0,              "old treasury empty");
    }

    // ── transferOwnership ─────────────────────────────────────────────────

    function test_TransferOwnership_OwnerCanTransfer() public {
        vm.prank(deployer);
        gateway.transferOwnership(newOwner);
        assertEq(gateway.owner(), newOwner);
    }

    function test_TransferOwnership_NonOwnerReverts() public {
        vm.prank(attacker);
        vm.expectRevert(USDCPaymentGateway.Unauthorized.selector);
        gateway.transferOwnership(newOwner);
    }

    function test_TransferOwnership_RevertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(USDCPaymentGateway.ZeroAddress.selector);
        gateway.transferOwnership(address(0));
    }

    function test_TransferOwnership_NewOwnerCanCallAdminFunctions() public {
        vm.prank(deployer);
        gateway.transferOwnership(newOwner);

        // newOwner should be able to update the signer.
        vm.prank(newOwner);
        gateway.setOperatorSigner(newSigner);
        assertEq(gateway.operatorSigner(), newSigner);

        // newOwner should be able to update the treasury.
        vm.prank(newOwner);
        gateway.setTreasury(newTreasury);
        assertEq(gateway.TREASURY(), newTreasury);
    }

    function test_TransferOwnership_OldOwnerCanNoLongerCallAdminFunctions() public {
        vm.prank(deployer);
        gateway.transferOwnership(newOwner);

        // Old deployer can no longer call admin functions.
        vm.prank(deployer);
        vm.expectRevert(USDCPaymentGateway.Unauthorized.selector);
        gateway.setOperatorSigner(newSigner);
    }
}
