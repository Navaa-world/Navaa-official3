
/* ==========================================================
   NAVAA EXCHANGE — FIXED-RATE CONTRACT INTEGRATION
   Separate module. Existing wallet, Earn and Referral logic untouched.
========================================================== */
(() => {
  "use strict";
  if (window.NAVAA_EXCHANGE_INITIALIZED) return;
  window.NAVAA_EXCHANGE_INITIALIZED = true;

  const EXCHANGE_ADDRESS = "0xf31f82837b89f4d9a37b8e700cb175893766dd8f";
  const TOKEN_ADDRESS = "0x82dba663278ADF0c398c1795a31760c7a76CA932";
  const POLYGON_CHAIN_ID = 137n;
  const RPC_URL = "https://polygon.drpc.org";
  const TOKEN_UNIT = 10n ** 18n;
  const SLIPPAGE_BPS = 50n;
  const BPS_DENOMINATOR = 10000n;

  const EXCHANGE_ABI = [
    "function navaa() view returns (address)",
    "function owner() view returns (address)",
    "function feeWallet() view returns (address)",
    "function buyRate() view returns (uint256)",
    "function sellRate() view returns (uint256)",
    "function paused() view returns (bool)",
    "function quoteBuy(uint256) view returns (uint256 feePOL,uint256 netPOL,uint256 navaaOut,bool executable)",
    "function quoteSell(uint256) view returns (uint256 feeNAVAA,uint256 netNAVAA,uint256 polOut,bool executable)",
    "function buy(uint256 minNAVAAOut,uint256 deadline) payable",
    "function sell(uint256 grossNAVAA,uint256 minPOLOut,uint256 deadline)"
  ];
  const TOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)"
  ];

  const $ = id => document.getElementById(id);
  const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
  let readProvider = rpcProvider;
  let browserProvider = null;
  let contractRead = null;
  let tokenRead = null;
  let account = null;
  let walletOnPolygon = false;
  let paused = false;
  let ownerAddress = null;
  let buyRate = 0n;
  let sellRate = 0n;
  let polReserve = 0n;
  let navaaReserve = 0n;
  let polBalance = 0n;
  let navaaBalance = 0n;
  let allowance = 0n;
  let mode = "buy";
  let currentQuote = null;
  let busy = false;
  let quoteTimer = null;
  let quoteRequestId = 0;
  let lastRefresh = 0;

  function setStatus(message, kind = "info") {
    const node = $("exStatus");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  }

  function shortAddress(value) {
    return value ? value.slice(0, 6) + "…" + value.slice(-4) : "—";
  }

  // Exchange balances follow the main app's explicit wallet connection state.
  function isMainWalletConnected() {
    const label = $("connectBtn")?.textContent?.trim() || "";
    return /^0x[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/i.test(label);
  }

  function clearExchangeWalletBalances() {
    account = null;
    walletOnPolygon = false;
    polBalance = 0n;
    navaaBalance = 0n;
    allowance = 0n;
    if ($("exInputBalance")) $("exInputBalance").textContent = "—";
    if ($("exOutputBalance")) $("exOutputBalance").textContent = "Balance: —";
    if ($("exPolBalance")) $("exPolBalance").textContent = "—";
    if ($("exWalletNavaa")) $("exWalletNavaa").textContent = "—";
    updateTradeButton();
  }

  function formatAmount(raw, digits = 6) {
    try {
      const value = Number(ethers.formatUnits(raw, 18));
      if (!Number.isFinite(value)) return "—";
      return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
    } catch (_) { return "—"; }
  }

  function formatRate(raw) {
    try {
      const value = Number(ethers.formatUnits(raw, 18));
      if (!Number.isFinite(value)) return "—";
      return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 });
    } catch (_) { return "—"; }
  }

  function parseAmount(value) {
    const raw = String(value || "").trim();
    if (!raw || !/^\d+(\.\d{0,18})?$/.test(raw)) return null;
    try { return ethers.parseUnits(raw, 18); }
    catch (_) { return null; }
  }

  function updateMarketUI() {
    const buyRateNode = $("exBuyRate");
    const sellRateNode = $("exSellRate");
    const navaaReserveNode = $("exNavaaReserve");
    const polReserveNode = $("exPolReserve");

    if (buyRateNode) buyRateNode.textContent = buyRate > 0n ? formatRate(buyRate) : "—";
    if (sellRateNode) sellRateNode.textContent = sellRate > 0n ? formatRate(sellRate) : "—";
    if (navaaReserveNode) navaaReserveNode.textContent = formatAmount(navaaReserve);
    if (polReserveNode) polReserveNode.textContent = formatAmount(polReserve);

    const polBalanceNode = $("exPolBalance");
    const navaaBalanceNode = $("exWalletNavaa");
    if (polBalanceNode) polBalanceNode.textContent = account ? formatAmount(polBalance) + " POL" : "—";
    if (navaaBalanceNode) navaaBalanceNode.textContent = account ? formatAmount(navaaBalance) + " NAVAA" : "—";

    const state = $("exWalletState");
    if (!state) return;
    if (!account) state.textContent = "Connect your wallet to trade. Live contract information remains available.";
    else if (!walletOnPolygon) state.textContent = "Wallet connected (" + shortAddress(account) + "). Switch to Polygon Mainnet to trade.";
    else state.textContent = "Connected: " + shortAddress(account) + " · Polygon Mainnet";
  }

  function getDisplayRate() {
    if (mode === "buy") {
      const inverseBuyRate = buyRate > 0n ? (TOKEN_UNIT * TOKEN_UNIT) / buyRate : 0n;
      return "1 POL = " + (inverseBuyRate > 0n ? formatRate(inverseBuyRate) : "—") + " NAVAA";
    }
    return "1 NAVAA = " + (sellRate > 0n ? formatRate(sellRate) : "—") + " POL";
  }

  function updateModeUI() {
    const buy = mode === "buy";
    $("exInputLabel").textContent = "Pay";
    $("exOutputLabel").textContent = "Receive";
    $("exInputSymbol").outerHTML = buy
      ? '<span class="ex-token-symbol ex-token-symbol-pol" id="exInputSymbol" aria-label="Polygon logo"><svg viewBox="0 0 32 32" role="img" aria-hidden="true"><path d="M19.2 8.2 25 11.5v6.8l-5.8 3.3-5.8-3.3v-6.8zM6.9 14.7l5.8 3.3v6.7l-5.8 3.4-5.8-3.4V18z" transform="translate(3 -3)" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg></span>'
      : '<img class="ex-token-symbol ex-token-symbol-navaa" id="exInputSymbol" src="https://navaa-world.github.io/Navaa-official3/input-logo.png" alt="NAVAA logo" width="25" height="25">';
    $("exOutputSymbol").outerHTML = buy
      ? '<img class="ex-token-symbol ex-token-symbol-navaa" id="exOutputSymbol" src="https://navaa-world.github.io/Navaa-official3/input-logo.png" alt="NAVAA logo" width="25" height="25">'
      : '<span class="ex-token-symbol ex-token-symbol-pol" id="exOutputSymbol" aria-label="Polygon logo"><svg viewBox="0 0 32 32" role="img" aria-hidden="true"><path d="M19.2 8.2 25 11.5v6.8l-5.8 3.3-5.8-3.3v-6.8zM6.9 14.7l5.8 3.3v6.7l-5.8 3.4-5.8-3.4V18z" transform="translate(3 -3)" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg></span>';
    $("exInputToken").textContent = buy ? "POL" : "NAVAA";
    $("exOutputToken").textContent = buy ? "NAVAA" : "POL";
    $("exInputBalance").textContent = account
      ? (buy ? formatAmount(polBalance) + " POL" : formatAmount(navaaBalance) + " NAVAA")
      : "—";
    $("exOutputBalance").textContent = "Balance: " + (account
      ? (buy ? formatAmount(navaaBalance) + " NAVAA" : formatAmount(polBalance) + " POL")
      : "—");
    $("exOutputAmount").textContent = "0.00";
    $("exFeeValue").textContent = "—";
    $("exRateValue").textContent = getDisplayRate();
    $("exMinValue").textContent = "—";
    currentQuote = null;
    updateTradeButton();
    scheduleQuote();
  }

  function updateTradeButton() {
    const button = $("exTradeBtn");
    if (!button) return;
    let label = mode === "buy" ? "Buy" : "Sell";
    let disabled = busy;

    if (busy) label = "Please wait…";
    else if (!account) { label = "Connect Wallet"; disabled = false; }
    else if (!walletOnPolygon) { label = "Switch to Polygon"; disabled = false; }
    else if (paused) { label = "Exchange Paused"; disabled = true; }
    else if (!currentQuote || currentQuote.raw <= 0n || !currentQuote.executable) { label = "Enter a valid amount"; disabled = true; }
    else if (mode === "buy" && currentQuote.raw > polBalance) { label = "Insufficient POL balance"; disabled = true; }
    else if (mode === "sell" && currentQuote.raw > navaaBalance) { label = "Insufficient NAVAA balance"; disabled = true; }
    else if (mode === "sell" && allowance < currentQuote.raw) { label = "Approve NAVAA"; disabled = false; }

    button.disabled = disabled;
    button.textContent = label;
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    currentQuote = null;
    updateTradeButton();
    quoteTimer = setTimeout(refreshQuote, 220);
  }

  async function refreshQuote() {
    if (!contractRead) return;
    const requestId = ++quoteRequestId;
    const raw = parseAmount($("exAmount").value);
    currentQuote = null;

    if (raw === null || raw <= 0n) {
      $("exOutputAmount").textContent = "0.00";
      $("exFeeValue").textContent = "—";
      $("exMinValue").textContent = "—";
      $("exRateValue").textContent = getDisplayRate();
      setStatus(paused ? "Exchange is currently paused by the contract owner." : "Enter an amount to get a live on-chain quote.");
      updateTradeButton();
      return;
    }

    try {
      const quote = mode === "buy"
        ? await contractRead.quoteBuy(raw)
        : await contractRead.quoteSell(raw);
      if (requestId !== quoteRequestId) return;
      const fee = quote[0];
      const output = mode === "buy" ? quote[2] : quote[2];
      const executable = quote[3];
      const minimum = output * (BPS_DENOMINATOR - SLIPPAGE_BPS) / BPS_DENOMINATOR;
      currentQuote = { raw, fee, output, minimum, executable };

      $("exOutputAmount").textContent = formatAmount(output);
      $("exFeeValue").textContent = mode === "buy"
        ? formatAmount(fee) + " POL"
        : formatAmount(fee) + " NAVAA";
      $("exRateValue").textContent = getDisplayRate();
      $("exMinValue").textContent = formatAmount(minimum) + (mode === "buy" ? " NAVAA" : " POL");

      if (paused) setStatus("Exchange is paused. Trading is temporarily disabled.", "warning");
      else if (!executable) setStatus(mode === "buy"
        ? "This quote cannot execute. The contract may not have enough NAVAA reserve."
        : "This quote cannot execute. The contract may not have enough POL reserve.", "warning");
      else if (mode === "buy" && raw > polBalance && account) setStatus("Your POL balance is lower than this payment amount.", "warning");
      else if (mode === "sell" && raw > navaaBalance && account) setStatus("Your NAVAA balance is lower than this sell amount.", "warning");
      else setStatus("Live quote received from the exchange contract. Minimum output includes 0.5% slippage protection.", "success");

      if (mode === "sell" && account) {
        try { allowance = await tokenRead.allowance(account, EXCHANGE_ADDRESS); }
        catch (_) { allowance = 0n; }
      } else allowance = 0n;
    } catch (error) {
      if (requestId !== quoteRequestId) return;
      setStatus(error.shortMessage || error.reason || "Unable to fetch the live contract quote. Please refresh.", "error");
    }
    if (requestId === quoteRequestId) updateTradeButton();
  }

  async function refreshData() {
    if (busy) return;
    try {
      browserProvider = null;
      walletOnPolygon = false;
      account = null;
      polBalance = 0n;
      navaaBalance = 0n;
      $("exInputBalance").textContent = "—";
      $("exOutputBalance").textContent = "Balance: —";
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: "eth_accounts" });
          account = accounts && accounts.length && isMainWalletConnected()
            ? ethers.getAddress(accounts[0])
            : null;
          if (account) {
            browserProvider = new ethers.BrowserProvider(window.ethereum, "any");
            try {
              const net = await browserProvider.getNetwork();
              walletOnPolygon = net.chainId === POLYGON_CHAIN_ID;
            } catch (_) {
              walletOnPolygon = false;
            }
          }
        } catch (_) {
          browserProvider = null;
          account = null;
          walletOnPolygon = false;
        }
      }

      readProvider = walletOnPolygon && browserProvider ? browserProvider : rpcProvider;
      contractRead = new ethers.Contract(EXCHANGE_ADDRESS, EXCHANGE_ABI, readProvider);
      tokenRead = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, readProvider);

      const [code, deployedToken, ...values] = await Promise.all([
        readProvider.getCode(EXCHANGE_ADDRESS),
        contractRead.navaa(),
        contractRead.buyRate(),
        contractRead.sellRate(),
        contractRead.paused(),
        contractRead.owner(),
        readProvider.getBalance(EXCHANGE_ADDRESS),
        tokenRead.balanceOf(EXCHANGE_ADDRESS)
      ]);
      if (!code || code === "0x") throw new Error("Exchange contract code was not found on Polygon Mainnet.");
      if (deployedToken.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) {
        throw new Error("The deployed exchange contract is linked to a different NAVAA token address.");
      }
      buyRate = values[0];
      sellRate = values[1];
      paused = values[2];
      ownerAddress = values[3];
      polReserve = values[4];
      navaaReserve = values[5];

      if (account) {
        const balancesPromise = Promise.all([
          readProvider.getBalance(account),
          tokenRead.balanceOf(account)
        ]);
        const allowancePromise = mode === "sell"
          ? tokenRead.allowance(account, EXCHANGE_ADDRESS).catch(() => 0n)
          : Promise.resolve(0n);
        const [balances, currentAllowance] = await Promise.all([balancesPromise, allowancePromise]);
        polBalance = balances[0];
        navaaBalance = balances[1];
        allowance = currentAllowance;
      } else {
        polBalance = 0n;
        navaaBalance = 0n;
        allowance = 0n;
      }

      $("exInputBalance").textContent = account
        ? (mode === "buy" ? formatAmount(polBalance) + " POL" : formatAmount(navaaBalance) + " NAVAA")
        : "—";
      $("exOutputBalance").textContent = "Balance: " + (account
        ? (mode === "buy" ? formatAmount(navaaBalance) + " NAVAA" : formatAmount(polBalance) + " POL")
        : "—");
      $("exRateValue").textContent = getDisplayRate();
      lastRefresh = Date.now();

      const networkBadge = $("exWalletState");
      if (paused) setStatus("Exchange is paused by the contract owner. You can still view rates and reserves.", "warning");
      else if (!walletOnPolygon && account) setStatus("Switch your wallet to Polygon Mainnet before trading.", "warning");
      else if (networkBadge) setStatus("Connected to the verified NAVAA exchange contract on Polygon Mainnet.", "success");
      else setStatus("Live contract data loaded.", "success");

      updateTradeButton();
      if ($("exAmount").value.trim()) await refreshQuote();
    } catch (error) {
      account = null;
      walletOnPolygon = false;
      polBalance = 0n;
      navaaBalance = 0n;
      $("exInputBalance").textContent = "—";
      $("exOutputBalance").textContent = "Balance: —";
      setStatus(error.shortMessage || error.reason || error.message || "Could not connect to the exchange contract.", "error");
      $("exWalletState").textContent = "Contract data unavailable. Check your network connection and refresh.";
      updateTradeButton();
    }
  }

  async function switchPolygon() {
    if (!window.ethereum) {
      setStatus("Open NAVAA in MetaMask, Trust Wallet or SafePal to connect.", "warning");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x89" }]
      });
    } catch (error) {
      if (error.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x89",
            chainName: "Polygon Mainnet",
            nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: ["https://polygonscan.com"]
          }]
        });
      } else {
        throw error;
      }
    }
    await refreshData();
  }

  async function handleTrade() {
    if (busy) return;
    if (!account) {
      $("connectBtn")?.click();
      setStatus("Approve the wallet connection request to continue.", "info");
      return;
    }
    if (!walletOnPolygon) {
      try { await switchPolygon(); }
      catch (error) { setStatus(error.message || "Could not switch to Polygon Mainnet.", "error"); }
      return;
    }
    const raw = parseAmount($("exAmount").value);
    if (raw === null || raw <= 0n || !currentQuote || currentQuote.raw !== raw || !currentQuote.executable) {
      setStatus("Enter a valid amount and wait for its latest executable quote.", "warning");
      scheduleQuote();
      return;
    }
    if (mode === "buy" && raw > polBalance) {
      setStatus("Insufficient POL balance for this purchase.", "warning");
      return;
    }
    if (mode === "sell" && raw > navaaBalance) {
      setStatus("Insufficient NAVAA balance for this sale.", "warning");
      return;
    }

    busy = true;
    let refreshAfterTrade = false;
    $("exTxResult").hidden = true;
    updateTradeButton();
    try {
      const signer = await browserProvider.getSigner();
      if (mode === "sell") {
        const tokenWrite = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
        const currentAllowance = await tokenWrite.allowance(account, EXCHANGE_ADDRESS);
        if (currentAllowance < raw) {
          setStatus("Confirm NAVAA approval in your wallet. This is a separate token approval transaction.", "info");
          const approvalTx = await tokenWrite.approve(EXCHANGE_ADDRESS, raw);
          setStatus("NAVAA approval submitted. Waiting for Polygon confirmation…", "info");
          const approvalReceipt = await approvalTx.wait();
          if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error("NAVAA approval transaction failed.");
          allowance = await tokenWrite.allowance(account, EXCHANGE_ADDRESS);
          updateTradeButton();
          setStatus("NAVAA approval confirmed. Press Sell NAVAA to complete your trade.", "success");
          return;
        }
      }

      const exchangeWrite = new ethers.Contract(EXCHANGE_ADDRESS, EXCHANGE_ABI, signer);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      let tx;
      if (mode === "buy") {
        const minNAVAAOut = currentQuote.output * (BPS_DENOMINATOR - SLIPPAGE_BPS) / BPS_DENOMINATOR;
        tx = await exchangeWrite.buy(minNAVAAOut, deadline, { value: raw });
      } else {
        const minPOLOut = currentQuote.output * (BPS_DENOMINATOR - SLIPPAGE_BPS) / BPS_DENOMINATOR;
        tx = await exchangeWrite.sell(raw, minPOLOut, deadline);
      }

      setStatus("Transaction submitted. Waiting for Polygon confirmation…", "info");
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("The exchange transaction did not complete successfully.");
      setStatus("Trade confirmed successfully on Polygon Mainnet.", "success");
      $("exAmount").value = "";
      currentQuote = null;
      refreshAfterTrade = true;
    } catch (error) {
      const message = error.code === 4001 || error.code === "ACTION_REJECTED"
        ? "Transaction was rejected in your wallet."
        : (error.shortMessage || error.reason || error.message || "Transaction failed.");
      setStatus(message, "error");
    } finally {
      busy = false;
      updateTradeButton();
      if (refreshAfterTrade) await refreshData();
      else if ($("exAmount").value.trim()) scheduleQuote();
    }
  }

  function setMax() {
    if (!account) {
      setStatus("Connect your wallet to use MAX.", "warning");
      return;
    }
    let value = mode === "buy" ? polBalance * 98n / 100n : navaaBalance;
    if (mode === "buy" && value > 0n) value = value > 20000000000000000n ? value - 20000000000000000n : value;
    $("exAmount").value = ethers.formatUnits(value, 18);
    scheduleQuote();
  }

  function bindEvents() {
    $("exSwapDirectionBtn")?.addEventListener("click", () => {
      mode = mode === "buy" ? "sell" : "buy";
      updateModeUI();
    });
    $("exAmount").addEventListener("input", () => {
      quoteRequestId++;
      currentQuote = null;
      $("exOutputAmount").textContent = "0.00";
      $("exFeeValue").textContent = "—";
      $("exMinValue").textContent = "—";
      updateTradeButton();
      scheduleQuote();
    });
    $("exMaxBtn").addEventListener("click", setMax);
    $("exTradeBtn").addEventListener("click", handleTrade);
    $("connectBtn")?.addEventListener("click", () => {
      setTimeout(refreshData, 700);
      setTimeout(refreshData, 1700);
    });
    document.querySelectorAll('[data-page-target="exchange"]').forEach(button => {
      button.addEventListener("click", () => setTimeout(refreshData, 250));
    });
    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", () => {
        clearExchangeWalletBalances();
        refreshData();
      });
      window.ethereum.on("chainChanged", () => {
        clearExchangeWalletBalances();
        refreshData();
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && $("pageExchange")?.classList.contains("active")) refreshData();
    });
  }

  function init() {
    if (!$("pageExchange") || !$("exTradeBtn") || typeof ethers === "undefined") return;
    bindEvents();
    updateModeUI();
    refreshData();
    setInterval(() => {
      if (!busy && $("pageExchange")?.classList.contains("active") && Date.now() - lastRefresh > 20000) refreshData();
    }, 5000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
