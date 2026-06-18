# Receipt API Addendum: Overpayment Adjustment

This note only covers the latest change: using signed receipt allocations to adjust a previous overpayment against a new bill.

## What Changed

Receipt create and edit now support negative `allocatedAmount` rows, but only for adjusting an already overpaid bill.

Do not send a negative `totalAmount`. `totalAmount` must remain the actual cash/bank amount received in the current receipt.

Supported endpoints:

```http
POST /accounting/receipts
PUT /accounting/receipts/:receiptPathId
```

## Example

Scenario:

- Old bill `INV-1001`: bill amount `10000`, already allocated `12000`
- Available overpayment: `2000`
- New bill `INV-1002`: amount `7000`
- Customer pays only `5000` now
- The remaining `2000` is adjusted from the old overpayment

Payload:

```json
{
  "customerId": "mongo-customer-id",
  "totalAmount": 5000,
  "paymentMethod": "NEFT_RTGS",
  "bankId": "mongo-bank-id",
  "utrNumber": "UTR123",
  "voucherDate": "2026-06-06",
  "allocations": [
    {
      "billId": "old-overpaid-bill-uuid",
      "allocatedAmount": -2000,
      "narration": "Adjusted previous overpayment"
    },
    {
      "billId": "new-bill-uuid",
      "allocatedAmount": 7000,
      "narration": "Payment plus overpayment adjustment"
    }
  ]
}
```

Result:

- Allocation sum is `-2000 + 7000 = 5000`
- Receipt ledger records only `5000` as new bank/cash receipt
- Old bill allocation reduces by `2000`
- New bill allocation increases by `7000`

## Validation Rules

- Negative allocation must have a `billId`.
- Negative allocation is allowed only against an already overpaid bill.
- Negative allocation cannot exceed that bill's available overpaid amount.
- On-account rows where `billId` is `null` cannot be negative.
- `allocatedAmount` cannot be `0`.
- Total allocation sum cannot exceed `totalAmount`.

## UI Notes

- Include `OVERPAID` bills in the bill picker when the user needs to adjust previous excess payment.
- Show available overpayment as `allocatedAmount - billAmount`.
- Prevent the user from entering a negative adjustment larger than the available overpayment.
- Keep `totalAmount` as the actual received amount only.

## Common Error

```json
{
  "success": false,
  "message": "Negative allocation 3000 exceeds overpaid amount 2000 for bill INV-1001"
}
```
