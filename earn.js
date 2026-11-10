
/* =========================================
   NAVAA EARN — STAKING & REFERRAL
   Polygon Mainnet | Ethers v6
   Contract: NAVAAStakeAndRefer
========================================= */

(() => {
  "use strict";

  const STAKE_ADDRESS = "0xE46E8b1AC4CDFAE9CF9d1D9B0BD6D1705CB5B8C9";
  const TOKEN_ADDRESS = "0x82dba663278ADF0c398c1795a31760c7a76CA932";
  const POLYGON_CHAIN_ID = 137n;

  const MIN_STAKE = 1000;
  const DAILY_RATE = 0.0007;
  const LOCK_DAYS = 1825;
  const CLAIM_COOLDOWN = 30 * 24 * 60 * 60;

  const TOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ];

  const STAKE_ABI = [
    "function stake(uint256 amount,address referrer)",
    "function claimStakingReward(uint256 positionId)",
    "function withdrawPrincipal(uint256 positionId)",
    "function withdrawReferralReward(uint256 amount)",
    "function positionCount(address user) view returns (uint256)",
    "function getPosition(address user,uint256 positionId) view returns (tuple(uint128 principal,uint128 accrued,uint64 started,uint64 unlocksAt,uint64 lastAccrual,bool principalWithdrawn))",
    "function previewReward(address user,uint256 positionId) view returns (uint256)",
    "function nextRewardClaimAt(address user) view returns (uint256)",
    "function availableRewardReserve() view returns (uint256)",
    "function maxStakeCapacity(address user) view returns (uint256)",
    "function totalPrincipalLocked() view returns (uint256)",
    "function totalRewardsReserved() view returns (uint256)",
    "function totalReferralLiability() view returns (uint256)",
    "function referralBalance(address user) view returns (uint256)",
    "function hasStaked(address user) view returns (bool)",
    "function referrerOf(address user) view returns (address)",
    "function rootReferrer() view returns (address)",
    "function paused() view returns (bool)"
  ];

  let provider = null;
  let signer = null;
  let account = null;
  let token = null;
  let staking = null;
  let decimals = 18;
  let busy = false;
  let refreshTimer = null;

  const $ = id => document.getElementById(id);

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setStatus(message, isError = false) {
    const el = $("earnStakeStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#f6465d" : "";
  }

  function setReferralStatus(message, isError = false) {
    const el = $("earnReferralStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#f6465d" : "";
  }

  function formatAmount(value, digits = 4) {
    const number = Number(ethers.formatUnits(value, decimals));
    if (!Number.isFinite(number)) return "0";
    return number.toLocaleString("en-US", {
      maximumFractionDigits: digits
    });
  }

  function formatDate(timestamp) {
    const value = Number(timestamp);
    if (!value) return "Not available";
    return new Date(value * 1000).toLocaleString();
  }

  function shorten(address) {
    if (!address || address.length < 12) return address || "—";
    return address.slice(0, 6) + "..." + address.slice(-4);
  }

  function showError(error) {
    console.error("NAVAA Earn:", error);
    let message = error?.shortMessage || error?.reason || error?.message || "Transaction failed.";

    if (message.includes("user rejected")) {
      message = "Transaction rejected in wallet.";
    } else if (message.includes("insufficient funds")) {
      message = "Insufficient POL for gas fees.";
    } else if (message.includes("wrong network")) {
      message = "Please switch your wallet to Polygon Mainnet.";
    }

    return message;
  }

  function setButtonsDisabled(disabled) {
    [
      "earnApproveBtn",
      "earnStakeBtn",
      "earnWithdrawReferralBtn"
    ].forEach(id => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
  }

  async function getWallet() {
    if (!window.ethereum || !window.ethers) {
      throw new Error("Wallet or ethers.js not found. Open this site in your wallet browser.");
    }

    provider = new ethers.BrowserProvider(window.ethereum);

    const accounts = await window.ethereum.request({
      method: "eth_accounts"
    });

    if (!accounts || !accounts.length) {
      account = null;
      signer = null;
      token = null;
      staking = null;
      return false;
    }

    const network = await provider.getNetwork();

    if (network.chainId !== POLYGON_CHAIN_ID) {
      throw new Error("Please switch your wallet to Polygon Mainnet.");
    }

    account = ethers.getAddress(accounts[0]);
    signer = await provider.getSigner();

    token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
    staking = new ethers.Contract(STAKE_ADDRESS, STAKE_ABI, signer);

    return true;
  }

  function showConnectState() {
    setText("earnWalletBalance", account ? "Connected: " + shorten(account) : "Connect wallet to continue");
    setText("earnAvailableBalance", "—");
    setText("earnTotalStaked", "—");
    setText("earnTotalRewards", "—");
    setText("earnActivePositions", "—");
    setText("earnAccruedRewards", "—");
    setText("earnNextClaim", "—");
    setText("earnReferralBalance", "—");

    const stakeBtn = $("earnStakeBtn");
    const approveBtn = $("earnApproveBtn");
    if (stakeBtn) stakeBtn.disabled = true;
    if (approveBtn) approveBtn.disabled = true;
  }

  async function refreshDashboard() {
    if (!account || !token || !staking) {
      showConnectState();
      return;
    }

    const [
      walletBalance,
      reserve,
      totalStaked,
      totalRewards,
      count,
      referralAmount,
      capacity,
      alreadyStaked,
      nextClaim,
      isPaused
    ] = await Promise.all([
      token.balanceOf(account),
      staking.availableRewardReserve(),
      staking.totalPrincipalLocked(),
      staking.totalRewardsReserved(),
      staking.positionCount(account),
      staking.referralBalance(account),
      staking.maxStakeCapacity(account),
      staking.hasStaked(account),
      staking.nextRewardClaimAt(account),
      staking.paused()
    ]);

    decimals = Number(await token.decimals());

    setText("earnWalletBalance", formatAmount(walletBalance) + " NAVAA");
    setText("earnAvailableBalance", formatAmount(reserve) + " NAVAA");
    setText("earnTotalStaked", formatAmount(totalStaked) + " NAVAA");
    setText("earnTotalRewards", formatAmount(totalRewards) + " NAVAA");
    setText("earnActivePositions", count.toString());
    setText("earnReferralBalance", formatAmount(referralAmount) + " NAVAA");
    setText("earnPositionCount", count.toString() + " positions");

    const maxStake = walletBalance < capacity ? walletBalance : capacity;
    const maxButton = $("earnMaxBtn");

    if (maxButton) {
      maxButton.onclick = () => {
        const input = $("earnStakeAmount");
        if (input) input.value = ethers.formatUnits(maxStake, decimals);
        updateStakeButtons();
      };
    }

    const input = $("earnStakeAmount");
    if (input) {
      input.dataset.walletBalance = ethers.formatUnits(walletBalance, decimals);
      input.dataset.maxCapacity = ethers.formatUnits(capacity, decimals);
      input.dataset.alreadyStaked = alreadyStaked ? "true" : "false";
    }

     const referralInput = $("earnReferrer");
     if (referralInput && alreadyStaked) {
      referralInput.value = "";
      referralInput.placeholder = "Not required for subsequent stakes";
      referralInput.disabled = true;
    } else if (referralInput) {
      referralInput.disabled = false;
      referralInput.placeholder = "Enter referrer's wallet address";
    }

    const referralAddress = $("earnReferralLink");
    if (referralAddress) referralAddress.value = account;

    const claimDate = Number(nextClaim);
    setText(
      "earnNextClaim",
      claimDate > Math.floor(Date.now() / 1000)
        ? formatDate(claimDate)
        : "Available now"
    );

    const pausedMessage = isPaused ? "Staking is currently paused by the contract owner." : "";
    if (pausedMessage) setStatus(pausedMessage, true);

    await loadPositions(count, nextClaim);

    const referralButton = $("earnWithdrawReferralBtn");
    if (referralButton) {
      referralButton.disabled = referralAmount === 0n;
    }

    updateStakeButtons();
  }

  async function loadPositions(count, nextClaim) {
    const positionsBox = $("earnPositionsList");
    const rewardsBox = $("earnRewardPositions");

    if (positionsBox) positionsBox.innerHTML = "";
    if (rewardsBox) rewardsBox.innerHTML = "";

    let totalAccrued = 0n;
    const now = Math.floor(Date.now() / 1000);
    const claimAvailable = Number(nextClaim) <= now;

    if (count === 0n) {
      if (positionsBox) {
        positionsBox.innerHTML = '<div class="earn-empty-state">No staking positions yet. Stake NAVAA to get started.</div>';
      }
      if (rewardsBox) {
        rewardsBox.innerHTML = '<div class="earn-empty-state">Your staking rewards will appear here.</div>';
      }
      setText("earnAccruedRewards", "0 NAVAA");
      return;
    }

    for (let i = 0n; i < count; i++) {
      const [position, preview] = await Promise.all([
        staking.getPosition(account, i),
        staking.previewReward(account, i)
      ]);

      const principal = position.principal ?? position[0];
      const accrued = position.accrued ?? position[1];
      const unlocksAt = Number(position.unlocksAt ?? position[3]);
      const withdrawn = position.principalWithdrawn ?? position[5];

      const reward = preview;
      totalAccrued += reward;

      const isUnlocked = now >= unlocksAt;
      const rewardText = formatAmount(reward);

      if (positionsBox) {
        const card = document.createElement("div");
        card.className = "earn-position-item";

        const top = document.createElement("div");
        top.className = "earn-item-top";
        top.textContent = "Position #" + (i + 1n);

        const bottom = document.createElement("div");
        bottom.className = "earn-item-bottom";

        const left = document.createElement("span");
        left.textContent = "Principal";

        const right = document.createElement("strong");
        right.textContent = formatAmount(principal) + " NAVAA";

        bottom.append(left, right);

        const progress = document.createElement("div");
        progress.className = "earn-progress";

        const progressBar = document.createElement("span");
        const started = Number(position.started ?? position[2]);
        const duration = LOCK_DAYS * 86400;
        const percentage = Math.max(0, Math.min(100, ((now - started) / duration) * 100));
        progressBar.style.width = percentage + "%";
        progress.appendChild(progressBar);

        const unlockInfo = document.createElement("div");
        unlockInfo.className = "earn-item-bottom";
        unlockInfo.textContent = withdrawn
          ? "Principal already withdrawn"
          : isUnlocked
            ? "Unlocked — principal can be withdrawn"
            : "Unlocks: " + formatDate(unlocksAt);

        const withdrawButton = document.createElement("button");
        withdrawButton.className = "earn-btn earn-btn-secondary earn-btn-full";
        withdrawButton.textContent = withdrawn ? "Principal Withdrawn" : isUnlocked ? "Withdraw Principal" : "Locked";
        withdrawButton.disabled = withdrawn || !isUnlocked;

        if (!withdrawn && isUnlocked) {
          withdrawButton.onclick = () => withdrawPrincipal(i);
        }

        card.append(top, bottom, progress, unlockInfo, withdrawButton);
        positionsBox.appendChild(card);
      }

      if (rewardsBox) {
        const card = document.createElement("div");
        card.className = "earn-reward-item";

        const top = document.createElement("div");
        top.className = "earn-item-top";
        top.textContent = "Position #" + (i + 1n);

        const bottom = document.createElement("div");
        bottom.className = "earn-item-bottom";

        const label = document.createElement("span");
        label.textContent = "Claimable preview";

        const amount = document.createElement("strong");
        amount.textContent = rewardText + " NAVAA";

        bottom.append(label, amount);

        const claimButton = document.createElement("button");
        claimButton.className = "earn-btn earn-btn-primary earn-btn-full";
        claimButton.textContent = "Claim Reward";
        claimButton.disabled = !claimAvailable || reward === 0n;

        if (claimAvailable && reward > 0n) {
          claimButton.onclick = () => claimReward(i);
        }

        card.append(top, bottom, claimButton);
        rewardsBox.appendChild(card);
      }
    }

    setText("earnAccruedRewards", formatAmount(totalAccrued) + " NAVAA");
  }

  function updateStakeButtons() {
    const amountInput = $("earnStakeAmount");
    const approveButton = $("earnApproveBtn");
    const stakeButton = $("earnStakeBtn");

    if (!amountInput || !approveButton || !stakeButton || !account) return;

    const amount = Number(amountInput.value);
    const walletBalance = Number(amountInput.dataset.walletBalance || 0);
    const capacity = Number(amountInput.dataset.maxCapacity || 0);

    const valid = Number.isFinite(amount) &&
      amount >= MIN_STAKE &&
      amount <= walletBalance &&
      amount <= capacity;

    approveButton.disabled = !valid || busy;
    stakeButton.disabled = !valid || busy;
  }

  async function approveStake() {
    if (busy) return;

    try {
      busy = true;
      setButtonsDisabled(true);
      setStatus("Checking token approval...");

      if (!account) throw new Error("Please connect your wallet first.");

      const amountText = $("earnStakeAmount")?.value;
      if (!amountText || Number(amountText) < MIN_STAKE) {
        throw new Error("Minimum stake is 1000 NAVAA.");
      }

      const amount = ethers.parseUnits(amountText, decimals);
      const allowance = await token.allowance(account, STAKE_ADDRESS);

      if (allowance >= amount) {
        setStatus("Sufficient approval already available. You can stake now.");
        return;
      }

      setStatus("Please confirm NAVAA approval in your wallet...");
      const tx = await token.approve(STAKE_ADDRESS, amount);
      setStatus("Approval transaction submitted. Waiting for confirmation...");

      await tx.wait();

      setStatus("NAVAA approval successful. You can now stake.");
    } catch (error) {
      setStatus(showError(error), true);
    } finally {
      busy = false;
      setButtonsDisabled(false);
      updateStakeButtons();
    }
  }

  async function stakeTokens() {
    if (busy) return;

    try {
      busy = true;
      setButtonsDisabled(true);
      setStatus("Preparing staking transaction...");

      if (!account) throw new Error("Please connect your wallet first.");

      const amountText = $("earnStakeAmount")?.value;
      if (!amountText) throw new Error("Enter a NAVAA amount.");

      const amount = ethers.parseUnits(amountText, decimals);

      if (amount < ethers.parseUnits("1000", decimals)) {
        throw new Error("Minimum stake is 1000 NAVAA.");
      }

      const walletBalance = await token.balanceOf(account);
      if (amount > walletBalance) throw new Error("Insufficient NAVAA wallet balance.");

      const capacity = await staking.maxStakeCapacity(account);
      if (amount > capacity) throw new Error("Amount exceeds your current stake capacity.");

      const alreadyStaked = await staking.hasStaked(account);
      let referrer = ethers.ZeroAddress;

      if (!alreadyStaked) {
        const referral = $("earnReferralField")?.value?.trim();

        if (!referral) {
          throw new Error("Enter a valid referrer's wallet address for your first stake.");
        }

        if (!ethers.isAddress(referral)) {
          throw new Error("Invalid referral wallet address.");
        }

        referrer = ethers.getAddress(referral);

        if (referrer.toLowerCase() === account.toLowerCase()) {
          throw new Error("You cannot use your own wallet as a referral.");
        }
      }

      const allowance = await token.allowance(account, STAKE_ADDRESS);
      if (allowance < amount) {
        throw new Error("Please approve NAVAA first.");
      }

      if (await staking.paused()) {
        throw new Error("Staking is currently paused.");
      }

      setStatus("Please confirm the staking transaction in your wallet...");

      const tx = await staking.stake(amount, referrer);

      setStatus("Staking transaction submitted. Waiting for confirmation...");
      await tx.wait();

      setStatus("Staking successful! Your NAVAA position has been created.");
      if ($("earnStakeAmount")) $("earnStakeAmount").value = "";
      if ($("earnReferralField")) $("earnReferralField").value = "";

      await refreshDashboard();
    } catch (error) {
      setStatus(showError(error), true);
    } finally {
      busy = false;
      setButtonsDisabled(false);
      updateStakeButtons();
    }
  }

  async function claimReward(positionId) {
    if (busy) return;

    try {
      busy = true;
      setStatus("Please confirm reward claim in your wallet...");

      const nextClaim = await staking.nextRewardClaimAt(account);
      if (Number(nextClaim) > Math.floor(Date.now() / 1000)) {
        throw new Error("Your 30-day reward claim cooldown is still active.");
      }

      const preview = await staking.previewReward(account, positionId);
      if (preview === 0n) throw new Error("No reward available to claim.");

      const tx = await staking.claimStakingReward(positionId);
      setStatus("Reward claim submitted. Waiting for confirmation...");
      await tx.wait();

      setStatus("Staking reward claimed successfully.");
      await refreshDashboard();
    } catch (error) {
      setStatus(showError(error), true);
    } finally {
      busy = false;
    }
  }

  async function withdrawPrincipal(positionId) {
    if (busy) return;

    try {
      busy = true;
      setStatus("Please confirm principal withdrawal in your wallet...");

      const tx = await staking.withdrawPrincipal(positionId);
      setStatus("Withdrawal submitted. Waiting for confirmation...");
      await tx.wait();

      setStatus("Principal withdrawal successful.");
      await refreshDashboard();
    } catch (error) {
      setStatus(showError(error), true);
    } finally {
      busy = false;
    }
  }

  async function withdrawReferral() {
    if (busy) return;

    try {
      busy = true;
      setReferralStatus("Preparing referral withdrawal...");

      const amount = await staking.referralBalance(account);
      if (amount === 0n) throw new Error("No referral reward available.");

      const tx = await staking.withdrawReferralReward(amount);
      setReferralStatus("Referral withdrawal submitted. Waiting for confirmation...");
      await tx.wait();

      setReferralStatus("Referral reward withdrawn successfully.");
      await refreshDashboard();
    } catch (error) {
      setReferralStatus(showError(error), true);
    } finally {
      busy = false;
    }
  }

  async function copyReferralAddress() {
    if (!account) {
      setReferralStatus("Connect your wallet first.", true);
      return;
    }

    try {
      await navigator.clipboard.writeText(account);
      setReferralStatus("Your wallet address copied. Share it with your referral.");
    } catch {
      setReferralStatus("Copy not supported in this browser. Copy your wallet address manually.");
    }
  }

  async function init() {
    const amountInput = $("earnStakeAmount");
    if (amountInput) amountInput.addEventListener("input", updateStakeButtons);

    if ($("earnApproveBtn")) {
      $("earnApproveBtn").addEventListener("click", approveStake);
    }

    if ($("earnStakeBtn")) {
      $("earnStakeBtn").addEventListener("click", stakeTokens);
    }

    if ($("earnWithdrawReferralBtn")) {
      $("earnWithdrawReferralBtn").addEventListener("click", withdrawReferral);
    }

    if ($("earnCopyReferralBtn")) {
      $("earnCopyReferralBtn").addEventListener("click", copyReferralAddress);
    }

    try {
      const connected = await getWallet();

      if (connected) {
        await refreshDashboard();
      } else {
        showConnectState();
      }
    } catch (error) {
      showConnectState();
      setStatus(showError(error), true);
    }

    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on("accountsChanged", async () => {
        try {
          await getWallet();
          await refreshDashboard();
        } catch (error) {
          showConnectState();
          setStatus(showError(error), true);
        }
      });

      window.ethereum.on("chainChanged", () => {
        window.location.reload();
      });
    }

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (!busy && account) {
        try {
          await refreshDashboard();
        } catch (error) {
          console.warn("Earn refresh:", error);
        }
      }
    }, 15000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
