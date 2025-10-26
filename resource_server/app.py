from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import datetime
from typing import Any, Dict, Tuple

import requests
from flask import Flask, jsonify, make_response, render_template, request


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

app = Flask(__name__, static_folder="static", template_folder="templates")


# ---- Simple config for the demo ----
ASSET_USDM_MAINNET = (
    "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad"
)
NETWORK = "cardano-mainnet"
# Updated recipient address as requested
PAY_TO = (
    "addr1q9m755p8q86d5rntr4wgn946jnz3uzt0a3p6028y4rpyjlh7k8mljp5j533gdxpk4krjeecmnzj7djrffs5jmu29ylmq7lye8k"
)
RESOURCE_URL = "/"  # protected resource is the root URL
MAX_TIMEOUT_SECONDS = 600
FACILITATOR_URL = os.environ.get("FACILITATOR_URL", "http://127.0.0.1:5051")
NMKR_API_TOKEN = os.environ.get("NMKR_API_TOKEN", "")
# Provided MintAndSendSpecific pattern (project/policy/qty/address?blockchain=Cardano)
NMKR_MINT_URL_TMPL = (
    "https://studio-api.nmkr.io/v2/MintAndSendSpecific/"
    "138fa984-45b2-4b3e-ab3a-489228bbe64b/"
    "f1928a69-cff1-43b7-9765-727bebf6dc78/100/{addr}?blockchain=Cardano"
)

# Track minted transactions to avoid double-calling (in-memory)
_MINTED_TX: set[str] = set()


def payment_requirements() -> Dict[str, Any]:
    return {
        "x402Version": 1,
        "error": "X-PAYMENT header is required",
        "accepts": [
            {
                "scheme": "exact",
                "network": NETWORK,
                # This USDM uses 6 decimals (1e6 units per 1 token)
                # Request exactly 2 USDM (2,000,000 units)
                "maxAmountRequired": "2000000",
                "asset": ASSET_USDM_MAINNET,
                "payTo": PAY_TO,
                "resource": RESOURCE_URL,
                "description": "Access to premium market data",
                "mimeType": "application/json",
                "outputSchema": None,
                "maxTimeoutSeconds": MAX_TIMEOUT_SECONDS,
                "extra": {
                    # Provide hints for client construction (no remote lookup)
                    # Asset Name Hex supplied by user: (333) USDM (0014df105553444d)
                    "assetNameHex": "0014df105553444d",
                    "assetFingerprint": "asset12ffdj8kk2w485sr7a5ekmjjdyecz8ps2cm5zed",
                    "decimals": 6,
                },
            }
        ],
    }


def b64_json_decode(b64_value: str) -> Dict[str, Any]:
    data = base64.b64decode(b64_value)
    return json.loads(data.decode("utf-8"))


def b64_json_encode(obj: Dict[str, Any]) -> str:
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def maybe_mint_for_tx(tx_id: str, payer_addr: str | None) -> None:
    try:
        if not tx_id or not payer_addr:
            return
        if tx_id in _MINTED_TX:
            return
        if not NMKR_API_TOKEN:
            return
        url = NMKR_MINT_URL_TMPL.format(addr=payer_addr)
        headers = {
            "accept": "text/plain",
            "Authorization": f"Bearer {NMKR_API_TOKEN}",
        }
        # Best-effort; do not block the response path too long
        try:
            requests.get(url, headers=headers, timeout=10)
        except Exception:
            # swallow errors in demo environment
            pass
        _MINTED_TX.add(tx_id)
    except Exception:
        pass


def decode_x_payment_header() -> Tuple[Dict[str, Any] | None, str | None]:
    x_payment_b64 = request.headers.get("X-PAYMENT")
    if not x_payment_b64:
        return None, "missing"
    try:
        decoded = b64_json_decode(x_payment_b64)
        return decoded, None
    except Exception as e:  # noqa: BLE001 - demo simplicity
        return None, f"invalid: {e}"


def facilitator_verify(x_payment_b64: str, requirements: Dict[str, Any]) -> Tuple[bool, str | None]:
    try:
        r = requests.post(
            f"{FACILITATOR_URL}/verify",
            json={"x_payment_b64": x_payment_b64, "payment_requirements": requirements},
            timeout=15,
        )
        data = r.json() if r.ok else {"isValid": False, "invalidReason": f"HTTP {r.status_code}"}
        return bool(data.get("isValid")), data.get("invalidReason")
    except Exception as e:
        return False, str(e)


def facilitator_settle(x_payment_b64: str, requirements: Dict[str, Any]) -> Tuple[bool, str | None, str | None]:
    try:
        r = requests.post(
            f"{FACILITATOR_URL}/settle",
            json={"x_payment_b64": x_payment_b64, "payment_requirements": requirements},
            timeout=60,
        )
        if not r.ok:
            # Pending responses may come with 202
            if r.status_code == 202:
                data = r.json()
                return False, data.get("transaction"), "invalid_transaction_state"
            return False, None, f"HTTP {r.status_code}"
        data = r.json()
        if data.get("success"):
            return True, data.get("transaction"), None
        # Could be pending
        if r.status_code == 202 or data.get("pending"):
            return False, data.get("transaction"), data.get("errorReason") or "invalid_transaction_state"
        return False, None, data.get("errorReason") or "settlement failed"
    except Exception as e:
        return False, None, str(e)


def make_payment_required_page(reason: str | None = None):
    # Return the UI page with a 402 status and embed requirements
    reqs = payment_requirements()
    bf_key = os.environ.get("BLOCKFROST_PROJECT_ID", "")
    resp = make_response(render_template("index.html", requirements=reqs, bf_key=bf_key), 402)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    if reason:
        resp.headers["X-PAYMENT-ERROR"] = reason[:200]
    return resp


@app.route("/client")
def client_page():
    # Serve the same UI but with 200 status (for testing)
    return render_template(
        "index.html",
        requirements=payment_requirements(),
        bf_key=os.environ.get("BLOCKFROST_PROJECT_ID", ""),
    )


@app.route("/", methods=["GET"])  # Protected resource at root
def protected_root():
    # If a tx hash is provided, check settlement status first (no resubmission)
    tx_qs = (request.args.get("tx") or "").strip()
    if tx_qs:
        reqs = payment_requirements()
        try:
            r = requests.post(
                f"{FACILITATOR_URL}/status",
                json={"transaction": tx_qs, "payment_requirements": reqs},
                timeout=15,
            )
            data = r.json() if r.content else {}
            if r.status_code == 200 and data.get("success"):
                # Mint once on success
                payer_addr = request.headers.get("X-PAYER-ADDRESS", "").strip()
                maybe_mint_for_tx(tx_qs, payer_addr)
                content = {
                    "message": "You’ve unlocked the protected resource via x402.",
                    "resource": "/",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
                resp = make_response(jsonify(content), 200)
                payment_response = {"success": "true", "network": NETWORK, "transaction": tx_qs}
                resp.headers["X-PAYMENT-RESPONSE"] = b64_json_encode(payment_response)
                return resp
            # Pending
            return make_response(jsonify({"pending": True, "transaction": tx_qs}), 202)
        except Exception:
            return make_payment_required_page("invalid_transaction_state")

    # We forward the original base64 header to the facilitator
    x_payment_b64 = request.headers.get("X-PAYMENT")
    if not x_payment_b64:
        # No or invalid header: show UI with 402
        return make_payment_required_page("missing")

    # Forward to facilitator verify
    reqs = payment_requirements()
    valid, reason = facilitator_verify(x_payment_b64, reqs)
    if not valid:
        return make_payment_required_page(reason)

    # Settle the transaction (may be pending)
    settled, tx_id, err = facilitator_settle(x_payment_b64, reqs)
    if not settled:
        # Inform client it's pending so it can poll status
        body = {"pending": True, "transaction": tx_id or "", "retryAfterSeconds": 10}
        return make_response(jsonify(body), 202)

    # Success: return the premium content and include X-PAYMENT-RESPONSE header
    # Mint once on success
    payer_addr = request.headers.get("X-PAYER-ADDRESS", "").strip()
    maybe_mint_for_tx(tx_id or "", payer_addr)
    content = {
        "message": "You’ve unlocked the protected resource via x402.",
        "resource": "/",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    resp = make_response(jsonify(content), 200)
    payment_response = {"success": "true", "network": NETWORK, "transaction": tx_id}
    resp.headers["X-PAYMENT-RESPONSE"] = b64_json_encode(payment_response)
    return resp




@app.get("/status")
def status_proxy():
    tx = request.args.get("tx", "").strip()
    if not tx:
        return jsonify({"success": False, "errorReason": "invalid_payload"}), 400
    reqs = payment_requirements()
    try:
        r = requests.post(
            f"{FACILITATOR_URL}/status",
            json={"transaction": tx, "payment_requirements": reqs},
            timeout=15,
        )
        data = r.json() if r.content else {}
        if r.status_code == 202 or data.get("pending"):
            return make_response(jsonify({"pending": True, "transaction": tx}), 202)
        if data.get("success"):
            return jsonify({"success": True, "transaction": tx, "network": data.get("network")}), 200
        return jsonify({"success": False, "errorReason": data.get("errorReason") or "invalid_transaction_state"}), 200
    except Exception as e:
        return jsonify({"success": False, "errorReason": "unexpected_settle_error"}), 200


# (Mock facilitator endpoints removed in minimal build; verification is in-process and mocked.)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
