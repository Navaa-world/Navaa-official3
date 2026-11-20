/* ============================================================
   NAVAA OFFICIAL — CONSOLIDATED APPLICATION JAVASCRIPT
   Execution order preserved: Theme → Dashboard tabs → Wallet/App → Earn → Refer
   CONTRACT ABIs ARE PRESERVED VERBATIM. Do not edit ABI arrays casually.
   ============================================================ */

/* 01. THEME SYSTEM — formerly inline script 1 in index.html */


      /*=========================================================
                          JAVASCRIPT START
      ==========================================================*/
      
      /*========================================
                  NAVAA THEME SYSTEM
      ========================================*/

      const themeToggle = document.getElementById("themeToggle");
      function setTheme(theme) {
        document.documentElement.setAttribute(
          "data-theme",
          theme
        );

        localStorage.setItem("navaa-theme", theme);

        if (themeToggle) {
          themeToggle.textContent =
            theme === "dark" ? "☀" : "☾";
        }
      }
      
      /**************************************
                  Load saved theme
      **************************************/

      const savedTheme =
        localStorage.getItem("navaa-theme") || "dark";
      setTheme(savedTheme);

    /**************************************
                  Toggle theme
    **************************************/

      themeToggle.addEventListener("click", () => {

        const currentTheme =
          document.documentElement.getAttribute("data-theme");
        setTheme(
          currentTheme === "dark" ? "light" : "dark"
        );
      });
      
    

/* 02. DASHBOARD CARD TABS — formerly inline script 2 in index.html */


/* ==========================================
   NAVAA DASHBOARD — CARD TAB CONTROLLER
   Uses the existing card slider without
   changing its CSS or swipe behavior.
========================================== */

(() => {
  const track = document.getElementById("dashboardEarningCards");

  const tabs = document.querySelectorAll(
    "#pageDashboard .dashboard-card-tab"
  );

  if (!track || !tabs.length) return;

  const cards = Array.from(
    track.querySelectorAll(".dashboard-earning-card")
  );

  if (cards.length !== 3 || tabs.length !== 3) return;

  let scrollFrame = null;

  function setActiveTab(index) {
    tabs.forEach((tab, i) => {
      const active = i === index;

      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
  }

  function goToCard(index) {
    const card = cards[index];
    if (!card) return;

    /* Preserve the current desktop grid.
       Use the existing horizontal slider when available. */
    if (track.scrollWidth > track.clientWidth + 2) {
      const firstCardLeft = cards[0].offsetLeft;

      track.scrollTo({
        left: card.offsetLeft - firstCardLeft,
        behavior: "smooth"
      });
    }

    setActiveTab(index);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      goToCard(index);
    });
  });

  /* Update selected tab during manual swipe */
  track.addEventListener("scroll", () => {
    if (scrollFrame) {
      cancelAnimationFrame(scrollFrame);
    }

    scrollFrame = requestAnimationFrame(() => {
      if (track.scrollWidth <= track.clientWidth + 2) return;

      const trackRect = track.getBoundingClientRect();
      const trackCentre = trackRect.left + trackRect.width / 2;

      let nearestIndex = 0;
      let nearestDistance = Infinity;

      cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        const centre = rect.left + rect.width / 2;
        const distance = Math.abs(centre - trackCentre);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      setActiveTab(nearestIndex);
    });
  });

})();


/* 03. WALLET / TOKEN BALANCE / PAGE NAVIGATION — formerly inline script 3 in index.html */


      (() => {
        'use strict';
        const TOKEN_ADDRESS =
          '0x82dba663278ADF0c398c1795a31760c7a76CA932';

        const POLYGON_CHAIN_ID = 137n;
        const TOKEN_ABI = [
          'function balanceOf(address) view returns (uint256)',
          'function decimals() view returns (uint8)',
          'function symbol() view returns (string)'
        ];

        const $ = id => document.getElementById(id);
        const appPages = document.querySelectorAll('.app-page');
        const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
        const connectBtn = $('connectBtn');
        const balanceAmount = $('navaaBalanceAmount');
        const balanceStatus = $('navaaBalanceStatus');
        const balanceVisibilityBtn = $('balanceVisibilityBtn');
       
        let balanceHidden = false;
        let actualBalanceText = '—';
        
        const eyeOpenIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/>
        <circle cx="12" cy="12" r="3"/>
        </svg>`;
        
        const eyeClosedIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3 3 18 18"/>
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/>
        <path d="M9.9 5.2A11 11 0 0 1 12 5c6.4 0 10 7 10 7a14 14 0 0 1-3 3.8"/>
        <path d="M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3-.5"/>
        </svg>`;

        let walletAddress = null;

        function shortAddress(address) {
          return address.slice(0, 6) + '...' + address.slice(-4);
        }
        
        function showBalance(value) {
          actualBalanceText = value;
          balanceAmount.textContent = balanceHidden
            ? '••••••••'
            : actualBalanceText;
        }

        balanceVisibilityBtn.addEventListener('click', () => {
          balanceHidden = !balanceHidden;
            showBalance(actualBalanceText);

          balanceVisibilityBtn.innerHTML = balanceHidden
            ? eyeClosedIcon
            : eyeOpenIcon;
          
          balanceVisibilityBtn.setAttribute(
            'aria-label',
            balanceHidden ? 'Show balance' : 'Hide balance'
          );

          balanceVisibilityBtn.title =
            balanceHidden ? 'Show balance' : 'Hide balance';

          /* Balance status slide animation */
          const earnNotice = document.getElementById("balanceEarnNotice");
          if (earnNotice) {
            earnNotice.classList.toggle("is-collapsed", balanceHidden);
          }
        });
 
        function showStatus(message) {
          balanceStatus.textContent = message;
        }

        /*============================================
              Balance down status show for staking 
          ===========================================*/
        
function updateEarnEligibility(rawBalance, tokenDecimals) {
  const notice = document.getElementById("balanceEarnNotice");
  const message = document.getElementById("balanceEarnText");
  const icon = document.getElementById("balanceEarnIcon");
  const goButton = document.getElementById("goEarnBtn");

  if (!notice || !message || !icon) return;

  const minimum = ethers.parseUnits("1000", tokenDecimals);

  if (rawBalance >= minimum) {
    if (goButton) goButton.hidden = false;
    notice.classList.remove("is-ineligible");

    icon.textContent = "";
    message.textContent =
      "Eligible to Earn ~25.55% APR";

  } else {
    if (goButton) goButton.hidden = true;
    notice.classList.add("is-ineligible");

    const remaining = minimum - rawBalance;

    const remainingFormatted = Number(
      ethers.formatUnits(remaining, tokenDecimals)
    ).toLocaleString("en-US", {
      maximumFractionDigits: 4
    });

    icon.textContent = "◈";
    message.textContent =
      "Only " + remainingFormatted +
      " more Earn ~25.55% APR";
  }
}
/*========================================================*/
        
        
        async function readNavaaBalance() {
          if (!walletAddress || !window.ethereum) return;
          try {
            const walletProvider =
              new ethers.BrowserProvider(window.ethereum);
            const network = await walletProvider.getNetwork();

            if (network.chainId !== POLYGON_CHAIN_ID) {
              showBalance('—');
              showStatus('Please switch to Polygon Mainnet');
              return;
            }

            const token = new ethers.Contract(
              TOKEN_ADDRESS,
              TOKEN_ABI,
              walletProvider
            );

            const [rawBalance, decimals, symbol] =
              await Promise.all([
                token.balanceOf(walletAddress),
                token.decimals(),
                token.symbol()
              ]);

            const formatted = Number(
              ethers.formatUnits(rawBalance, decimals)
            ).toLocaleString('en-US', {
              maximumFractionDigits: 4
            });
     
            showBalance(formatted);
            updateEarnEligibility(rawBalance, decimals);
            showStatus(
              shortAddress(walletAddress) +
              ' · ' + symbol + ' balance on Polygon'
            );
          } 
          
          catch (error) {
            console.error('NAVAA balance error:', error);
            showBalance('—');
            showStatus('Unable to load NAVAA balance. Please retry.');
          }
        }

        /* NAVAA LIVE BALANCE REFRESH */
        window.addEventListener("navaa:refresh-balance", () => {
          if (walletAddress) {
            readNavaaBalance();
          }
        });

        async function connectWallet() {
          try {
            if (!window.ethereum) {
              showStatus('Open this website inside MetaMask, Trust Wallet or SafePal DApp browser.');
              return;
            }

            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';

            let accounts = await window.ethereum.request({
              method: 'eth_requestAccounts'
            });

            if (!accounts || !accounts.length) {
              throw new Error('No wallet account found.');
            }

            let chain = await window.ethereum.request({
              method: 'eth_chainId'
            });

            if (BigInt(chain) !== POLYGON_CHAIN_ID) {
              try {
                await window.ethereum.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x89' }]
                });
              } catch (error) {
                if (error.code === 4902) {
                  await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                      chainId: '0x89',
                      chainName: 'Polygon Mainnet',
                      nativeCurrency: {
                        name: 'POL',
                        symbol: 'POL',
                        decimals: 18
                      },
                      rpcUrls: ['https://polygon.drpc.org'],
                      blockExplorerUrls: ['https://polygonscan.com']
                    }]
                  });
                }
                else {
                  throw error;
                }
              }
            }

            accounts = await window.ethereum.request({
              method: 'eth_accounts'
            });
            
            walletAddress = accounts[0];
            connectBtn.textContent = shortAddress(walletAddress);
            await readNavaaBalance();
          }
          
          catch (error) {
            console.error('Wallet connection error:', error);
            showStatus(error.message || 'Wallet connection failed.');
            connectBtn.textContent = 'Connect wallet';
          }
          
          finally {
            connectBtn.disabled = false;
          }
        }
        
        connectBtn.addEventListener('click', connectWallet);
        if (window.ethereum && window.ethereum.on) {
          window.ethereum.on('accountsChanged', accounts => {
            walletAddress = accounts.length ? accounts[0] : null;
            if (!walletAddress) {
              connectBtn.textContent = 'Connect wallet';
              showBalance('—');
              showStatus('Connect wallet to view your balance');
              const earnNotice = document.getElementById("balanceEarnNotice");
              const earnText = document.getElementById("balanceEarnText");
              const earnIcon = document.getElementById("balanceEarnIcon");
              if (earnNotice) earnNotice.classList.remove("is-ineligible");
              const goButton = document.getElementById("goEarnBtn");
              if (goButton) goButton.hidden = true;
              if (earnText) earnText.textContent = "Connect wallet to check your Earn eligibility.";
              if (earnIcon) earnIcon.textContent = "↗";
              return;
            }

            connectBtn.textContent = shortAddress(walletAddress);
            readNavaaBalance();
          });

          window.ethereum.on('chainChanged', () => {
            readNavaaBalance();
        });
      }
 
        // Restore an already-authorized wallet without a new permission prompt
        
        async function restoreWallet() {
          if (!window.ethereum) return;
          try {
            const accounts = await window.ethereum.request({
              method: 'eth_accounts'
            });
            if (accounts.length) {
              walletAddress = accounts[0];
              connectBtn.textContent = shortAddress(walletAddress);
              await readNavaaBalance();
            }
          } 
          
          catch (error) {
            console.error(error);
          }
        }

        restoreWallet();
        /* Auto-sync wallet balance */
        setInterval(() => {
          if (
            walletAddress &&
            document.visibilityState === "visible"
          ) {
            readNavaaBalance();
          }
        }, 10000);
        
         /* =================================
             NAVAA PAGE NAVIGATION SYSTEM
        ==================================== */

        function showPage(pageName) {
          const validPages = [
            'dashboard',
            'earn',
            'refer',
            'exchange'
          ];

          if (!validPages.includes(pageName)) return;
            appPages.forEach(page => {
            page.classList.remove('active');
          });
          
          const targetPage = document.getElementById(
            'page' + pageName.charAt(0).toUpperCase() + pageName.slice(1)
          );

          if (targetPage) {
            targetPage.classList.add('active');
          }

            bottomNavItems.forEach(button => {
            const isActive = button.dataset.pageTarget === pageName;
            button.classList.toggle('active', isActive);

            if (isActive) {
              button.setAttribute('aria-current', 'page');
            } else {
              button.removeAttribute('aria-current');
            }
          });

          window.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }

        const goEarnButton = document.getElementById("goEarnBtn");
        if (goEarnButton) {
          goEarnButton.addEventListener("click", () => {
            showPage("earn");
          });
        }

        
        /*========== Bottom navigation clicks ==============*/
          bottomNavItems.forEach(button => {
          button.addEventListener('click', () => {
            showPage(button.dataset.pageTarget);
          });
        });
        
        /*=========== Logo always opens Dashboard ==============*/
        document.getElementById('homeLogoBtn').addEventListener('click', () => {
          showPage('dashboard');
        });


        /*================================
                  Add Fund popup
        ================================*/
        $('addFundBtn').addEventListener('click', () => {
          $('fundSheet').classList.add('show');
        });

        $('closeFundSheet').addEventListener('click', () => {
          $('fundSheet').classList.remove('show');
        });

        $('fundSheet').addEventListener('click', event => {
          if (event.target === $('fundSheet')) {
            $('fundSheet').classList.remove('show');
          }
        });

        $('fundP2P').addEventListener('click', () => {
          $('fundMessage').textContent = 'P2P is coming soon.';
        });

        $('fundExchange').addEventListener('click', () => {
          $('fundSheet').classList.remove('show');
          showPage('exchange');
        });  
      })();
    

/* 04. EARN & STAKING CONTRACT LOGIC — moved verbatim from earn.js */


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
  let dashboardRewardFrame = null;
  let dashboardRewardBase = 0;
  let dashboardRewardPrincipal = 0;
  let dashboardRewardStartedAt = 0;

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

  /* Dashboard-only visual estimate between on-chain reward reads.
     The contract preview remains the source of truth. */
  /* Dashboard reward counter: smooth local interpolation between contract reads.
     The on-chain preview remains authoritative; this never sends 10ms RPC calls. */
  function stopDashboardRewardTicker() {
    if (dashboardRewardFrame !== null) {
      cancelAnimationFrame(dashboardRewardFrame);
      dashboardRewardFrame = null;
    }
  }

  function startDashboardRewardTicker(baseReward, activePrincipal) {
    stopDashboardRewardTicker();

    dashboardRewardBase = Number(ethers.formatUnits(baseReward, decimals));
    dashboardRewardPrincipal = Number(ethers.formatUnits(activePrincipal, decimals));
    dashboardRewardStartedAt = performance.now();

    const render = (now) => {
      const elapsedSeconds = Math.max(0, (now - dashboardRewardStartedAt) / 1000);
      const rewardPerSecond = dashboardRewardPrincipal * 0.0007 / 86400;
      const liveEstimate = dashboardRewardBase + rewardPerSecond * elapsedSeconds;
      const display = $("dashboardEligibleReward");

      if (display) {
        display.textContent = liveEstimate.toLocaleString("en-US", {
          minimumFractionDigits: 8,
          maximumFractionDigits: 10
        });
        display.title = "Live estimated reward. The Polygon contract preview is periodically synchronized.";
      }

      dashboardRewardFrame = requestAnimationFrame(render);
    };

    dashboardRewardFrame = requestAnimationFrame(render);
  }

  function shorten(address) {
    if (!address) return "—";

    return address.slice(0, 6) + "..." + address.slice(-4);
  }
   
/* REFERRAL LINK HELPERS */
function getReferralFromUrl() {
  try {
    const ref = new URLSearchParams(
      window.location.search
    ).get("ref");

    if (ref && ethers.isAddress(ref)) {
      return ethers.getAddress(ref);
    }
  } catch (error) {
    console.warn("Invalid referral URL:", error);
  }

  return "";
}

function getReferralLink() {
  if (!account) return "";

  const url = new URL(
    window.location.pathname,
    window.location.origin
  );

  url.searchParams.set("ref", account);

  return url.toString();
}
/*=====================*/
   

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

    const copy = $("earnCopyReferralBtn");
     if (copy) {
        copy.disabled = value || !account;
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
     setText("dashboardStakedAmount", "—");
     setText("dashboardEligibleReward", "—");
     setText("dashboardAllPositions", "—");
    stopDashboardRewardTicker();
    dashboardRewardBase = 0;
    dashboardRewardPrincipal = 0;
    dashboardRewardStartedAt = 0;
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
        staking.paused(),
        token.allowance(account, STAKE_ADDRESS)
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
       const allowance = getValue(10);

/* Sync live blockchain values */
walletBalanceRaw = walletBalance ?? 0n;
capacityRaw = capacity ?? 0n;
allowanceRaw = allowance ?? 0n;
pausedState = isPaused === true;

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

    /*  const referralInput = $("earnReferrer");

      if (referralInput) {
        if (alreadyStaked === true) {
          referralInput.value = "";
          referralInput.placeholder = "Not required for subsequent stakes";
          referralInput.disabled = true;
        } else {
          referralInput.disabled = false;
          referralInput.placeholder = "Enter referrer's wallet address";
        }
      }  */

       const referralInput = $("earnReferrer");

if (referralInput) {
  if (alreadyStaked === true) {
    referralInput.value = "";
    referralInput.placeholder = "Not required for subsequent stakes";
    referralInput.disabled = true;

  } else {
    referralInput.disabled = false;
    referralInput.placeholder = "Enter referrer's wallet address";

    if (!referralInput.value.trim()) {
      const incomingReferral = getReferralFromUrl();

      if (
        incomingReferral &&
        incomingReferral.toLowerCase() !== account.toLowerCase()
      ) {
        referralInput.value = incomingReferral;
      }
    }
  }
}


       

     /* const referralAddress = $("earnReferralLink");

      if (referralAddress) {
        referralAddress.value = account;
      } */

       const referralAddress = $("earnReferralLink");
       if (referralAddress) {
          referralAddress.value = getReferralLink();
       }


       
       const copyReferralButton = $("earnCopyReferralBtn");
       if (copyReferralButton) {
          copyReferralButton.disabled = !account || busy;
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
       setText("dashboardStakedAmount", "0");
       setText("dashboardEligibleReward", "0");
       setText("dashboardAllPositions", "0");
       startDashboardRewardTicker(0n, 0n);
      return;
    }

     let totalPreview = 0n;
     let totalDashboardStaked = 0n;
     let totalActivePositions = 0;
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

       if (!withdrawn) {
          totalDashboardStaked += BigInt(principal.toString());
          totalActivePositions++;
       }
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
     setText(
        "dashboardStakedAmount",
        formatAmount(totalDashboardStaked)
     );
     setText(
        "dashboardEligibleReward",
        formatAmount(totalPreview, 8)
     );
     setText(
        "dashboardAllPositions",
        totalActivePositions.toString()
     );

     /* Animate the Dashboard total locally; no 10ms blockchain requests. */
     startDashboardRewardTicker(totalPreview, totalDashboardStaked);
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
         staking.paused(),
         token.allowance(account, STAKE_ADDRESS)
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
       
       window.dispatchEvent(
          new Event("navaa:refresh-balance")
       );
       
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

      stopDashboardRewardTicker();
      setText("dashboardEligibleReward", "Syncing…");
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

/*  async function copyReferralAddress() {
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
  } */

   async function copyReferralAddress() {
  if (!account) {
    setReferralStatus("Connect your wallet first.", true);
    return;
  }

  try {
    const field = $("earnReferralLink");
    const referralLink = getReferralLink();

    if (!referralLink) {
      throw new Error("Referral link could not be generated.");
    }

    if (field) {
      field.value = referralLink;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(referralLink);

    } else if (field) {
      field.focus();
      field.select();

      if (!document.execCommand("copy")) {
        throw new Error("Copy unavailable.");
      }
    }

    setReferralStatus("Your referral link has been copied.");

  } catch (error) {
    setReferralStatus(
      "Copy failed. Please copy your referral link manually.",
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
        (
          $("pageEarn")?.classList.contains("active") ||
          $("pageDashboard")?.classList.contains("active")
        )
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


/* 05. REFER & EARN CONTRACT LOGIC — moved verbatim from refer.js */

/* NAVAA REFER & EARN — isolated on-chain dashboard */
(() => {
  "use strict";
  if (window.NAVAA_REFER_INITIALIZED) return;
  window.NAVAA_REFER_INITIALIZED = true;

  const STAKE_ADDRESS = "0xE46E8b1AC4CDFAE9CF9d1D9B0BD6D1705CB5B8C9";
  const CHAIN_ID = 137n;
  const RECENT_FALLBACK_BLOCKS = 500000;
  const LOG_CHUNK = 10000;
  const RPC_URLS = [
    "https://polygon.drpc.org",
    "https://polygon-bor-rpc.publicnode.com"
  ];
  const ABI = [
    "function referralBalance(address user) view returns (uint256)",
    "function withdrawReferralReward(uint256 amount)",
    "event Staked(address indexed user,uint256 indexed positionId,uint256 amount,address indexed referrer,uint256 referralReward)",
    "event ReferralWithdrawn(address indexed user,uint256 gross,uint256 fee,uint256 net)"
  ];
  const iface = new ethers.Interface(ABI);
  const STAKED_TOPIC = iface.getEvent("Staked").topicHash;
  const WITHDRAW_TOPIC = iface.getEvent("ReferralWithdrawn").topicHash;
  const $ = id => document.getElementById(id);

  let walletProvider=null, signer=null, readContract=null, writeContract=null, account=null;
  let eventProviders=[], eventProvider=null, deploymentBlock=null, historyStart=null, deploymentBlockKnown=false;
  let cacheLoadedFor=null;
  let lastScannedBlock=null, cachedStakes=[], cachedWithdrawals=[];
  let busy=false, refreshRunning=false, refreshTimer=null, lastRefreshAt=0;

  function cacheKey(){return 'navaa_ref_history_v2_'+String(account||'').toLowerCase();}
  function persistHistoryCache(){
    if(!account||lastScannedBlock===null)return;
    try{
      const pack=items=>items.map(x=>({name:x.parsed.name,args:Object.fromEntries(Object.entries(x.parsed.args).filter(([k])=>!/^\\d+$/.test(k)).map(([k,v])=>[k,typeof v==='bigint'?v.toString():v])),blockNumber:x.blockNumber,transactionHash:x.transactionHash,logIndex:x.logIndex}));
      const payload={lastScannedBlock,deploymentBlock,historyStart,deploymentBlockKnown,stakes:pack(cachedStakes),withdrawals:pack(cachedWithdrawals)};
      localStorage.setItem(cacheKey(),JSON.stringify(payload));
    }catch(error){console.warn('Could not save NAVAA referral cache:',error);}
  }
  function restoreHistoryCache(){
    if(!account||cacheLoadedFor===account)return;
    cacheLoadedFor=account;
    try{
      const raw=localStorage.getItem(cacheKey());if(!raw)return;
      const data=JSON.parse(raw);
      const restore=items=>(Array.isArray(items)?items:[]).map(x=>({parsed:{name:x.name,args:x.args||{}},blockNumber:Number(x.blockNumber),transactionHash:x.transactionHash,logIndex:Number(x.logIndex||0)}));
      if(Number.isFinite(Number(data.lastScannedBlock))){
        lastScannedBlock=Number(data.lastScannedBlock);
        deploymentBlock=data.deploymentBlock==null?null:Number(data.deploymentBlock);
        historyStart=data.historyStart==null?null:Number(data.historyStart);
        deploymentBlockKnown=!!data.deploymentBlockKnown;
        cachedStakes=restore(data.stakes);cachedWithdrawals=restore(data.withdrawals);
        renderDashboardEvents(cachedStakes,cachedWithdrawals);
        setText('referScanNote','Showing saved referral history while checking for new Polygon activity…');
      }
    }catch(error){console.warn('Could not restore NAVAA referral cache:',error);}
  }
  function renderDashboardEvents(stakes,withdrawals){
    const lifetime=stakes.reduce((sum,x)=>sum+BigInt(x.parsed.args.referralReward||0),0n);
    const withdrawn=withdrawals.reduce((sum,x)=>sum+BigInt(x.parsed.args.net||0),0n);
    const unique=new Set(stakes.map(x=>String(x.parsed.args.user).toLowerCase()));
    setText('referLifetimeEarned',format(lifetime)+' NAVAA');
    setText('referTotalCount',String(unique.size));
    setText('referWithdrawn',format(withdrawn)+' NAVAA');
    renderReferrals(stakes);renderHistory(stakes,withdrawals);
  }

  const setText=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  const short=value=>value?value.slice(0,6)+"..."+value.slice(-4):"—";
  const format=value=>{
    try{return Number(ethers.formatUnits(value,18)).toLocaleString("en-US",{maximumFractionDigits:4});}
    catch{return "—";}
  };
  const txUrl=hash=>"https://polygonscan.com/tx/"+hash;
  const make=(tag,cls,value)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(value!==undefined)el.textContent=value;
    return el;
  };
  function status(message,error=false){
    const el=$("referStatus");
    if(el){el.textContent=message;el.style.color=error?"#f6465d":"";}
  }
  function linkValue(){
    return account?location.origin+location.pathname+"?ref="+encodeURIComponent(account):"";
  }
  function updateLink(){
    const input=$("referLinkInput"),copy=$("referCopyBtn"),share=$("referShareBtn");
    if(input)input.value=linkValue();
    if(copy)copy.disabled=!account;
    if(share)share.disabled=!account;
    setText("referLinkStatus",account?"Your personal referral link is ready.":"Connect your Polygon wallet to generate a link.");
  }
  function emptyTable(message){
    const body=$("referListBody");if(!body)return;
    body.replaceChildren();
    const row=make("tr"),cell=make("td","refer-empty",message);
    cell.colSpan=4;row.appendChild(cell);body.appendChild(row);
  }
  function reset(){
    ["referLifetimeEarned","referTotalCount","referAvailable","referWithdrawn","referClaimable"].forEach(id=>setText(id,"—"));
    emptyTable("Connect your wallet to load referral activity.");
    const history=$("referHistoryList");
    if(history)history.replaceChildren(make("div","refer-empty","Connect your wallet to load referral history."));
    const btn=$("referWithdrawBtn"),input=$("referWithdrawAmount"),max=$("referMaxBtn");
    if(btn)btn.disabled=true;if(input)input.disabled=true;if(max)max.disabled=true;
    updateLink();status("Connect your wallet to view your referral dashboard.");
  }

  async function connectWallet(){
    if(!window.ethereum)throw new Error("Open NAVAA in MetaMask, Trust Wallet or SafePal.");
    walletProvider=new ethers.BrowserProvider(window.ethereum,"any");
    const accounts=await window.ethereum.request({method:"eth_accounts"});
    if(!accounts||!accounts.length){
      account=null;signer=null;readContract=null;writeContract=null;return false;
    }
    const network=await walletProvider.getNetwork();
    if(network.chainId!==CHAIN_ID)throw new Error("Please switch your wallet to Polygon Mainnet.");
    account=ethers.getAddress(accounts[0]);
    restoreHistoryCache();
    signer=await walletProvider.getSigner();
    readContract=new ethers.Contract(STAKE_ADDRESS,ABI,walletProvider);
    writeContract=new ethers.Contract(STAKE_ADDRESS,ABI,signer);
    await setupEventProviders();
    return true;
  }

  async function setupEventProviders(){
    if(eventProviders.length)return;
    const candidates=await Promise.all(RPC_URLS.map(async url=>{
      try{
        const p=new ethers.JsonRpcProvider(url,{name:"polygon",chainId:137});
        const network=await p.getNetwork();
        if(network.chainId===CHAIN_ID){await p.getBlockNumber();return p;}
      }catch(error){console.warn("NAVAA referral RPC unavailable:",url,error);}
      return null;
    }));
    eventProviders.push(...candidates.filter(Boolean));
    if(walletProvider)eventProviders.push(walletProvider);
    if(!eventProviders.length)throw new Error("No Polygon RPC is available for referral history.");
    eventProvider=eventProviders[0];
  }

  async function findDeploymentBlock(){
    if(deploymentBlock!==null)return deploymentBlock;
    const latest=await eventProvider.getBlockNumber();
    let low=0,high=latest;
    try{
      // Binary-search the first block containing the deployed contract.
      const latestCode=await eventProvider.getCode(STAKE_ADDRESS,latest);
      if(!latestCode||latestCode==="0x")throw new Error("Staking contract code was not found.");
      while(low<high){
        const mid=Math.floor((low+high)/2);
        const code=await eventProvider.getCode(STAKE_ADDRESS,mid);
        if(code&&code!=="0x")high=mid;else low=mid+1;
      }
      deploymentBlock=low;
      historyStart=low;
      deploymentBlockKnown=true;
    }catch(error){
      console.warn("Could not determine contract deployment block; using recent history window.",error);
      deploymentBlock=Math.max(0,latest-RECENT_FALLBACK_BLOCKS);
      historyStart=deploymentBlock;
      deploymentBlockKnown=false;
    }
    return deploymentBlock;
  }

  async function queryLogs(filter){
    let lastError;
    for(const p of eventProviders){
      try{return await p.getLogs(filter);}
      catch(error){lastError=error;console.warn("Referral event RPC failed; trying fallback.",error);}
    }
    throw lastError||new Error("Polygon event query failed.");
  }

  async function scanRange(from,to){
    const accountTopic=ethers.zeroPadValue(account,32).toLowerCase();
    const [stakeLogs,withdrawLogs]=await Promise.all([
      queryLogs({address:STAKE_ADDRESS,fromBlock:from,toBlock:to,topics:[STAKED_TOPIC,null,null,accountTopic]}),
      queryLogs({address:STAKE_ADDRESS,fromBlock:from,toBlock:to,topics:[WITHDRAW_TOPIC,accountTopic]})
    ]);
    const stakes=stakeLogs.map(log=>({parsed:iface.parseLog(log),blockNumber:log.blockNumber,transactionHash:log.transactionHash,logIndex:log.index??log.logIndex}));
    const withdrawals=withdrawLogs.map(log=>({parsed:iface.parseLog(log),blockNumber:log.blockNumber,transactionHash:log.transactionHash,logIndex:log.index??log.logIndex}));
    return {stakes,withdrawals};
  }

  async function loadAllReferralEvents(){
    const latest=await eventProvider.getBlockNumber();
    if(lastScannedBlock===null){
      await findDeploymentBlock();
      lastScannedBlock=historyStart-1;
    }
    const from=Math.max(historyStart,lastScannedBlock+1);
    if(from>latest)return {latest,from:historyStart,stakes:cachedStakes,withdrawals:cachedWithdrawals,fullHistory:deploymentBlockKnown};
    const ranges=[];
    for(let start=from;start<=latest;start+=LOG_CHUNK)ranges.push([start,Math.min(start+LOG_CHUNK-1,latest)]);
    let cursor=0;
    const newStakes=[],newWithdrawals=[];
    const workers=Array.from({length:6},async()=>{
      while(cursor<ranges.length){
        const index=cursor++,[start,end]=ranges[index];
        const events=await scanRange(start,end);
        newStakes.push(...events.stakes);newWithdrawals.push(...events.withdrawals);
        setText("referScanNote","Loading full referral history… scanned through block "+end.toLocaleString()+".");
      }
    });
    await Promise.all(workers);
    cachedStakes.push(...newStakes);cachedWithdrawals.push(...newWithdrawals);
    cachedStakes.sort((a,b)=>a.blockNumber-b.blockNumber||(a.logIndex||0)-(b.logIndex||0));
    cachedWithdrawals.sort((a,b)=>a.blockNumber-b.blockNumber||(a.logIndex||0)-(b.logIndex||0));
    lastScannedBlock=latest;
    persistHistoryCache();
    return {latest,from:historyStart,stakes:cachedStakes,withdrawals:cachedWithdrawals,fullHistory:deploymentBlockKnown};
  }

  function renderReferrals(events){
    const body=$("referListBody");if(!body)return;
    body.replaceChildren();
    const firstByWallet=new Map();
    for(const item of events){
      const a=item.parsed.args,who=String(a.user).toLowerCase();
      if(!firstByWallet.has(who))firstByWallet.set(who,item);
    }
    const rows=[...firstByWallet.values()];
    if(!rows.length){emptyTable("No wallets have completed a first stake using your referral link yet.");return;}
    for(const item of rows){
      const a=item.parsed.args,row=make("tr");
      row.append(make("td","refer-wallet-cell",short(a.user)),make("td","",format(a.amount)+" NAVAA"),make("td","",format(a.referralReward)+" NAVAA"));
      const cell=make("td"),link=make("a","","View transaction");
      link.href=txUrl(item.transactionHash);link.target="_blank";link.rel="noopener noreferrer";
      cell.appendChild(link);row.appendChild(cell);body.appendChild(row);
    }
  }

  function renderHistory(stakes,withdrawals){
    const box=$("referHistoryList");if(!box)return;
    const rows=[
      ...stakes.map(x=>({kind:"Referral reward generated",gross:BigInt(x.parsed.args.referralReward),fee:0n,net:BigInt(x.parsed.args.referralReward),block:x.blockNumber,hash:x.transactionHash})).filter(x=>x.gross>0n),
      ...withdrawals.map(x=>({kind:"Referral reward withdrawn",gross:BigInt(x.parsed.args.gross),fee:BigInt(x.parsed.args.fee),net:BigInt(x.parsed.args.net),block:x.blockNumber,hash:x.transactionHash}))
    ].sort((a,b)=>b.block-a.block).slice(0,50);
    box.replaceChildren();
    if(!rows.length){box.appendChild(make("div","refer-empty","No referral reward or withdrawal transactions found yet."));return;}
    for(const item of rows){
      const row=make("article","refer-history-item"),left=make("div"),right=make("div","refer-history-amount");
      left.append(make("strong","",item.kind),make("small","","Block "+item.block+" · "+short(item.hash)));
      right.append(make("strong","",format(item.net)+" NAVAA"));
      if(item.fee>0n)right.append(make("small","","Fee "+format(item.fee)+" NAVAA · Gross "+format(item.gross)));
      const link=make("a","","View on PolygonScan");
      link.href=txUrl(item.hash);link.target="_blank";link.rel="noopener noreferrer";
      right.appendChild(link);row.append(left,right);box.appendChild(row);
    }
  }

  function updateWithdrawalHint(balance){
    const input=$("referWithdrawAmount"),hint=$("referAmountHint");if(!input||!hint)return;
    const value=(input.value||"").trim();
    if(balance===undefined){hint.textContent="Connect your wallet to load your reward balance.";return;}
    if(!value){hint.textContent="Available: "+format(balance)+" NAVAA. Enter an amount or select MAX.";return;}
    try{
      const amount=ethers.parseUnits(value,18);
      hint.textContent=amount<=0n?"Enter an amount greater than zero.":amount>balance?"Amount is higher than your available balance.":"Selected "+format(amount)+" NAVAA. Contract fees, if any, are applied on-chain.";
    }catch{hint.textContent="Enter a valid amount with up to 18 decimal places.";}
  }

  async function refresh(){
    if(refreshRunning||!account||!readContract)return;
    refreshRunning=true;
    try{
      const balance=await readContract.referralBalance(account);
      setText("referAvailable",format(balance));
      setText("referClaimable",format(balance)+" NAVAA");
      const input=$("referWithdrawAmount"),max=$("referMaxBtn"),btn=$("referWithdrawBtn");
      if(input)input.disabled=balance===0n||busy;
      if(max)max.disabled=balance===0n||busy;
      if(btn)btn.disabled=balance===0n||busy;
      if(balance===0n&&input)input.value="";
      updateWithdrawalHint(balance);
      status("Available reward balance read directly from the staking contract.");

      try{
        const events=await loadAllReferralEvents();
        renderDashboardEvents(events.stakes,events.withdrawals);
        setText("referScanNote",events.fullHistory?"Complete event history scanned from staking contract deployment block "+events.from.toLocaleString()+".":"Showing recent referral events from block "+events.from.toLocaleString()+". Earlier activity may be missing.");
        status("Referral dashboard updated from Polygon Mainnet.");
      }catch(error){
        console.error("NAVAA referral history scan failed:",error);
        setText("referLifetimeEarned","History unavailable");
        setText("referTotalCount","—");
        setText("referWithdrawn","History unavailable");
        emptyTable("Referral event history could not be loaded. Available rewards above are still read from the contract.");
        const box=$("referHistoryList");if(box)box.replaceChildren(make("div","refer-empty","Referral history is temporarily unavailable. Please retry."));
        setText("referScanNote","Polygon RPC failed to return referral event history. The claimable balance is independently read from the staking contract.");
        status("Available balance loaded, but referral history needs another RPC attempt.",true);
      }
      lastRefreshAt=Date.now();
    }catch(error){
      console.error("NAVAA referral contract read failed:",error);
      setText("referAvailable","Read error");setText("referClaimable","Read error");
      const btn=$("referWithdrawBtn");if(btn)btn.disabled=true;
      status(error?.shortMessage||error?.reason||error?.message||"Could not read referral balance from Polygon.",true);
    }finally{refreshRunning=false;}
  }

  async function setMax(){
    if(!readContract||!account)return;
    try{
      const balance=await readContract.referralBalance(account),input=$("referWithdrawAmount");
      if(input)input.value=ethers.formatUnits(balance,18);
      updateWithdrawalHint(balance);
    }catch(error){status("Could not load the available referral balance.",true);}
  }

  async function withdraw(){
    if(busy||!account||!readContract||!writeContract)return;
    const input=$("referWithdrawAmount"),value=(input?.value||"").trim();
    if(!value){status("Enter an amount or press MAX.",true);input?.focus();return;}
    let amount;
    try{amount=ethers.parseUnits(value,18);}catch{status("Enter a valid NAVAA amount with up to 18 decimal places.",true);return;}
    if(amount<=0n){status("Withdrawal amount must be greater than zero.",true);return;}
    busy=true;
    const btn=$("referWithdrawBtn"),max=$("referMaxBtn");
    if(btn)btn.disabled=true;if(max)max.disabled=true;if(input)input.disabled=true;
    try{
      const balance=await readContract.referralBalance(account);
      if(amount>balance)throw new Error("Insufficient referral rewards. Available: "+format(balance)+" NAVAA.");
      status("Confirm withdrawal of "+format(amount)+" NAVAA in your wallet.");
      const tx=await writeContract.withdrawReferralReward(amount);
      status("Withdrawal submitted. Waiting for Polygon confirmation…");
      await tx.wait();
      if(input)input.value="";
      status("Withdrawal confirmed. Updating your remaining reward balance…");
      cachedStakes=[];cachedWithdrawals=[];lastScannedBlock=null;
      await refresh();
    }catch(error){
      console.error("NAVAA referral withdrawal failed:",error);
      status(error?.shortMessage||error?.reason||error?.message||"Referral withdrawal failed.",true);
    }finally{busy=false;if(account)await refresh();}
  }

  async function copyLink(){
    const url=linkValue();if(!url)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);
      else{
        const input=$("referLinkInput");input?.focus();input?.select();
        if(!document.execCommand("copy"))throw new Error("Copy is unavailable.");
      }
      setText("referLinkStatus","Referral link copied.");
    }catch(error){setText("referLinkStatus",error.message||"Could not copy the link.");}
  }

  function openShare(url){
    const anchor=document.createElement("a");
    anchor.href=url;anchor.target="_blank";anchor.rel="noopener noreferrer";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
  }
  function shareLink(){
    const url=linkValue();if(!url)return;
    const message="Join me on NAVAA and use my referral link: "+url;
    if(typeof navigator.share==="function"){
      navigator.share({title:"Join NAVAA",text:message,url}).then(
        ()=>setText("referLinkStatus","Referral link shared successfully."),
        error=>{
          if(error?.name==="AbortError"){setText("referLinkStatus","Share cancelled.");return;}
          openShare("https://wa.me/?text="+encodeURIComponent(message));
          setText("referLinkStatus","Opening WhatsApp to share your referral link.");
        }
      );
      return;
    }
    openShare("https://wa.me/?text="+encodeURIComponent(message));
    setText("referLinkStatus","Opening WhatsApp. Select a contact or group.");
  }

  async function waitForMainWallet(){
    for(let i=0;i<40;i++){
      try{if(await connectWallet()){updateLink();await refresh();return true;}}
      catch(error){status(error.message||"Could not connect referral dashboard to wallet.",true);return false;}
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    status("Wallet connection was not detected. Please reconnect.",true);return false;
  }

  function bind(){
    $("referCopyBtn")?.addEventListener("click",copyLink);
    $("referShareBtn")?.addEventListener("click",shareLink);
    $("referWithdrawBtn")?.addEventListener("click",withdraw);
    $("referMaxBtn")?.addEventListener("click",setMax);
    $("referWithdrawAmount")?.addEventListener("input",()=>{
      if(!account||!readContract){updateWithdrawalHint(undefined);return;}
      readContract.referralBalance(account).then(updateWithdrawalHint).catch(()=>updateWithdrawalHint(undefined));
    });
    $("connectBtn")?.addEventListener("click",waitForMainWallet);
    document.querySelectorAll('[data-page-target="refer"]').forEach(button=>{
      button.addEventListener("click",()=>setTimeout(()=>{if(account)refresh();},350));
    });
    if(window.ethereum?.on){
      window.ethereum.on("accountsChanged",async()=>{
        account=null;signer=null;readContract=null;writeContract=null;
        eventProviders=[];eventProvider=null;deploymentBlock=null;historyStart=null;deploymentBlockKnown=false;
        lastScannedBlock=null;cachedStakes=[];cachedWithdrawals=[];
        try{if(await connectWallet()){updateLink();await refresh();}else reset();}
        catch(error){reset();status(error.message||"Wallet account changed.",true);}
      });
      window.ethereum.on("chainChanged",()=>location.reload());
    }
  }

  async function init(){
    bind();reset();
    try{if(await connectWallet()){updateLink();await refresh();}}
    catch(error){status(error.message||"Referral dashboard could not connect to Polygon.",true);}
    if(refreshTimer)clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{
      if(account&&!busy&&$("pageRefer")?.classList.contains("active")&&Date.now()-lastRefreshAt>25000)refresh();
    },5000);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
