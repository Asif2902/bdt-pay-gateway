// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {USDCPaymentGateway} from "../USDCPaymentGateway.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base for all USDCPaymentGateway test suites.
abstract contract USDCPaymentGatewayTestBase is Test {
    // ── Canonical USDC address on Arc Mainnet ──────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    // ── EIP-712 type hashes (must match contract constants) ────────────────
    bytes32 internal constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant _INVOICE_AUTHORIZATION_TYPEHASH =
        keccak256(
            "InvoiceAuthorization(bytes32 invoiceId,bytes32 merchantId,uint256 amountUsdc,uint256 expiry,bytes32 nonce)"
        );
    bytes32 internal constant _NAME_HASH    = keccak256("USDCPaymentGateway");
    bytes32 internal constant _VERSION_HASH = keccak256("1");

    // ── Actors ─────────────────────────────────────────────────────────────
    address internal deployer  = makeAddr("deployer");
    address internal treasury  = makeAddr("treasury");
    address internal alice     = makeAddr("alice");   // payer
    address internal attacker  = makeAddr("attacker");

    // ── Operator signer keypair (deterministic) ────────────────────────────
    uint256 internal constant OPERATOR_PK = 0xDEADBEEF_CAFEBABE_1234567890ABCDEF_DEADBEEF_CAFEBABE_1234567890ABCDEF;
    address internal operatorSigner;

    // ── Contract handles ───────────────────────────────────────────────────
    MockERC20           internal usdc;
    USDCPaymentGateway  internal gateway;

    // ── Common test amounts ────────────────────────────────────────────────
    uint256 internal constant PAYMENT_AMOUNT = 100e6; // 100 USDC (6 decimals)
    uint256 internal constant ALICE_BALANCE  = 1_000e6;

    // ──────────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        operatorSigner = vm.addr(OPERATOR_PK);

        // 1. Deploy a MockERC20 at a throwaway address, then etch its code
        //    to the canonical USDC address so the contract's immutable works.
        MockERC20 impl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(impl).code);
        usdc = MockERC20(USDC_ADDR);

        // 2. Deploy the gateway (deployer is owner).
        vm.prank(deployer);
        gateway = new USDCPaymentGateway(USDC_ADDR, treasury, operatorSigner);

        // 3. Seed alice with USDC and pre-approve the gateway.
        usdc.mint(alice, ALICE_BALANCE);
        vm.prank(alice);
        usdc.approve(address(gateway), type(uint256).max);
    }

    // ── EIP-712 helpers ────────────────────────────────────────────────────

    /// @dev Compute the domain separator as the contract does.
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH,
                _NAME_HASH,
                _VERSION_HASH,
                block.chainid,
                address(gateway)
            )
        );
    }

    /// @dev Hash an InvoiceAuthorization struct.
    function _hashAuth(USDCPaymentGateway.InvoiceAuthorization memory auth)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                _INVOICE_AUTHORIZATION_TYPEHASH,
                auth.invoiceId,
                auth.merchantId,
                auth.amountUsdc,
                auth.expiry,
                auth.nonce
            )
        );
    }

    /// @dev Build the full EIP-712 digest for an authorization.
    function _digest(USDCPaymentGateway.InvoiceAuthorization memory auth)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), _hashAuth(auth))
        );
    }

    /// @dev Sign an authorization with the given private key and return a
    ///      packed 65-byte signature (r ++ s ++ v).
    function _sign(uint256 pk, USDCPaymentGateway.InvoiceAuthorization memory auth)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(auth));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Build a default valid authorization (expiry = now + 1 hour).
    function _defaultAuth() internal view returns (USDCPaymentGateway.InvoiceAuthorization memory) {
        return USDCPaymentGateway.InvoiceAuthorization({
            invoiceId:   keccak256("invoice-001"),
            merchantId:  keccak256("merchant-abc"),
            amountUsdc:  PAYMENT_AMOUNT,
            expiry:      block.timestamp + 1 hours,
            nonce:       keccak256("nonce-001")
        });
    }
}
