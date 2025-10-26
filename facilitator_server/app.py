from __future__ import annotations

import base64
import json
import os
import time
from typing import Any, Dict, Tuple

import requests
from flask import Flask, jsonify, request


def load_env_from_file(path: str = ".env"):
    try:
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
    except Exception:
        pass


load_env_from_file()

app = Flask(__name__)


BLOCKFROST_PROJECT_ID = os.environ.get("BLOCKFROST_PROJECT_ID")
NETWORK = os.environ.get("NETWORK", "cardano-mainnet")
BF_BASE = (
    "https://cardano-mainnet.blockfrost.io/api/v0"
    if NETWORK == "cardano-mainnet"
    else "https://cardano-preprod.blockfrost.io/api/v0"
)


def decode_x_payment_b64(x_payment_b64: str) -> Dict[str, Any]:
    raw = base64.b64decode(x_payment_b64)
    return json.loads(raw.decode("utf-8"))


def submit_tx_blockfrost(raw_cbor: bytes) -> Tuple[bool, str | None, str | None]:
    if not BLOCKFROST_PROJECT_ID:
        return False, None, "BLOCKFROST_PROJECT_ID not set"
    url = f"{BF_BASE}/tx/submit"
    headers = {"project_id": BLOCKFROST_PROJECT_ID, "Content-Type": "application/cbor"}
    r = requests.post(url, headers=headers, data=raw_cbor, timeout=30)
    if r.ok:
        return True, r.text.strip().strip('"'), None
    try:
        err = r.json()
    except Exception:
        err = {"status": r.status_code, "body": r.text}
    # Map to x402 error code
    return False, None, "invalid_transaction_state"


def check_tx_output(tx_hash: str, pay_to: str, unit: str, min_amount: int, wait_seconds: int = 20) -> bool:
    if not BLOCKFROST_PROJECT_ID:
        return False
    headers = {"project_id": BLOCKFROST_PROJECT_ID}
    # Poll for UTxOs becoming available
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        utx_url = f"{BF_BASE}/txs/{tx_hash}/utxos"
        r = requests.get(utx_url, headers=headers, timeout=15)
        if r.status_code == 404:
            time.sleep(1.0)
            continue
        if not r.ok:
            time.sleep(1.0)
            continue
        data = r.json()
        for out in data.get("outputs", []):
            if out.get("address") != pay_to:
                continue
            # amounts is a list of {unit, quantity}
            for amt in out.get("amount", []):
                if amt.get("unit") == unit and int(amt.get("quantity", 0)) >= int(min_amount):
                    return True
        time.sleep(1.0)
    return False


@app.post("/verify")
def verify():
    body = request.get_json(silent=True) or {}
    x_payment_b64 = body.get("x_payment_b64")
    reqs = body.get("payment_requirements") or {}
    try:
        x_payment = decode_x_payment_b64(x_payment_b64)
    except Exception as e:
        return jsonify({"isValid": False, "invalidReason": "invalid_payload"}), 200

    # Basic checks
    if x_payment.get("x402Version") != 1:
        return jsonify({"isValid": False, "invalidReason": "invalid_x402_version"}), 200
    if x_payment.get("scheme") != "exact":
        return jsonify({"isValid": False, "invalidReason": "invalid_scheme"}), 200
    net = x_payment.get("network")
    if net not in {"cardano", "cardano-mainnet"}:
        return jsonify({"isValid": False, "invalidReason": "invalid_network"}), 200

    payload = x_payment.get("payload") or {}
    tx_b64 = payload.get("transaction")
    if not isinstance(tx_b64, str) or not tx_b64.strip():
        return jsonify({"isValid": False, "invalidReason": "invalid_payload"}), 200

    # Decode base64 to ensure it is valid CBOR payload; parsing of outputs happens post-submit.
    try:
        base64.b64decode(tx_b64)
    except Exception:
        return jsonify({"isValid": False, "invalidReason": "invalid_payload"}), 200
    except Exception:
        return jsonify({"isValid": False, "invalidReason": "unexpected_verify_error"}), 200

    return jsonify({"isValid": True}), 200


@app.post("/settle")
def settle():
    body = request.get_json(silent=True) or {}
    x_payment_b64 = body.get("x_payment_b64")
    reqs = body.get("payment_requirements") or {}

    try:
        accepts = (reqs.get("accepts") or [])[:1]
    except Exception:
        accepts = []
    if not accepts:
        return jsonify({"success": False, "errorReason": "invalid_payment_requirements", "transaction": ""}), 200
    acc = accepts[0]
    pay_to = acc.get("payTo")
    policy = (acc.get("asset") or "").lower()
    name_hex = ((acc.get("extra") or {}).get("assetNameHex") or "").lower()
    unit = (policy + name_hex)
    min_amt = int(acc.get("maxAmountRequired") or 0)

    try:
        x_payment = decode_x_payment_b64(x_payment_b64)
        tx_b64 = (x_payment.get("payload") or {}).get("transaction")
        raw_cbor = base64.b64decode(tx_b64)
    except Exception:
        return jsonify({"success": False, "errorReason": "invalid_payload", "transaction": ""}), 200

    ok, tx_hash, err = submit_tx_blockfrost(raw_cbor)
    if not ok:
        return jsonify({"success": False, "errorReason": err or "invalid_transaction_state", "transaction": ""}), 200

    # Optional: verify that the transaction contains the right output after it appears on-chain
    verified = check_tx_output(tx_hash, pay_to, unit, min_amt, wait_seconds=20)
    if not verified:
        # Not yet visible/verified on-chain
        return jsonify({"success": False, "errorReason": "invalid_transaction_state", "transaction": tx_hash, "pending": True}), 202

    return jsonify({"success": True, "transaction": tx_hash, "network": NETWORK}), 200


@app.get("/supported")
def supported():
    return jsonify({"kinds": [{"x402Version": 1, "scheme": "exact", "network": NETWORK}]})


@app.post("/status")
def status():
    body = request.get_json(silent=True) or {}
    tx = body.get("transaction")
    reqs = body.get("payment_requirements") or {}
    accepts = (reqs.get("accepts") or [])[:1]
    if not tx or not accepts:
        return jsonify({"success": False, "errorReason": "invalid_payment_requirements", "transaction": tx or ""}), 200
    acc = accepts[0]
    pay_to = acc.get("payTo")
    policy = (acc.get("asset") or "").lower()
    name_hex = ((acc.get("extra") or {}).get("assetNameHex") or "").lower()
    unit = (policy + name_hex)
    min_amt = int(acc.get("maxAmountRequired") or 0)
    try:
        ok = check_tx_output(tx, pay_to, unit, min_amt, wait_seconds=1)
        if ok:
            return jsonify({"success": True, "transaction": tx, "network": NETWORK}), 200
        return jsonify({"success": False, "errorReason": "invalid_transaction_state", "transaction": tx, "pending": True}), 202
    except Exception:
        return jsonify({"success": False, "errorReason": "unexpected_settle_error", "transaction": tx}), 200


@app.get("/health")
def health():
    return jsonify({"ok": True}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5051"))
    app.run(host="0.0.0.0", port=port, debug=True)
