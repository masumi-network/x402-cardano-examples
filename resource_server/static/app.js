// Minimal front-end for x402 demo

const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const connectBtn = document.getElementById('connectBtn');
const payBtn = document.getElementById('payBtn');
const walletSelect = document.getElementById('walletSelect');
const rescanBtn = document.getElementById('rescanBtn');
const reqSummaryEl = document.getElementById('reqSummary');
const addrBox = document.getElementById('addrBox');
const payProgress = document.getElementById('payProgress');
const payProgressInner = payProgress ? payProgress.querySelector('div') : null;
const progressLabel = document.getElementById('progressLabel');
// Step elements
const stepIntro = document.getElementById('stepIntro');
const stepReqs = document.getElementById('stepReqs');
const stepConnect = document.getElementById('stepConnect');
const stepPay = document.getElementById('stepPay');
const stepPending = document.getElementById('stepPending');
const stepSuccess = document.getElementById('stepSuccess');
const waitProgress = document.getElementById('waitProgress');
const waitProgressInner = waitProgress ? waitProgress.querySelector('div') : null;
const waitLabel = document.getElementById('waitLabel');
const txBox = document.getElementById('txBox');
const checkNowBtn = document.getElementById('checkNowBtn');
const txExplorerLink = document.getElementById('txExplorerLink');
const successExplorerLink = document.getElementById('successExplorerLink');
const introNextBtn = document.getElementById('introNextBtn');
const reqBackBtn = document.getElementById('reqBackBtn');
const reqNextBtn = document.getElementById('reqNextBtn');
const connectBackBtn = document.getElementById('connectBackBtn');
const connectNextBtn = document.getElementById('connectNextBtn');

let connected = false;
let walletId = null; // CIP-30 provider key (e.g., 'nami', 'eternl')
let walletApi = null; // CIP-30 enabled API instance

let debugLines = [];
function appendDebug(msg) {
  try {
    debugLines.push(String(msg));
    if (debugLines.length > 200) debugLines.shift();
  } catch (_) {}
}

const LABELS = {
  nami: 'Nami',
  eternl: 'Eternl',
  lace: 'Lace',
  gerowallet: 'Gero',
  flint: 'Flint',
  yoroi: 'Yoroi',
  vespr: 'Vespr',
  typhoncip30: 'Typhon',
  begin: 'Begin',
};

function listWalletProviders() {
  const providers = [];
  if (window.cardano && typeof window.cardano === 'object') {
    for (const [key, val] of Object.entries(window.cardano)) {
      if (val && typeof val.enable === 'function') {
        const label = (val.name && String(val.name)) || LABELS[key] || key;
        providers.push({ id: key, label });
      }
    }
  }
  // Deterministic order by label
  providers.sort((a, b) => a.label.localeCompare(b.label));
  return providers;
}

function populateWalletSelect() {
  const providers = listWalletProviders();
  walletSelect.innerHTML = '';
  if (providers.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'No wallets detected';
    walletSelect.appendChild(opt);
    hide(connectBtn);
    hide(payBtn);
    return;
  }

  const saved = localStorage.getItem('x402.walletId');
  providers.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    if (saved ? p.id === saved : idx === 0) opt.selected = true;
    walletSelect.appendChild(opt);
  });

  connectBtn.textContent = 'Connect Cardano Wallet';
  show(connectBtn);
}

// Example base64 Cardano transaction (from prompt)
const EXAMPLE_TX_B64 =
  "AAAIAQDi1HwjSnS6M+WGvD73iEyUY2FRKNj0MlRp7+3SHZM3xCvMdB0AAAAAIFRgPKOstGBLCnbcyGoOXugUYAWwVzNrpMjPCzXK4KQWAQCMoE29VLGwftex8rhIlOuFLFNfxLIJlHqGXoXA8hx6l+LMdB0AAAAAIHbPucTRIEWgO6lzqukswPZ6i72IHEKK5LyM1l9HJNZNAQBthSeHDVK8Xr5/zp3JMZPLtG5uAoVgedTA4pEnp+h8qUlUzRwAAAAAIACH0swYW/QfGCFczGnjAVPHPqZrQE5vfvJr36i6KVEFAQAC7W4K5vCwB+nprjxcNlLiOQ7SIIfyCZjmj2qSis2iTsCuzBwAAAAAIAkSUkXOoeq52GNdhwpbs+jZqqrqPdmiN3oPw5EzDIanAQAIyFNGWD6OxiFIyXSxrNEcFG0npm+nImk6InUssXb1EZgx1hwAAAAAILhsjmMKyM0n75Cd7z6ufH2LNhOMibFOGhNlLgV5RFuEAQC+Mh4kGkLwrw/11729oUQnt3xOmOreE6PcnuN6M68ZBcCuzBwAAAAAIO2PQhSSqSAawCbRr005lfjBgFOqIHo4zb2GcQ/WCxAlAAgA+QKVAAAAAAAgjiAHD0X4HNSdVPpJtf2E6W2uRc8kbvCHYkgEQ1B+w1MDAwEAAAUBAQABAgABAwABBAABBQACAQAAAQEGAAEBAgEAAQcAHrfFfj8r0Pxsudz/0UPqlX5NmPgFw1hzP3be4GZ/4LEB5XXrONxGw0qOUsq3yNKeUhOCOgCIwaa4pswKaer66EKqPGwdAAAAACBrOIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1B63xX4/K9D8bLnc/9FD6pV+TZj4BcNYcz923uBmf+Cx7gIAAAAAAABg4xYAAAAAAAA=";

function setStatus(text) {
  statusEl.textContent = text;
}

function show(element) {
  element.style.display = '';
}

function hide(element) {
  element.style.display = 'none';
}

let lastRequirements = null;
let pendingTxId = null;
let pendingTimer = null;
let lastEncodedPaymentHeader = null;

function showStep(which) {
  stepIntro.style.display = which === 'intro' ? '' : 'none';
  stepReqs.style.display = which === 'reqs' ? '' : 'none';
  stepConnect.style.display = which === 'connect' ? '' : 'none';
  stepPay.style.display = which === 'pay' ? '' : 'none';
  if (typeof stepPending !== 'undefined' && stepPending) {
    stepPending.style.display = which === 'pending' ? '' : 'none';
  }
  stepSuccess.style.display = which === 'success' ? '' : 'none';
  if (which === 'pay') {
    show(payBtn);
  } else {
    hide(payBtn);
  }
}

function updateProgress(pct, label) {
  try {
    if (payProgress) payProgress.style.display = '';
    if (payProgressInner) payProgressInner.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (progressLabel) {
      progressLabel.style.display = '';
      if (label) progressLabel.textContent = label;
    }
  } catch (_) {}
}

function hideProgress() {
  try {
    if (payProgress) payProgress.style.display = 'none';
    if (progressLabel) progressLabel.style.display = 'none';
    if (payProgressInner) payProgressInner.style.width = '0%';
  } catch (_) {}
}

function formatQty(units, decimals) {
  try {
    const u = BigInt(units);
    const d = Number(decimals || 0);
    if (d === 0) return u.toString();
    const s = u.toString().padStart(d + 1, '0');
    const head = s.slice(0, -d);
    const tail = s.slice(-d).replace(/0+$/, '');
    return tail ? `${head}.${tail}` : head;
  } catch (_) {
    return units.toString();
  }
}

function updateReqSummary() {
  if (!lastRequirements || !lastRequirements.accepts || !lastRequirements.accepts.length) return;
  const acc = lastRequirements.accepts[0];
  const payTo = acc.payTo;
  const policyId = (acc.asset || '').slice(0, 8) + '…';
  const decimals = (acc.extra && acc.extra.decimals) || 0;
  const qtyUnits = BigInt(acc.maxAmountRequired || '0');
  const qtyHuman = formatQty(qtyUnits, decimals);
  if (reqSummaryEl) reqSummaryEl.textContent = `Pay ${qtyHuman} USDM to ${payTo} on Cardano Mainnet (policy ${policyId}).`;
  try { if (contentEl) contentEl.textContent = JSON.stringify(lastRequirements, null, 2); } catch (_) {}
}

function explorerUrlFor(network, tx) {
  try {
    const n = (network || '').toLowerCase();
    if (n.includes('preprod')) return `https://preprod.cardanoscan.io/transaction/${tx}`;
    return `https://cardanoscan.io/transaction/${tx}`;
  } catch (_) {
    return `https://cardanoscan.io/transaction/${tx}`;
  }
}

async function fetchResource(withPayment = false, xPaymentB64 = null) {
  setStatus('Requesting resource...');
  contentEl.textContent = '';

  const headers = {};
  if (withPayment) {
    if (!xPaymentB64) {
      setStatus('Payment payload missing.');
      return;
    }
    headers['X-PAYMENT'] = xPaymentB64;
    if (addrBox && addrBox.value) headers['X-PAYER-ADDRESS'] = addrBox.value;
    lastEncodedPaymentHeader = xPaymentB64;
  }

  const res = await fetch('/', {
    method: 'GET',
    headers,
  });

  if (res.ok && res.status === 200) {
    const data = await res.json();
    setStatus('Access granted.');
    hide(connectBtn);
    hide(payBtn);
    contentEl.textContent = JSON.stringify(data, null, 2);
    showStep('success');

    const payRespHeader = res.headers.get('X-PAYMENT-RESPONSE');
    if (payRespHeader) {
      try {
        const decoded = JSON.parse(decodeURIComponent(escape(atob(payRespHeader))));
        contentEl.textContent += '\n\nX-PAYMENT-RESPONSE: ' + JSON.stringify(decoded, null, 2);
        const txHash = decoded && decoded.transaction;
        const url = explorerUrlFor((lastRequirements && lastRequirements.accepts && lastRequirements.accepts[0] && lastRequirements.accepts[0].network) || 'cardano-mainnet', txHash);
        if (successExplorerLink && txHash) {
          successExplorerLink.href = url;
          successExplorerLink.style.display = '';
        }
      } catch (_) {
        // ignore
      }
    }
    return;
  }

  // Pending settlement
  if (res.status === 202) {
    try {
      const info = await res.json();
      pendingTxId = info.transaction || null;
      updateProgress(60, 'Waiting for on-chain settlement…');
      setStatus('Pending settlement…');
      if (pendingTimer) clearInterval(pendingTimer);
      const retry = Math.max(5, Number(info.retryAfterSeconds || 10));
      // Switch to visual pending step
      showStep('pending');
      if (txBox) txBox.value = pendingTxId || '';
      let tick = 0;
      if (waitProgressInner) waitProgressInner.style.width = '0%';
      function updateWait() {
        tick = (tick + 1) % retry;
        const pct = Math.floor((tick / retry) * 100);
        if (waitProgressInner) waitProgressInner.style.width = `${pct}%`;
        if (waitLabel) waitLabel.textContent = `Checking in ${retry - tick}s…`;
      }
      updateWait();
      const uiTimer = setInterval(updateWait, 1000);
      pendingTimer = setInterval(async () => {
        try {
          if (!pendingTxId) return;
          const s = await fetch(`/?tx=${encodeURIComponent(pendingTxId)}`, {
            headers: addrBox && addrBox.value ? { 'X-PAYER-ADDRESS': addrBox.value } : {},
          });
          if (s.status === 200) {
            clearInterval(pendingTimer);
            pendingTimer = null;
            clearInterval(uiTimer);
            const data = await s.json();
            setStatus('Access granted.');
            hide(connectBtn);
            hide(payBtn);
            contentEl.textContent = JSON.stringify(data, null, 2);
            showStep('success');
          } else if (s.status === 202) {
            updateProgress(75, 'Still pending…');
          }
        } catch (_) {}
      }, retry * 1000);
      if (checkNowBtn) {
        checkNowBtn.onclick = async () => {
          try {
            if (!pendingTxId) return;
            const s = await fetch(`/?tx=${encodeURIComponent(pendingTxId)}`, {
              headers: addrBox && addrBox.value ? { 'X-PAYER-ADDRESS': addrBox.value } : {},
            });
            if (s.status === 200) {
              clearInterval(pendingTimer);
              pendingTimer = null;
              const data = await s.json();
              setStatus('Access granted.');
              contentEl.textContent = JSON.stringify(data, null, 2);
              showStep('success');
            }
          } catch (_) {}
        };
      }
    } catch (_) {}
    return;
  }

  if (res.status === 402) {
    let info = null;
    try {
      info = await res.clone().json();
    } catch (_) {
      // If server returned HTML page with embedded requirements
      if (window.__x402Requirements) info = window.__x402Requirements;
    }
    lastRequirements = info || lastRequirements || null;
    const err = res.headers.get('X-PAYMENT-ERROR');
    setStatus('Payment required' + (err ? `: ${err}` : '.'));
    show(connectBtn);
    if (info) updateReqSummary();
    return;
  }

  setStatus(`Error: ${res.status}`);
  try {
    const txt = await res.text();
    contentEl.textContent = txt;
  } catch (_) {}
}

async function tryConnectWallet() {
  const selected = walletSelect.value;
  const providers = listWalletProviders();
  const hasSelected = providers.some((p) => p.id === selected);

  if (hasSelected) {
    try {
      walletApi = await window.cardano[selected].enable();
      connected = true;
      walletId = selected;
      localStorage.setItem('x402.walletId', walletId);
      const label = providers.find((p) => p.id === selected)?.label || selected;
      setStatus(`Connected: ${label}`);
      // Show connected address and enable next step
      try {
        const { C } = await import('https://unpkg.com/lucid-cardano/web/mod.js?module');
        const changeHex = await walletApi.getChangeAddress();
        const bech = C.Address.from_bytes(hexToBytes(changeHex)).to_bech32(undefined);
        if (addrBox) addrBox.value = bech;
        if (connectNextBtn) connectNextBtn.disabled = false;
      } catch (_) {}
    } catch (e) {
      connected = false;
      setStatus('Failed to connect.');
      hide(payBtn);
    }
  }
}

connectBtn.addEventListener('click', tryConnectWallet);
rescanBtn.addEventListener('click', () => {
  statusEl.textContent = 'Scanning for wallets...';
  rescanWallets();
});
// Step navigation
document.getElementById('introNextBtn')?.addEventListener('click', () => showStep('reqs'));
document.getElementById('reqBackBtn')?.addEventListener('click', () => showStep('intro'));
document.getElementById('reqNextBtn')?.addEventListener('click', () => showStep('connect'));
document.getElementById('connectBackBtn')?.addEventListener('click', () => showStep('reqs'));
document.getElementById('connectNextBtn')?.addEventListener('click', () => showStep('pay'));

// Initial setup
populateWalletSelect();
// Try again shortly in case wallets inject late
setTimeout(populateWalletSelect, 300);
setTimeout(populateWalletSelect, 1200);
if (window.__x402Requirements) {
  lastRequirements = window.__x402Requirements;
  setStatus('Payment required.');
  updateReqSummary();
  show(connectBtn);
} else {
  // Fallback: try fetching the resource to get requirements
  fetchResource();
}
showStep('intro');

// Mobile notice: if narrow viewport, show the banner (CSS also triggers it).
try {
  if (window.innerWidth < 768) {
    const mw = document.getElementById('mobileWarning');
    if (mw) mw.style.display = 'flex';
  }
} catch (_) {}

// ------------- Build a real tx using Lucid + CIP-30 -------------

function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function buildPaymentTxB64() {
  if (!lastRequirements || !lastRequirements.accepts || !lastRequirements.accepts.length) {
    throw new Error('No payment requirements available');
  }

  const acc = lastRequirements.accepts[0];
  const payTo = acc.payTo;
  const policyId = (acc.asset || '').toLowerCase(); // policy id
  const assetNameHex = ((acc.extra && acc.extra.assetNameHex) || '0014df105553444d').toLowerCase();
  let unit = (policyId + assetNameHex).toLowerCase();
  const qtyStr = acc.maxAmountRequired || '5000000000';
  const qty = BigInt(qtyStr);

  setStatus('Preparing transaction (Lucid + Blockfrost)...');
  updateProgress(10, 'Initializing…');
  appendDebug(`policyId=${policyId}`);
  appendDebug(`assetNameHex=${assetNameHex}`);
  appendDebug(`target unit=${unit}`);
  appendDebug(`required qty=${qtyStr}`);

  // Dynamically import Lucid (web bundle includes Blockfrost provider and CSL as export `C`)
  const { Lucid, Blockfrost, C } = await import('https://unpkg.com/lucid-cardano/web/mod.js?module');
  const network = 'Mainnet';
  updateProgress(20, 'Loading libraries…');

  const bfKey = (window.__BF_PROJECT_ID || '').trim();
  if (!bfKey) throw new Error('Blockfrost API key missing (server config).');
  const bf = new Blockfrost('https://cardano-mainnet.blockfrost.io/api/v0', bfKey);
  const lucid = await Lucid.new(bf, network);
  updateProgress(30, 'Setting wallet…');

  const providers = listWalletProviders();
  const chosen = providers.find((p) => p.id === walletSelect.value);
  if (!chosen) {
    throw new Error('No wallet selected');
  }

  // Let Lucid use the enabled CIP-30 API
  if (!walletApi) {
    walletApi = await window.cardano[chosen.id].enable();
  }
  lucid.selectWallet(walletApi);

  // Guard network at wallet level to Mainnet (1)
  if (!walletApi) {
    // Ensure we have an enabled API instance for network check
    walletApi = await window.cardano[chosen.id].enable();
  }
  const nwId = await walletApi.getNetworkId();
  if (nwId !== 1) throw new Error('Switch wallet to Mainnet');
  updateProgress(40, 'Gathering UTxOs…');

  // Aggregate UTxOs across all wallet addresses to avoid InputsExhausted
  async function getWalletBech32Addresses() {
    const addrs = new Set();
    const used = await walletApi.getUsedAddresses();
    const unused = await walletApi.getUnusedAddresses();
    const change = await walletApi.getChangeAddress();
    const all = [...(used || []), ...(unused || []), ...(change ? [change] : [])];
    const C_ = C || CSL;
    for (const hex of all) {
      try {
        const bech = C_.Address.from_bytes(hexToBytes(hex)).to_bech32(undefined);
        addrs.add(bech);
      } catch (_) {}
    }
    return Array.from(addrs);
  }

  const addresses = await getWalletBech32Addresses();
  if (addresses.length === 0) throw new Error('No wallet addresses');
  appendDebug(`addresses[${addresses.length}]:`);
  addresses.slice(0, 5).forEach((a, i) => appendDebug(` addr[${i}]=${a}`));

  let allUtxos = [];
  for (const a of addresses) {
    const utx = await lucid.utxosAt(a);
    allUtxos.push(...utx);
  }
  if (!allUtxos.length) throw new Error('No UTxOs found for wallet');
  appendDebug(`utxos found=${allUtxos.length}`);
  updateProgress(55, 'Selecting inputs…');

  // Tally assets by unit and highlight those under the target policy
  const policyUnits = new Map(); // unit -> { total, utxos }
  for (const u of allUtxos) {
    for (const [k, v] of Object.entries(u.assets || {})) {
      if (k === 'lovelace') continue;
      const key = String(k).toLowerCase();
      const val = typeof v === 'bigint' ? v : BigInt(v);
      const rec = policyUnits.get(key) || { total: 0n, utxos: 0 };
      rec.total += val;
      rec.utxos += 1;
      policyUnits.set(key, rec);
    }
  }
  const byPolicy = [...policyUnits.entries()].filter(([k]) => k.startsWith(policyId));
  byPolicy.sort((a, b) => Number(b[1].total - a[1].total));
  appendDebug(`assets under policy (${byPolicy.length} units)`);
  byPolicy.slice(0, 10).forEach(([k, { total, utxos }], i) => {
    appendDebug(` unit[${i}]=${k.slice(policyId.length)} total=${total.toString()} utxos=${utxos}`);
  });

  const tokenUtxos = allUtxos
    .filter((u) => BigInt((u.assets && u.assets[unit]) || 0) > 0n)
    .sort((a, b) => Number(BigInt(((b.assets || {})[unit]) || 0) - BigInt(((a.assets || {})[unit]) || 0)));

  let tokenSelected = [];
  let tokenSum = 0n;
  for (const u of tokenUtxos) {
    if (tokenSum >= qty) break;
    tokenSelected.push(u);
    tokenSum += BigInt((u.assets && u.assets[unit]) || 0);
  }
  if (tokenSum < qty) {
    // Fallback: attempt best unit under this policy by total amount
    if (byPolicy.length > 0) {
      const bestUnit = byPolicy[0][0];
      if (bestUnit !== unit) {
        appendDebug(`fallback: trying discovered unit ${bestUnit}`);
        const alt = allUtxos
          .filter((u) => BigInt(((u.assets || {})[bestUnit]) || 0) > 0n)
          .sort((a, b) => Number(BigInt(((b.assets || {})[bestUnit]) || 0) - BigInt(((a.assets || {})[bestUnit]) || 0)));
        let altSel = [];
        let altSum = 0n;
        for (const u of alt) {
          if (altSum >= qty) break;
          altSel.push(u);
          altSum += BigInt(((u.assets || {})[bestUnit]) || 0);
        }
        appendDebug(`fallback sum for ${bestUnit} = ${altSum.toString()}`);
        if (altSum >= qty) {
          unit = bestUnit;
          tokenSelected = altSel;
          tokenSum = altSum;
        }
      }
    }
  }
  updateProgress(70, 'Building transaction…');
  if (tokenSum < qty) {
    appendDebug(`final tokenSum=${tokenSum.toString()} required=${qty.toString()}`);
    throw new Error('Wallet lacks required USDM on accessible addresses');
  }

  const seen = new Set(tokenSelected.map((u) => `${u.txHash}#${u.outputIndex}`));
  const adaCandidates = allUtxos
    .filter((u) => !seen.has(`${u.txHash}#${u.outputIndex}`))
    .sort((a, b) => Number(BigInt(b.assets.lovelace || 0n) - BigInt(a.assets.lovelace || 0n)));

  let selected = [...tokenSelected];
  let idx = 0;
  let lastErr = null;
  for (; idx <= adaCandidates.length; idx++) {
    try {
      const tx = await lucid
        .newTx()
        .collectFrom(selected)
        .payToAddress(payTo, { [unit]: qty, lovelace: 2_000_000n })
        .complete();
      updateProgress(85, 'Signing…');
      const signed = await tx.sign().complete();
      const cborHex = signed.toString();
      const b64 = bytesToBase64(hexToBytes(cborHex));
      updateProgress(95, 'Submitting…');
      return b64;
    } catch (e) {
      lastErr = e;
      const msg = (e && e.message) || String(e || '');
      if (!/InputsExhausted/i.test(msg)) throw e;
      if (idx < adaCandidates.length) {
        selected.push(adaCandidates[idx]);
        continue; // add more ADA and retry
      }
      throw e;
    }
  }
  throw lastErr || new Error('Failed to build transaction');
}

async function accessWithPayment() {
  try {
    setStatus('Building and signing transaction...');
    updateProgress(5, 'Starting…');
    const txB64 = await buildPaymentTxB64();
    const headerObj = {
      x402Version: 1,
      scheme: 'exact',
      network: 'cardano',
      payload: { transaction: txB64 },
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(headerObj))));
    await fetchResource(true, encoded);
    hideProgress();
  } catch (e) {
    setStatus('Payment failed: ' + (e?.message || e));
    try {
      const dbg = debugLines.join('\n');
      contentEl.textContent = (contentEl.textContent || '') + '\n\n[debug]\n' + dbg;
    } catch (_) {}
    updateProgress(100, 'Failed');
  }
}

payBtn.addEventListener('click', accessWithPayment);

// Rescan helper: poll briefly for wallet providers
async function rescanWallets() {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    populateWalletSelect();
    if (listWalletProviders().length > 0) {
      setStatus('Wallets detected.');
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  populateWalletSelect();
  if (listWalletProviders().length === 0) {
    setStatus('No wallets detected. Install/enable a CIP-30 wallet (Nami, Eternl, Lace, Flint, Gero).');
  }
}

// No Blockfrost key UI; key is set in code above.
  // Using known asset name hex from server; no remote lookup.
