# x402 Cardano Examples (Flask)

Two small Flask services demonstrating the x402 “Payment Required” pattern on Cardano:

- resource_server (UI + paywall): Serves a Windows 98–styled page protected by HTTP 402. It embeds PaymentRequirements and lets a user connect a CIP‑30 wallet, build/sign a Cardano tx (USDM), and unlock the resource once on‑chain.
- facilitator_server (verify + settle): Receives the signed transaction, submits to Cardano (Blockfrost), and reports settlement status.

This is a technical demo (in development). It “mints a meme coin” as a fun success message — not serious, not financial advice.

Links:
- x402: https://www.x402.org/
- Repo: https://github.com/masumi-network/x402-cardano-examples

## Features

- 402 paywall at GET / with embedded PaymentRequirements
- CIP‑30 wallet selection (Nami, Eternl, Lace, Flint, Gero, etc.)
- Lucid + Blockfrost to build/sign/submit the tx in the browser (sign only; submission is server‑side)
- Pending step with progress/countdown + Cardanoscan explorer links
- Unlock only when confirmed on‑chain
- USDM payment of 2 units (2.000000) at 6 decimals

## Requirements

- Python 3.10+
- Blockfrost mainnet project ID
- Desktop browser with Cardano wallet extension (CIP‑30)

## Local setup

1) Install dependencies and create .env

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set your Blockfrost key
```

2) Start facilitator (port from $PORT; defaults to 5051)

```bash
python3 facilitator_server/app.py
```

3) Start resource server (port from $PORT; defaults to 5000)

```bash
python3 resource_server/app.py
```

4) Visit

```
http://127.0.0.1:5000/
```

## Environment variables

Set in .env (and injected in Railway):

- BLOCKFROST_PROJECT_ID: Blockfrost API key (mainnet)
- NETWORK: cardano-mainnet (default)
- FACILITATOR_URL: URL of the facilitator (http://127.0.0.1:5051 when local)
- PORT: for each service (Railway sets this automatically)

## Deployment on Railway (no Docker required)

Railway runs one service per process. We’ll create two services in one project — one for the facilitator and one for the resource server — both from the same repo. Nixpacks will detect Python; you only need to set the root directories and start commands.

Steps (one‑time):

1) Connect the GitHub repo in Railway.

2) Create “facilitator” service
- Root Directory: `facilitator_server`
- Start Command: `python app.py`
- Variables:
  - `BLOCKFROST_PROJECT_ID` = your key (from Blockfrost)
  - `NETWORK` = `cardano-mainnet`
  - (PORT is set by Railway)
- Deploy. Copy the public URL (e.g., `https://facilitator.up.railway.app`).

3) Create “resource” service
- Root Directory: `resource_server`
- Start Command: `python app.py`
- Variables:
  - `FACILITATOR_URL` = facilitator public URL from step 2
  - `NETWORK` = `cardano-mainnet`
  - (PORT is set by Railway)
- Deploy. Open the resource URL in your desktop browser with a Cardano wallet.

Notes:
- You don’t need Docker for this setup. Railway’s Python builder just works.
- The UI runs entirely from the resource server; it posts payment to the resource server, which talks to the facilitator server.
- Ensure the resource server uses the facilitator URL (set the env variable, then redeploy).

## How it works (quick)

- Unpaid request to `/` → 402 with PaymentRequirements (includes asset, amount, payTo, timeout).
- User connects wallet and clicks “Pay & Access” → browser builds/signs the Cardano tx (USDM) and sends it in the `X-PAYMENT` header.
- Resource server calls facilitator `/verify`, then `/settle`.
- Facilitator submits the tx, returns `202 pending` if not yet visible; resource relays that to the UI.
- UI switches to a pending step and polls `/?tx=<hash>` every ~10s until the resource server sees it on‑chain and responds with `200` and the unlocked data.

## Error codes

Facilitator and resource return x402‑style error codes where applicable:

- invalid_x402_version, invalid_scheme, invalid_network
- invalid_payload, invalid_payment_requirements
- invalid_transaction_state (not confirmed or rejected)
- unexpected_verify_error, unexpected_settle_error

## Caveats

- This demo focuses on the x402 loop; it does not handle complex wallet behaviors, nor production security. Treat it as a starting point.
- If you change USDM policy or asset name hex, update resource_server/app.py (PaymentRequirements.extra.assetNameHex).
