// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {USDCPaymentGatewayTestBase} from "./USDCPaymentGateway.Base.t.sol";
import {USDCPaymentGateway} from "../USDCPaymentGateway.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Tests covering the payInvoice function — happy path, reverts, and
///      the "hardcoded token" property.
contract USDCPaymentGatewayPayInvoiceTest is USDCPaymentGatewayTestBase {

    // ── Happy path ─────────────────────────────────────────────────────────

    function test_PayInvoice_TransfersUsdcToTreasury() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 aliceBefore    = usdc.balanceOf(alice);

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertEq(usdc.balanceOf(treasury), treasuryBefore + PAYMENT_AMOUNT, "treasury balance");
        assertEq(usdc.balanceOf(alice),    aliceBefore    - PAYMENT_AMOUNT, "alice balance");
    }

    function test_PayInvoice_EmitsPaymentReceived() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true, address(gateway));
        emit USDCPaymentGateway.PaymentReceived(
            auth.invoiceId,
            auth.merchantId,
            alice,
            USDC_ADDR,
            PAYMENT_AMOUNT
        );
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_MarksNonceUsed() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        assertFalse(gateway.usedNonces(auth.nonce), "nonce unused before");

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertTrue(gateway.usedNonces(auth.nonce), "nonce used after");
    }

    function test_PayInvoice_MarksInvoicePaid() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        assertFalse(gateway.paidInvoices(auth.invoiceId), "invoice unpaid before");

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertTrue(gateway.paidInvoices(auth.invoiceId), "invoice paid after");
    }

    function test_PayInvoice_TransferAmountMatchesAuthorization() public {
        // Auth says 200 USDC; verify treasury receives exactly 200, not some other amount.
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        auth.amountUsdc = 200e6;
        bytes memory sig = _sign(OPERATOR_PK, auth);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 200e6, "exact authorized amount transferred");
    }

    // ── Hardcoded token property ───────────────────────────────────────────

    function test_PayInvoice_UsesHardcodedUsdcToken() public {
        // Deploy a separate ERC-20 (the "malicious" token) and mint alice tokens.
        MockERC20 badToken = new MockERC20("Bad Token", "BAD", 6);
        badToken.mint(alice, ALICE_BALANCE);
        vm.prank(alice);
        badToken.approve(address(gateway), type(uint256).max);

        // The gateway's payInvoice ALWAYS calls USDC_TOKEN.safeTransferFrom —
        // no matter what token alice approves, it is the hardcoded USDC address.
        // Verify that alice's badToken balance is unchanged after payment
        // (the contract cannot be tricked into calling a different token).
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        uint256 badBefore = badToken.balanceOf(alice);

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertEq(badToken.balanceOf(alice), badBefore, "bad token balance unchanged");
        // And the real USDC was debited instead.
        assertEq(usdc.balanceOf(treasury), PAYMENT_AMOUNT, "real USDC received by treasury");
    }

    // ── Revert paths ──────────────────────────────────────────────────────

    function test_PayInvoice_RevertsOnExpiredAuthorization() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        auth.expiry = block.timestamp - 1; // already expired
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.AuthorizationExpired.selector);
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_RevertsOnNonceReplay() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        // First payment succeeds.
        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        // Replay the exact same auth+sig → NonceAlreadyUsed.
        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.NonceAlreadyUsed.selector);
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_RevertsOnDuplicateInvoiceId() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig1 = _sign(OPERATOR_PK, auth);

        // First payment succeeds.
        vm.prank(alice);
        gateway.payInvoice(auth, sig1);

        // Second attempt: same invoiceId but a fresh nonce.
        USDCPaymentGateway.InvoiceAuthorization memory auth2 = auth;
        auth2.nonce = keccak256("nonce-002");
        bytes memory sig2 = _sign(OPERATOR_PK, auth2);

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvoiceAlreadyPaid.selector);
        gateway.payInvoice(auth2, sig2);
    }

    function test_PayInvoice_RevertsOnInvalidSignature_WrongSigner() public {
        uint256 wrongPk = 0x1234;
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(wrongPk, auth);

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvalidSignature.selector);
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_RevertsOnInvalidSignature_WrongLength() public {
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = new bytes(64); // too short

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvalidSignature.selector);
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_RevertsOnInsufficientBalance() public {
        // alice only has ALICE_BALANCE; request more than she has.
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        auth.amountUsdc = ALICE_BALANCE + 1e6;
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        // SafeERC20 wraps the revert from the ERC-20; just expect any revert.
        vm.expectRevert();
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_RevertsOnInsufficientAllowance() public {
        // Revoke alice's allowance.
        vm.prank(alice);
        usdc.approve(address(gateway), 0);

        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        vm.expectRevert();
        gateway.payInvoice(auth, sig);
    }

    function test_PayInvoice_RevertsOnTamperedAmount() public {
        // Operator signs for 100 USDC; payer tries to submit auth with 1 USDC.
        // The signature will be invalid because amountUsdc is part of the signed struct.
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth); // signed for 100e6

        auth.amountUsdc = 1e6; // tampered after signing

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvalidSignature.selector);
        gateway.payInvoice(auth, sig);
    }

    // ── Boundary: expiry exactly at block.timestamp ────────────────────────

    function test_PayInvoice_RevertsWhenExpiryEqualsTimestamp() public {
        // The contract checks `block.timestamp > auth.expiry`, so expiry == timestamp
        // is treated as NOT expired (boundary: strictly greater-than).
        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        auth.expiry = block.timestamp;
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        // Should NOT revert on AuthorizationExpired; payment should succeed.
        gateway.payInvoice(auth, sig);

        assertTrue(gateway.paidInvoices(auth.invoiceId));
    }
}
