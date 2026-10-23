// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {USDCPaymentGatewayTestBase} from "./USDCPaymentGateway.Base.t.sol";
import {USDCPaymentGateway} from "../USDCPaymentGateway.sol";

/// @dev Fuzz tests for key arithmetic and signature properties.
contract USDCPaymentGatewayFuzzTest is USDCPaymentGatewayTestBase {

    /// @dev Fuzz: any valid amount within alice's balance succeeds and the
    ///      treasury receives exactly that amount.
    function testFuzz_PayInvoice_ArbitraryAmount(uint256 amount) public {
        // Bound: 1 unit to alice's full balance (avoid 0-transfer edge cases).
        amount = bound(amount, 1, ALICE_BALANCE);

        USDCPaymentGateway.InvoiceAuthorization memory auth = USDCPaymentGateway.InvoiceAuthorization({
            invoiceId:   keccak256("fuzz-invoice"),
            merchantId:  keccak256("fuzz-merchant"),
            amountUsdc:  amount,
            expiry:      block.timestamp + 1 hours,
            nonce:       keccak256(abi.encode("fuzz-nonce", amount))
        });
        bytes memory sig = _sign(OPERATOR_PK, auth);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(alice);
        gateway.payInvoice(auth, sig);

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, amount, "treasury delta == amount");
    }

    /// @dev Fuzz: any expired timestamp reverts with AuthorizationExpired.
    function testFuzz_PayInvoice_AnyExpiredTimestamp(uint256 expiry) public {
        // Ensure expiry is strictly less than block.timestamp.
        expiry = bound(expiry, 0, block.timestamp - 1);

        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        auth.expiry = expiry;
        bytes memory sig = _sign(OPERATOR_PK, auth);

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.AuthorizationExpired.selector);
        gateway.payInvoice(auth, sig);
    }

    /// @dev Fuzz: a valid authorization signed with any random private key ≠ operator
    ///      always reverts with InvalidSignature.
    function testFuzz_PayInvoice_WrongSignerAlwaysReverts(uint256 wrongPk) public {
        // secp256k1 curve order — private keys must be in [1, ORDER-1].
        uint256 SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        // Bound pk to valid secp256k1 range and exclude the real operator key.
        wrongPk = bound(wrongPk, 1, SECP256K1_ORDER - 1);
        vm.assume(wrongPk != OPERATOR_PK);

        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(wrongPk, auth);

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvalidSignature.selector);
        gateway.payInvoice(auth, sig);
    }

    /// @dev Fuzz: mutating any field of a validly-signed auth invalidates the sig.
    function testFuzz_PayInvoice_TamperedAuthInvalidatesSignature(
        bytes32 fuzzInvoiceId,
        uint256 fuzzAmount
    ) public {
        fuzzAmount = bound(fuzzAmount, 1, type(uint128).max);
        // Ensure at least one field differs from the default auth.
        vm.assume(fuzzInvoiceId != keccak256("invoice-001") || fuzzAmount != PAYMENT_AMOUNT);

        USDCPaymentGateway.InvoiceAuthorization memory auth = _defaultAuth();
        bytes memory sig = _sign(OPERATOR_PK, auth); // sign the ORIGINAL

        // Tamper post-signing.
        auth.invoiceId   = fuzzInvoiceId;
        auth.amountUsdc  = fuzzAmount;

        vm.prank(alice);
        vm.expectRevert(USDCPaymentGateway.InvalidSignature.selector);
        gateway.payInvoice(auth, sig);
    }

    /// @dev Fuzz: unique (invoiceId, nonce) pairs all succeed independently.
    function testFuzz_PayInvoice_UniqueInvoicesAllSucceed(uint8 count) public {
        count = uint8(bound(count, 1, 10)); // cap at 10 payments (gas / balance)
        uint256 perPayment = ALICE_BALANCE / count;

        for (uint256 i = 0; i < count; i++) {
            USDCPaymentGateway.InvoiceAuthorization memory auth = USDCPaymentGateway.InvoiceAuthorization({
                invoiceId:   keccak256(abi.encode("inv", i)),
                merchantId:  keccak256("merchant"),
                amountUsdc:  perPayment,
                expiry:      block.timestamp + 1 hours,
                nonce:       keccak256(abi.encode("nonce", i))
            });
            bytes memory sig = _sign(OPERATOR_PK, auth);

            vm.prank(alice);
            gateway.payInvoice(auth, sig);

            assertTrue(gateway.paidInvoices(auth.invoiceId), "invoice marked paid");
            assertTrue(gateway.usedNonces(auth.nonce),       "nonce marked used");
        }
    }
}
