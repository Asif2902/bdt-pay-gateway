// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract USDCPaymentGateway {
    using SafeERC20 for IERC20;

    struct InvoiceAuthorization {
        bytes32 invoiceId;
        bytes32 merchantId;
        uint256 amountUsdc;
        uint256 expiry;
        bytes32 nonce;
    }

    error InvalidToken();
    error InvoiceAlreadyPaid();
    error NonceAlreadyUsed();
    error AuthorizationExpired();
    error InvalidSignature();
    error ZeroAddress();
    error TransferFailed();
    error Unauthorized();

    event PaymentReceived(
        bytes32 indexed invoiceId,
        bytes32 indexed merchantId,
        address indexed payer,
        address token,
        uint256 amount
    );
    event OperatorSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    address public immutable USDC_TOKEN;
    address public TREASURY;
    address public owner;
    address public operatorSigner;
    uint256 public immutable CHAIN_ID;

    mapping(bytes32 => bool) public usedNonces;
    mapping(bytes32 => bool) public paidInvoices;

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _INVOICE_AUTHORIZATION_TYPEHASH =
        keccak256(
            "InvoiceAuthorization(bytes32 invoiceId,bytes32 merchantId,uint256 amountUsdc,uint256 expiry,bytes32 nonce)"
        );
    bytes32 private constant _NAME_HASH = keccak256("USDCPaymentGateway");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    bytes32 private immutable _DOMAIN_SEPARATOR;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address usdcToken, address treasury, address operatorSigner_) {
        if (usdcToken == address(0) || treasury == address(0) || operatorSigner_ == address(0)) {
            revert ZeroAddress();
        }
        if (usdcToken.code.length == 0) revert InvalidToken();

        USDC_TOKEN = usdcToken;
        TREASURY = treasury;
        operatorSigner = operatorSigner_;
        owner = msg.sender;
        CHAIN_ID = block.chainid;

        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(_EIP712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, CHAIN_ID, address(this))
        );
    }

    function payInvoice(InvoiceAuthorization calldata auth, bytes calldata sig) external {
        if (block.timestamp > auth.expiry) revert AuthorizationExpired();
        if (usedNonces[auth.nonce]) revert NonceAlreadyUsed();
        if (paidInvoices[auth.invoiceId]) revert InvoiceAlreadyPaid();

        bytes32 digest = _hashTypedDataV4(_hashInvoiceAuthorization(auth));
        address recoveredSigner = _recoverSigner(digest, sig);
        if (recoveredSigner != operatorSigner) revert InvalidSignature();

        usedNonces[auth.nonce] = true;
        paidInvoices[auth.invoiceId] = true;

        IERC20(USDC_TOKEN).safeTransferFrom(msg.sender, TREASURY, auth.amountUsdc);

        emit PaymentReceived(auth.invoiceId, auth.merchantId, msg.sender, USDC_TOKEN, auth.amountUsdc);
    }

    function setOperatorSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = operatorSigner;
        operatorSigner = newSigner;
        emit OperatorSignerUpdated(oldSigner, newSigner);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = TREASURY;
        TREASURY = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function domainSeparator() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));
    }

    function _hashInvoiceAuthorization(InvoiceAuthorization calldata auth) internal pure returns (bytes32) {
        return
            keccak256(
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

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }
}
