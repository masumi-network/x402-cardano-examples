# x402 Resource Server Demo (Flask)

This is a minimal Flask project showing how to protect a resource with an `x402` Payment Required flow for Cardano, along with a mocked facilitator.

## What it does

- Client requests a protected endpoint: `GET /api/premium-data`.
- Server responds with `402 Payment Required` and a JSON body describing `PaymentRequirementsResponse`.
- Client then "connects" a Cardano wallet (mocked in the UI), constructs an `X-PAYMENT` header containing a base64-encoded JSON payload with a sample transaction, and retries the request.
- Server forwards the payment data to mocked facilitator `verify` and `settle` logic.
- On success, server returns `200` with the resource and an `X-PAYMENT-RESPONSE` header.

This demo does not submit real transactions on-chain; it mocks verification and settlement.

## Run locally

1. Install dependencies

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

2. Start the server

```bash
python app.py
```

3. Open the UI

Visit `http://127.0.0.1:5000/` in your browser.

## Endpoints

- `GET /` – demo page with a simple UI
- `GET /api/premium-data` – protected resource
  - If missing/invalid `X-PAYMENT`, returns `402` with `PaymentRequirementsResponse` JSON.
  - If valid `X-PAYMENT`, returns `200` with premium JSON and sets `X-PAYMENT-RESPONSE` header.
- `POST /mock/verify` – mocked facilitator verification
- `POST /mock/settle` – mocked facilitator settlement

## Headers

### X-PAYMENT (request)

Base64-encoded JSON, minimal example used by the demo UI:

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "cardano",
  "payload": {
    "transaction": "<base64 cardano transaction>"
  }
}
```

### X-PAYMENT-RESPONSE (response)

Base64-encoded JSON:

```json
{
  "success": "true",
  "network": "cardano-mainnet",
  "transaction": "<mock tx id>"
}
```

## Notes

- The UI attempts CIP-30 wallet detection but falls back to a mock connection so you can test without a wallet.
- Payment verification is intentionally minimal—only checks structure and decodability of the transaction.
- Adjust constants in `app.py` (asset, pay-to, network, timeouts) to fit your use case.

