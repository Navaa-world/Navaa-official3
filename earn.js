
/* =====================================================
   NAVAA EARN — CONTRACT INTEGRATION
   Polygon Mainnet | Ethers.js v6
   Staking + Rewards + Referral + Recent History
===================================================== */

(() => {
  "use strict";

  if (window.NAVAA_EARN_INITIALIZED) return;
  window.NAVAA_EARN_INITIALIZED = true;

  const STAKE_ADDRESS = "0xE46E8b1AC4CDFAE9CF9d1D9B0BD6D1705CB5B8C9";
  const TOKEN_ADDRESS = "0x82dba663278ADF0c398c1795a31760c7a76CA932";
  const POLYGON_CHAIN_ID = 137n;

  const MIN_STAKE = 1000n;
  const LOCK_SECONDS = 1825n * 86400n;
  const CLAIM_COOLDOWN = 30n * 86400n;

  // Recent history scan window. Older events may not appear.
  const HISTORY_BLOCK_WINDOW = 500000;

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
    "function referralBalance(address user) view returns (uint256)",

    "function hasStaked(address user) view returns (bool)",
    "function referrerOf(address user) view returns (address)",
    "function rootReferrer() view returns (address)",
    "function paused() view returns (bool)",

    "event Staked(address indexed user,uint256 indexed positionId,uint256 amount,address indexed referrer,uint256 referralReward)",
    "event RewardClaimed(address indexed user,uint256 indexed positionId,uint256 gross,uint256 fee,uint256 net)",
    "event PrincipalWithdrawn(address indexed user,uint256 indexed positionId,uint256 gross,uint256 fee,uint256 net)",
    "event ReferralWithdrawn(address indexed user,uint256 gross,uint256 fee,uint256 net)"
  ];

  let provider = null;
  let signer = null;
  let account = null;
  let token = null;
  let staking = null;

  let decimals = 18;
  let busy = false;
  let pausedState = false;
  let walletBalanceRaw = 0n;
  let capacityRaw = 0n;
  let allowanceRaw = 0n;
  let refreshTimer = null;

  const $ = id => document.getElementById(id);

  /* =========================================
     HELPERS
  ========================================= */

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setStatus(message, error = false) {
    const el = $("earnStakeStatus");
    if (!el) return;

    el.textContent = message;
    el.style.color = error ? "#f6465d" : "";
  }

  function setReferralStatus(message, error = false) {
    const el = $("earnReferralStatus");
    if (!el) return;

    el.textContent = message;
    el.style.color = error ? "#f6465d" : "";
  }

  function formatAmount(value, digits = 4) {
    try {
      const number = Number(ethers.formatUnits(value, decimals));

      return number.toLocaleString("en-US", {
        maximumFractionDigits: digits
      });
    } catch {
      return "0";
    }
  }

  function formatDate(timestamp) {
    const value = Number(timestamp);

    if (!value) return "Not available";

    return new Date(value * 1000).toLocaleString();
  }

  function shorten(address) {
    if (!address) return "—";

    return address.slice(0, 6) + "..." + address.slice(-4);
  }

  function showError(error) {
    console.error("NAVAA Earn Error:", error);

    const message =
      error?.shortMessage ||
      error?.reason ||
      error?.info?.error?.message ||
      error?.message ||
      "Something went wrong.";

    if (/user rejected|user denied/i.test(message)) {
      return "Transaction cancelled in wallet.";
    }

    if (/insufficient funds/i.test(message)) {
      return "Insufficient POL for gas fees.";
    }

    if (/network|chain/i.test(message)) {
      return "Please select Polygon Mainnet.";
    }

    if (/execution reverted/i.test(message)) {
      return "Contract rejected this transaction. Check the amount, referral, reserve and cooldown.";
    }

    return message;
  }

  function setBusy(value) {
    busy = value;

    [
      "earnApproveBtn",
      "earnStakeBtn",
      "earnWithdrawReferralBtn"
    ].forEach(id => {
      const el = $(id);
      if (el) el.disabled = value;
    });

    if (value) {
      const copy = $("earnCopyReferralBtn");
      if (copy) copy.disabled = true;
    }
  }

  function parseAmount(value) {
    if (!value || !String(value).trim()) {
      throw new Error("Enter a NAVAA amount.");
    }

    if (!/^\d+(\.\d+)?$/.test(String(value).trim())) {
      throw new Error("Enter a valid amount.");
    }

    return ethers.parseUnits(String(value).trim(), decimals);
  }

  function currentTime() {
    return BigInt(Math.floor(Date.now() / 1000));
  }

  function createElement(tag, className, text) {
    const el = document.createElement(tag);

    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;

    return el;
  }

  function emptyState(title, description) {
    const box = createElement("div", "earn-empty-state");

    box.append(
      createElement("strong", "", title),
      createElement("p", "", description)
    );

    return box;
  }

  /* =========================================
     WALLET CONNECTION
  ========================================= */

  async function connectEarnWallet() {
    if (!window.ethereum) {
      throw new Error(
        "Open NAVAA inside MetaMask, Trust Wallet or SafePal."
      );
    }

    if (!window.ethers) {
      throw new Error("Ethers.js failed to load.");
    }

    provider = new ethers.BrowserProvider(
      window.ethereum,
      "any"
    );

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
      throw new Error("Please switch to Polygon Mainnet.");
    }

    account = ethers.getAddress(accounts[0]);

    signer = await provider.getSigner();

    token = new ethers.Contract(
      TOKEN_ADDRESS,
      TOKEN_ABI,
      signer
    );

    staking = new ethers.Contract(
      STAKE_ADDRESS,
      STAKE_ABI,
      signer
    );

    decimals = Number(await token.decimals());

    return true;
  }

  function resetDashboard() {
    [
      "earnTotalStaked",
      "earnTotalRewards",
      "earnAvailableBalance",
      "earnActivePositions",
      "earnAccruedRewards",
      "earnNextClaim",
      "earnReferralBalance"
    ].forEach(id => setText(id, "—"));

    setText("earnWalletBalance", "Connect wallet to continue");
    setText("earnPositionCount", "0");

    const positions = $("earnPositionsList");
    if (positions) {
      positions.replaceChildren(
        emptyState(
          "Connect your wallet",
          "Your staking positions will appear here."
        )
      );
    }

    const rewards = $("earnRewardPositions");
    if (rewards) {
      rewards.replaceChildren(
        emptyState(
          "Connect your wallet",
          "Your reward details will appear here."
        )
      );
    }

    const history = $("earnHistoryList");
    if (history) {
      history.replaceChildren(
        emptyState(
          "Connect your wallet",
          "Your staking activity will appear here."
        )
      );
    }

    const referral = $("earnReferralLink");
    if (referral) referral.value = "";

    [
      "earnApproveBtn",
      "earnStakeBtn",
      "earnWithdrawReferralBtn",
      "earnCopyReferralBtn"
    ].forEach(id => {
      const el = $(id);
      if (el) el.disabled = true;
    });
  }

  /* =========================================
     STAKE FORM VALIDATION
  ========================================= */

  async function updateStakeButtons() {
    const input = $("earnStakeAmount");
    const approveButton = $("earnApproveBtn");
    const stakeButton = $("earnStakeBtn");

    if (!input || !approveButton || !stakeButton) return;

    if (!account || !token || !staking || busy || pausedState) {
      approveButton.disabled = true;
      stakeButton.disabled = true;
      return;
    }

    try {
      const amount = parseAmount(input.value);

      const valid =
        amount >= ethers.parseUnits("1000", decimals) &&
        amount <= walletBalanceRaw &&
        amount <= capacityRaw;

      approveButton.disabled = !valid || allowanceRaw >= amount;
      stakeButton.disabled = !valid || allowanceRaw < amount;

    } catch {
      approveButton.disabled = true;
      stakeButton.disabled = true;
    }
  }

  /* =========================================
     MAX BUTTON
  ========================================= */

  function setupMaxButton() {
    const button = $("earnMaxBtn");
    if (!button) return;

    button.onclick = () => {
      if (!account) {
        setStatus("Connect your wallet first.", true);
        return;
      }

      const max = walletBalanceRaw < capacityRaw
        ? walletBalanceRaw
        : capacityRaw;

      const input = $("earnStakeAmount");

      if (input) {
        input.value = ethers.formatUnits(max, decimals);
        updateStakeButtons();
      }
    };
  }

  /* =========================================
     DASHBOARD READS
  ========================================= */

     async function refreshDashboard() {
    if (!account || !token || !staking) {
      showConnectState();
      return;
    }

    try {
      decimals = await token.decimals().catch(() => 18);

      const reads = await Promise.allSettled([
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

      const getValue = (index, fallback = null) =>
        reads[index].status === "fulfilled"
          ? reads[index].value
          : fallback;

      const walletBalance = getValue(0);
      const reserve = getValue(1);
      const totalStaked = getValue(2);
      const totalRewards = getValue(3);
      const count = getValue(4);
      const referralAmount = getValue(5);
      const capacity = getValue(6);
      const alreadyStaked = getValue(7);
      const nextClaim = getValue(8);
      const isPaused = getValue(9);

      setText(
        "earnWalletBalance",
        walletBalance === null
          ? "Read error"
          : formatAmount(walletBalance) + " NAVAA"
      );

      setText(
        "earnAvailableBalance",
        reserve === null ? "Read error" : formatAmount(reserve) + " NAVAA"
      );

      setText(
        "earnTotalStaked",
        totalStaked === null ? "Read error" : formatAmount(totalStaked) + " NAVAA"
      );

      setText(
        "earnTotalRewards",
        totalRewards === null ? "Read error" : formatAmount(totalRewards) + " NAVAA"
      );

      setText(
        "earnActivePositions",
        count === null ? "Read error" : count.toString()
      );

      setText(
        "earnReferralBalance",
        referralAmount === null
          ? "Read error"
          : formatAmount(referralAmount) + " NAVAA"
      );

      const input = $("earnStakeAmount");

      if (input) {
        input.dataset.walletBalance =
          walletBalance === null ? "0" : ethers.formatUnits(walletBalance, decimals);

        input.dataset.maxCapacity =
          capacity === null ? "0" : ethers.formatUnits(capacity, decimals);

        input.dataset.alreadyStaked =
          alreadyStaked === true ? "true" : "false";
      }

      const maxStake =
        walletBalance !== null && capacity !== null
          ? (walletBalance < capacity ? walletBalance : capacity)
          : 0n;

      const maxButton = $("earnMaxBtn");

      if (maxButton) {
        maxButton.onclick = () => {
          if (input) {
            input.value = ethers.formatUnits(maxStake, decimals);
            updateStakeButtons();
          }
        };
      }

      const referralInput = $("earnReferrer");

      if (referralInput) {
        if (alreadyStaked === true) {
          referralInput.value = "";
          referralInput.placeholder = "Not required for subsequent stakes";
          referralInput.disabled = true;
        } else {
          referralInput.disabled = false;
          referralInput.placeholder = "Enter referrer's wallet address";
        }
      }

      const referralAddress = $("earnReferralLink");

      if (referralAddress) {
        referralAddress.value = account;
      }

      if (nextClaim !== null) {
        const claimDate = Number(nextClaim);

        setText(
          "earnNextClaim",
          claimDate > Math.floor(Date.now() / 1000)
            ? formatDate(claimDate)
            : "Available now"
        );
      } else {
        setText("earnNextClaim", "Read error");
      }

      if (count !== null && nextClaim !== null) {
        try {
          await loadPositions(count, nextClaim);
        } catch (error) {
          console.error("NAVAA positions read error:", error);
          setText("earnPositionCount", "Unable to load positions");
          setText("earnAccruedRewards", "Read error");
        }
      } else {
        setText("earnPositionCount", "Read error");
        setText("earnAccruedRewards", "Read error");
      }

      const referralButton = $("earnWithdrawReferralBtn");

      if (referralButton) {
        referralButton.disabled =
          referralAmount === null || referralAmount === 0n;
      }

      updateStakeButtons();

      const failedReads = reads.filter(
        result => result.status === "rejected"
      ).length;

      if (failedReads > 0) {
        setStatus(
          failedReads + " contract read(s) failed. Other available data is shown.",
          true
        );
        console.error("NAVAA Earn failed reads:", reads);
      } else if (isPaused === true) {
        setStatus("Staking is currently paused by the contract owner.", true);
      } else {
        setStatus("Wallet and staking data updated.");
      }

    } catch (error) {
      console.error("NAVAA Earn dashboard error:", error);
      setStatus(showError(error), true);
    }
  }
  

  /* =========================================
     POSITIONS + REWARD PREVIEW
  ========================================= */

  async function loadPositions(count, nextClaim) {
    const positionsBox = $("earnPositionsList");
    const rewardsBox = $("earnRewardPositions");

    if (!positionsBox || !rewardsBox) return;

    positionsBox.replaceChildren();
    rewardsBox.replaceChildren();

    if (count === 0n) {
      positionsBox.appendChild(
        emptyState(
          "No staking positions yet",
          "Stake at least 1,000 NAVAA to create your first position."
        )
      );

      rewardsBox.appendChild(
        emptyState(
          "No rewards yet",
          "Your staking reward previews will appear here."
        )
      );

      setText("earnAccruedRewards", "0 NAVAA");
      return;
    }

    let totalPreview = 0n;
    const now = currentTime();
    const canClaim = nextClaim <= now;

    for (let i = 0n; i < count; i++) {
      const results = await Promise.allSettled([
        staking.getPosition(account, i),
        staking.previewReward(account, i)
      ]);

      if (
        results[0].status !== "fulfilled" ||
        results[1].status !== "fulfilled"
      ) {
        positionsBox.appendChild(
          emptyState(
            "Position #" + (i + 1n) + " unavailable",
            "The contract could not load this position. Please retry."
          )
        );
        continue;
      }

      const position = results[0].value;
      const reward = results[1].value;

      const principal = position.principal ?? position[0];
      const started = position.started ?? position[2];
      const unlocksAt = position.unlocksAt ?? position[3];
      const withdrawn = position.principalWithdrawn ?? position[5];

      totalPreview += reward;

      const unlocked = now >= unlocksAt;
      const percentage = Math.min(
        100,
        Math.max(
          0,
          Number(now - started) / Number(LOCK_SECONDS) * 100
        )
      );

      /* Position card */

      const card = createElement("div", "earn-position-item");

      card.appendChild(
        createElement("div", "earn-item-top", "Position #" + (i + 1n))
      );

      const principalRow = createElement("div", "earn-item-bottom");
      principalRow.append(
        createElement("span", "", "Principal"),
        createElement(
          "strong",
          "",
          formatAmount(principal) + " NAVAA"
        )
      );

      card.appendChild(principalRow);

      const progress = createElement("div", "earn-progress");
      const bar = createElement("span");

      bar.style.width = percentage + "%";
      progress.appendChild(bar);
      card.appendChild(progress);

      const unlockText = withdrawn
        ? "Principal already withdrawn"
        : unlocked
          ? "Unlocked — ready to withdraw"
          : "Unlocks: " + formatDate(unlocksAt);

      card.appendChild(
        createElement("div", "earn-item-bottom", unlockText)
      );

      const withdrawButton = createElement(
        "button",
        "earn-btn earn-btn-secondary earn-btn-full",
        withdrawn
          ? "Principal Withdrawn"
          : unlocked
            ? "Withdraw Principal"
            : "Locked"
      );

      withdrawButton.disabled = withdrawn || !unlocked || busy;

      if (!withdrawn && unlocked) {
        withdrawButton.onclick = () => withdrawPrincipal(i);
      }

      card.appendChild(withdrawButton);
      positionsBox.appendChild(card);

      /* Reward card */

      const rewardCard = createElement("div", "earn-reward-item");

      rewardCard.appendChild(
        createElement("div", "earn-item-top", "Position #" + (i + 1n))
      );

      const rewardRow = createElement("div", "earn-item-bottom");

      rewardRow.append(
        createElement("span", "", "Estimated reward"),
        createElement(
          "strong",
          "",
          formatAmount(reward) + " NAVAA"
        )
      );

      rewardCard.appendChild(rewardRow);

      const claimButton = createElement(
        "button",
        "earn-btn earn-btn-primary earn-btn-full",
        "Claim Reward"
      );

      claimButton.disabled =
        !canClaim || reward === 0n || busy;

      if (canClaim && reward > 0n) {
        claimButton.onclick = () => claimReward(i);
      }

      rewardCard.appendChild(claimButton);
      rewardsBox.appendChild(rewardCard);
    }

    setText(
      "earnAccruedRewards",
      formatAmount(totalPreview) + " NAVAA"
    );
  }

  /* =========================================
     TOKEN APPROVAL
  ========================================= */

  async function approveStake() {
    if (busy) return;

    try {
      if (!account) throw new Error("Connect your wallet first.");
      if (pausedState) throw new Error("Staking is paused.");

      const input = $("earnStakeAmount");
      const amount = parseAmount(input?.value);

      if (amount < ethers.parseUnits("1000", decimals)) {
        throw new Error("Minimum stake is 1,000 NAVAA.");
      }

      if (amount > walletBalanceRaw) {
        throw new Error("Insufficient NAVAA wallet balance.");
      }

      if (amount > capacityRaw) {
        throw new Error("Amount exceeds your available stake capacity.");
      }

      setBusy(true);
      setStatus("Please confirm NAVAA approval in your wallet...");

      const allowance = await token.allowance(account, STAKE_ADDRESS);

      if (allowance >= amount) {
        setStatus("Approval already available. You can stake now.");
        allowanceRaw = allowance;
        return;
      }

      const tx = await token.approve(STAKE_ADDRESS, amount);

      setStatus("Approval submitted. Waiting for confirmation...");

      await tx.wait();

      allowanceRaw = await token.allowance(account, STAKE_ADDRESS);

      setStatus("NAVAA approval successful. You can now stake.");

    } catch (error) {
      setStatus(showError(error), true);

    } finally {
      setBusy(false);
      await refreshDashboard();
    }
  }

  /* =========================================
     STAKE NAVAA
  ========================================= */

  async function stakeTokens() {
    if (busy) return;

    try {
      if (!account) throw new Error("Connect your wallet first.");
      if (pausedState) throw new Error("Staking is currently paused.");

      const amount = parseAmount($("earnStakeAmount")?.value);

      if (amount < ethers.parseUnits("1000", decimals)) {
        throw new Error("Minimum stake is 1,000 NAVAA.");
      }

      const [
        balance,
        capacity,
        allowance,
        alreadyStaked,
        isPaused
      ] = await Promise.all([
        token.balanceOf(account),
        staking.maxStakeCapacity(account),
        token.allowance(account, STAKE_ADDRESS),
        staking.hasStaked(account),
        staking.paused()
      ]);

      if (isPaused) throw new Error("Staking is paused.");
      if (amount > balance) throw new Error("Insufficient NAVAA balance.");
      if (amount > capacity) throw new Error("Amount exceeds stake capacity.");
      if (allowance < amount) throw new Error("Approve NAVAA before staking.");

      let referrer = ethers.ZeroAddress;

      if (!alreadyStaked) {
        const value = $("earnReferrer")?.value?.trim();

        if (!value) {
          throw new Error("A referral address is required for your first stake.");
        }

        if (!ethers.isAddress(value)) {
          throw new Error("Invalid referral wallet address.");
        }

        referrer = ethers.getAddress(value);

        if (referrer.toLowerCase() === account.toLowerCase()) {
          throw new Error("You cannot refer yourself.");
        }
      }

      setBusy(true);
      setStatus("Please confirm your staking transaction...");

      const tx = await staking.stake(amount, referrer);

      setStatus("Staking submitted. Waiting for blockchain confirmation...");

      await tx.wait();

      const amountInput = $("earnStakeAmount");
      const referralInput = $("earnReferrer");

      if (amountInput) amountInput.value = "";
      if (referralInput) referralInput.value = "";

      setStatus("Staking successful! Your position has been created.");

    } catch (error) {
      setStatus(showError(error), true);

    } finally {
      setBusy(false);
      await refreshDashboard();
      await loadHistory();
    }
  }

  /* =========================================
     CLAIM STAKING REWARD
  ========================================= */

  async function claimReward(positionId) {
    if (busy) return;

    try {
      if (!account) throw new Error("Connect your wallet first.");

      const nextClaim = await staking.nextRewardClaimAt(account);

      if (nextClaim > currentTime()) {
        throw new Error(
          "Your 30-day reward claim cooldown is still active."
        );
      }

      const preview = await staking.previewReward(account, positionId);

      if (preview === 0n) {
        throw new Error("No staking reward is available.");
      }

      setBusy(true);
      setStatus("Please confirm reward claim in your wallet...");

      const tx = await staking.claimStakingReward(positionId);

      setStatus("Reward claim submitted. Waiting for confirmation...");

      await tx.wait();

      setStatus("Staking reward claimed successfully.");

    } catch (error) {
      setStatus(showError(error), true);

    } finally {
      setBusy(false);
      await refreshDashboard();
      await loadHistory();
    }
  }

  /* =========================================
     WITHDRAW PRINCIPAL
  ========================================= */

  async function withdrawPrincipal(positionId) {
    if (busy) return;

    try {
      if (!account) throw new Error("Connect your wallet first.");

      const position = await staking.getPosition(account, positionId);
      const unlocksAt = position.unlocksAt ?? position[3];
      const withdrawn = position.principalWithdrawn ?? position[5];

      if (withdrawn) throw new Error("Principal already withdrawn.");

      if (currentTime() < unlocksAt) {
        throw new Error("Your 1,825-day lock period is not complete.");
      }

      setBusy(true);
      setStatus("Please confirm principal withdrawal...");

      const tx = await staking.withdrawPrincipal(positionId);

      setStatus("Withdrawal submitted. Waiting for confirmation...");

      await tx.wait();

      setStatus(
        "Principal withdrawn successfully. Contract withdrawal fee is 0.5%."
      );

    } catch (error) {
      setStatus(showError(error), true);

    } finally {
      setBusy(false);
      await refreshDashboard();
      await loadHistory();
    }
  }

  /* =========================================
     WITHDRAW REFERRAL REWARDS
  ========================================= */

  async function withdrawReferral() {
    if (busy) return;

    try {
      if (!account) throw new Error("Connect your wallet first.");

      const amount = await staking.referralBalance(account);

      if (amount === 0n) {
        throw new Error("No referral rewards available.");
      }

      setBusy(true);
      setReferralStatus("Please confirm referral withdrawal...");

      const tx = await staking.withdrawReferralReward(amount);

      setReferralStatus("Withdrawal submitted. Waiting for confirmation...");

      await tx.wait();

      setReferralStatus(
        "Referral rewards withdrawn. Contract withdrawal fee is 0.5%."
      );

    } catch (error) {
      setReferralStatus(showError(error), true);

    } finally {
      setBusy(false);
      await refreshDashboard();
      await loadHistory();
    }
  }

  /* =========================================
     COPY REFERRAL ADDRESS
  ========================================= */

  async function copyReferralAddress() {
    if (!account) {
      setReferralStatus("Connect your wallet first.", true);
      return;
    }

    try {
      const field = $("earnReferralLink");

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(account);
      } else if (field) {
        field.focus();
        field.select();

        if (!document.execCommand("copy")) {
          throw new Error("Copy unavailable.");
        }
      }

      setReferralStatus("Your referral wallet address has been copied.");

    } catch (error) {
      setReferralStatus(
        "Copy failed. Please copy your address manually.",
        true
      );
    }
  }

  /* =========================================
     RECENT TRANSACTION HISTORY
  ========================================= */

  async function loadHistory() {
    const box = $("earnHistoryList");

    if (!box || !account || !staking || !provider) return;

    box.replaceChildren(
      createElement("div", "earn-empty-state", "Loading recent activity...")
    );

    try {
      const latestBlock = await provider.getBlockNumber();

      const fromBlock = Math.max(
        0,
        latestBlock - HISTORY_BLOCK_WINDOW
      );

      const eventFilters = [
        staking.filters.Staked(account),
        staking.filters.RewardClaimed(account),
        staking.filters.PrincipalWithdrawn(account),
        staking.filters.ReferralWithdrawn(account)
      ];

      const eventResults = await Promise.allSettled(
        eventFilters.map(filter =>
          staking.queryFilter(filter, fromBlock, latestBlock)
        )
      );

      const events = [];

      eventResults.forEach(result => {
        if (result.status === "fulfilled") {
          events.push(...result.value);
        }
      });

      events.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return b.blockNumber - a.blockNumber;
        }

        return b.index - a.index;
      });

      box.replaceChildren();

      if (!events.length) {
        box.appendChild(
          emptyState(
            "No recent transactions",
            "No matching events were found in the recent scan range."
          )
        );
        return;
      }

      for (const event of events.slice(0, 30)) {
        const name = event.fragment.name;
        const args = event.args;

        let label = name;
        let amount = "—";

        if (name === "Staked") {
          label = "NAVAA Staked";
          amount = formatAmount(args.amount) + " NAVAA";
        }

        if (name === "RewardClaimed") {
          label = "Reward Claimed";
          amount = formatAmount(args.net) + " NAVAA";
        }

        if (name === "PrincipalWithdrawn") {
          label = "Principal Withdrawn";
          amount = formatAmount(args.net) + " NAVAA";
        }

        if (name === "ReferralWithdrawn") {
          label = "Referral Withdrawn";
          amount = formatAmount(args.net) + " NAVAA";
        }

        const row = createElement("div", "earn-history-item");

        row.append(
          createElement("strong", "", label),
          createElement("span", "", amount),
          createElement("span", "", "Confirmed")
        );

        const details = createElement("div", "earn-history-item");
        details.textContent =
          "Block " + event.blockNumber +
          " · " + shorten(event.transactionHash);

        box.append(row, details);
      }

      const note = createElement(
        "p",
        "earn-history-note",
        "Showing recent matching events from the last 500,000 Polygon blocks."
      );

      box.appendChild(note);

    } catch (error) {
      console.warn("NAVAA history unavailable:", error);

      box.replaceChildren(
        emptyState(
          "History temporarily unavailable",
          "Your staking functions can still work. The wallet RPC did not provide event history."
        )
      );
    }
  }

  /* =========================================
     BUTTON EVENTS
  ========================================= */

  function bindEvents() {
    const input = $("earnStakeAmount");

    if (input) {
      input.addEventListener("input", updateStakeButtons);
    }

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

    setupMaxButton();
  }

  /* =========================================
     WALLET EVENTS
  ========================================= */

  
function bindWalletEvents() {
  // Sync Earn module with the main website Connect Wallet button
  const connectButton = $("connectBtn");

  if (connectButton) {
    connectButton.addEventListener("click", async () => {
      setStatus("Connecting Earn to your wallet...");

      try {
        let connected = false;

        // Wait for the main wallet connection to finish
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));

          const accounts = await window.ethereum.request({
            method: "eth_accounts"
          });

          if (accounts && accounts.length > 0) {
            connected = await connectEarnWallet();
            if (connected) break;
          }
        }

        if (connected) {
          await refreshDashboard();
          await loadHistory();
        } else {
          setStatus(
            "Earn could not detect the connected wallet. Please reconnect.",
            true
          );
        }
      } catch (error) {
        setStatus(showError(error), true);
      }
    });
  }

  if (!window.ethereum?.on) return;

  window.ethereum.on("accountsChanged", async () => {
    try {
      const connected = await connectEarnWallet();

      if (connected) {
        await refreshDashboard();
        await loadHistory();
      } else {
        account = null;
        signer = null;
        token = null;
        staking = null;
        resetDashboard();
        setStatus("Connect your wallet to start staking.");
      }
    } catch (error) {
      resetDashboard();
      setStatus(showError(error), true);
    }
  });

  window.ethereum.on("chainChanged", () => {
    window.location.reload();
  });
}


  /* =========================================
     INITIALIZATION
  ========================================= */

  async function init() {
    bindEvents();
    bindWalletEvents();
    resetDashboard();

    try {
      const connected = await connectEarnWallet();

      if (connected) {
        await refreshDashboard();
        await loadHistory();
      } else {
        setStatus("Connect your wallet to start staking.");
      }

    } catch (error) {
      setStatus(showError(error), true);
    }

    if (refreshTimer) clearInterval(refreshTimer);

    refreshTimer = setInterval(async () => {
      if (
        account &&
        !busy &&
        $("pageEarn")?.classList.contains("active")
      ) {
        try {
          await refreshDashboard();
        } catch (error) {
          console.warn("Earn auto-refresh:", error);
        }
      }
    }, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();
